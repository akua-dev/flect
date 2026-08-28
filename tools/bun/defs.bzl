"""Thin Bazel wrappers around flect's existing bun-native check scripts.

Design note (cnap#866 red-team review, Front 2 "alternatives weighed
honestly", (b)): flect is a bun app (Astro/React/Effect/Tauri), not a
pnpm project, so idiomatic per-file JS/TS rules (aspect_rules_js) do not
apply -- rules_js is pnpm-only. The honest, maintainable design is to
wrap the same commands a human runs locally ("bun run <script>") as
cacheable Bazel actions, exactly the "shim around the existing bun-native
command" pattern the review already recommends and that cnap itself uses
elsewhere for bun-under-Bazel.

Every check action keeps network access, matching today's quality.yml
exactly: that workflow's single `checks` job already runs the whole
`bun run check` pipeline with unrestricted egress (no runner containment
guarantee depends on it -- see the CI-security addendum on cnap#866, which
scopes untrusted-code containment to self-hosted runners, not the public
advisory workflow's network policy).

Each check is modeled as two targets:
  - "<name>_run": the action that actually executes the command. Its
    declared inputs are the precise source/config globs the caller passes,
    so Bazel's action cache skips it whenever those inputs are unchanged.
  - "<name>": a bazel_skylib build_test wrapping that action, so
    `bazel test //...` picks it up like any other test target. build_test
    only forces the dependency graph to build; it runs nothing on its own,
    which sidesteps sh_test's runfiles-resolution complexity entirely for
    what is fundamentally a "did this build action succeed" gate.

Why each check runs its OWN `bun install` rather than sharing one
//:node_modules tree artifact across actions (the initially "obvious",
more cacheable design): extensive on-runner investigation
(iteration log in the PR body) found that some of flect's own check
scripts (starting with check:rifty) transitively hit bun's own
per-import network auto-install fallback (a real, reproducible upstream
gap: `@effect/platform-node-shared@4.0.0-beta.102`'s published dist
imports `@effect/platform/Effectify`, and `@effect/platform` never
appears in bun.lock at all -- confirmed by grep). That fallback works
reliably whenever `bun install` and the `bun run` that needs it share one
process/session (matches quality.yml's current single-job behavior, and
every plain-shell reproduction attempted), and fails -- consistently,
regardless of sandboxing, linker mode (hoisted vs isolated), or whether
node_modules is symlinked vs physically copied into place -- the moment
install and run become two separate Bazel actions consuming a shared
tree-artifact dependency. The exact mechanism inside bun's resolver was
not identified even after exhausting the direct reproductions (symlink
depth, read-only tree-artifact permissions, workspace detection,
directory-nesting bugs, and timestamp/staleness checks were each ruled
out one at a time); what is reliably reproducible is that keeping install
and run in the SAME action restores the working behavior every time.
Each check therefore installs its own node_modules. Bazel's action cache
still gives the exact same warm-cache behavior (skip the whole action,
install included, whenever its declared inputs are unchanged); the
measured cost is that a genuinely cold cache now runs bun install once
per check target instead of once shared -- Bazel parallelizes those
installs, so wall-clock cost is not N times the shared-install cost, but
it is real duplicated network/CPU work. See the PR body's timing table
for the measured impact and //:node_modules (kept as a target in
BUILD.bazel for humans/CI steps that want a plain installed tree without
running a specific check) for the shared-artifact alternative this
design moved away from.
"""

load("@bazel_skylib//rules:build_test.bzl", "build_test")

def _bun_action_impl(ctx):
    out = ctx.actions.declare_file(ctx.label.name + ".ok")
    bun = ctx.executable.bun
    lockfile_srcs = [ctx.file.package_json, ctx.file.bun_lock, ctx.file.workspace_package_json]
    ctx.actions.run_shell(
        outputs = [out],
        inputs = ctx.files.srcs + lockfile_srcs,
        tools = [bun],
        arguments = [bun.path, out.path],
        # Bazel's default action invocation strips the environment down to a
        # handful of vars (confirmed on a real run: `exec env - TMPDIR=/tmp
        # <process-wrapper> ... bash -c '...'`, i.e. PATH is entirely unset).
        # That silently breaks anything this script pipeline shells out to
        # via bare command-name lookup that isn't under node_modules/.bin
        # (which bun's own `bun run` does still prepend to PATH) -- notably
        # `tar` (system binary, several scripts/tests) and, non-obviously,
        # `astro build` itself: `node_modules/.bin/astro` is a `#!/usr/bin/env
        # node` script, and ubuntu-latest's Node lives in a versioned
        # toolcache path (not /usr/bin), so there is no fixed absolute path
        # to hardcode here even for that one case. `use_default_shell_env`
        # is Bazel's documented escape hatch for exactly this: it restores
        # the PATH (and a small allowlist of other vars) from the shell that
        # invoked `bazel test`/`bazel build`, matching what a human running
        # the same command locally would have. This action already runs
        # non-hermetically by design (network access, non-pinned system
        # tools) -- see the module docstring -- so this doesn't give up any
        # hermeticity this rule was actually providing.
        use_default_shell_env = True,
        command = """
set -euo pipefail
BUN="$1"
OUT="$2"
# use_default_shell_env (above) restores a real PATH so `tar`/`astro build`'s
# `#!/usr/bin/env node` shebang resolve -- but that real PATH doesn't know
# about the Bazel-downloaded bun binary's own (execroot-relative, generated)
# location. Package.json scripts that shell out to a bare `bun ...` (e.g.
# "build": "bun run build:product && ...") need that directory on PATH too:
# confirmed regression on a real run -- with a real PATH now restored but
# missing bun's own dir, `bun run build:product` inside the script string
# failed with "bun: command not found" (exit 127), where previously (empty
# PATH) bun's own script-runner apparently prepended its own directory by
# default and this worked.
export PATH="$(dirname "$BUN"):$PATH"
# Candidate fix for //:build ("Cannot find module '@astrojs/preact'",
# a real, installed, bare-specifier dependency) and the Vite-powered
# vitest/astro targets' shared symptom (Vite/Astro's own config-loading or
# dev-server failing to resolve genuinely-present files/packages under this
# sandbox, e.g. test_misc's vite-development-smoke.test.ts: "Failed to load
# url /src/app.tsx ... Does the file exist?"): use_default_shell_env (above)
# restores not just PATH but a small allowlist of other vars from the
# invoking shell, which may include PWD -- a shell convention some tools
# (Vite/Rollup among them) prefer over the real process cwd for root
# detection specifically because it survives symlink traversal the way
# getcwd() doesn't. If PWD still pointed at the original (non-Bazel)
# checkout directory here, that would explain every one of these symptoms
# at once: the packages/files in question are only actually installed/
# built inside this sandboxed cwd, not at the plain checkout path.
export PWD="$(pwd)"
export HOME="$(mktemp -d)"
export CI=1
# 13 check targets each running their own `bun install` in parallel (see
# the module docstring above for why they don't share one node_modules
# artifact) means 13 concurrent full downloads+extracts of the same ~2000
# packages if each install's cache is private to its own throwaway $HOME --
# confirmed on a real runner: ubuntu-latest's disk filled and every action
# past the first few failed with ENOSPC. bun's download+extract cache is
# keyed by package name+version+integrity, so it is safe (and a lot
# cheaper) to share across these concurrent installs even though each
# action's $HOME is otherwise private; point it at a fixed, non-sandboxed
# path so every action's install populates and reuses the same cache
# instead of redoing the same network+extraction work from scratch.
export BUN_INSTALL_CACHE_DIR="/tmp/.flect-bazel-bun-cache"
mkdir -p "$BUN_INSTALL_CACHE_DIR"
# package.json/bun.lock arrive as symlinks into the real source tree; bun's
# frozen-lockfile check spuriously reports "lockfile had changes" against a
# symlinked package.json/bun.lock, so materialize real copies first.
for f in package.json bun.lock; do
  if [ -e "$f" ]; then
    cp -L "$f" "$f.material"
    mv "$f.material" "$f"
  fi
done
# `--no-install` on the invocation below only gates a bare, top-level,
# statically-analyzable missing specifier -- confirmed on a real ubuntu-latest
# run (flect-projection-staging) that it does NOT stop bun's runtime
# auto-install fallback for a transitive subpath import surfacing lazily
# inside a dependency's own compiled code (e.g. @effect/platform-bun's
# BunFileSystem.js -> @effect/platform-node-shared/NodeFileSystem): that
# fallback silently fetched npm's "latest" dist-tag for both packages (an
# old v3-era line -- 0.91.2 / 0.61.1 -- instead of the pinned
# 4.0.0-beta.102), which then cascades into further ENOENT/"Cannot find
# module" errors since the v3-era code's own dependency graph
# (@effect/platform, bare) is correctly absent from this project's v4 lock.
# bunfig.toml's `install.auto = "disable"` is documented to fully disable
# that fallback for every resolution path, not just the one --install=<val>
# covers, so belt-and-suspenders it here too.
cat > bunfig.toml <<'BUNFIG'
[install]
auto = "disable"
frozenLockfile = true
BUNFIG
# Each check installs its own node_modules in the same action/session that
# then runs it -- see the module docstring above for why that is load-
# bearing, not just simplicity.
"$BUN" install --frozen-lockfile --ignore-scripts
# Diagnostic instrumentation (cnap#866 follow-up): a real ubuntu-latest run
# hit the auto-install fallback above immediately after a successful
# `bun install` in this very same action/process -- bun's own --help says
# "auto" mode (the default the fallback still uses once --no-install fails
# to gate it) triggers "when no node_modules" is visible from cwd. Every
# local reproduction of this exact install-then-run sequence (darwin,
# raw filesystem AND real Bazel sandbox, single-process and 12-way
# concurrent) found node_modules fully populated and resolvable at this
# point, so this logs the same facts on the real failing runner to
# confirm/refute whether cwd-visibility is actually the trigger there.
echo "=== bun action diagnostics: $(pwd) ==="
echo "PATH=$PATH" >&2
echo "PWD env var (pre-fixup)=$PWD vs real cwd=$(pwd)" >&2
which node >&2 2>&1 || echo "node NOT ON PATH" >&2
which tar >&2 2>&1 || echo "tar NOT ON PATH" >&2
ls -la node_modules >&2 2>&1 | head -5 || echo "node_modules NOT VISIBLE" >&2
ls node_modules/@effect >&2 2>&1 || echo "node_modules/@effect NOT VISIBLE" >&2
"$BUN" -e "console.log(require.resolve('@effect/platform-bun'))" >&2 2>&1 || echo "require.resolve('@effect/platform-bun') FAILED" >&2
# Round 4 rung 2 follow-up: a minimal Bazel-sandboxed repro (file: dependency
# with a wildcard `exports` entry, akua-dev/bun-wildcard-exports-repro-bazel)
# reproduced "Cannot find module" under this exact processwrapper-sandbox
# shape, and the installed node_modules/<pkg>/ in that repro was missing its
# own package.json (only dist/ was present) -- meaning the exports map bun
# needed to resolve the subpath from was never even on disk. Check directly
# whether the REAL @effect/platform-bun@4.0.0-beta.102 registry-installed
# store entry (a totally different bun install code path -- .bun store +
# symlink, not a raw file: copy) is missing the same thing here, and whether
# the subpath resolve failure reproduces via `bun -e` (not just native
# `bun run *.ts` execution).
PBUN_STORE="$(find node_modules/.bun -maxdepth 1 -iname '*platform-bun*beta.102*' 2>/dev/null | head -1)"
echo "=== platform-bun store entry: ${{PBUN_STORE:-NOT FOUND}} ===" >&2
if [ -n "$PBUN_STORE" ]; then
  find "$PBUN_STORE" -maxdepth 4 >&2 2>&1
fi
"$BUN" -e "console.log(require.resolve('@effect/platform-bun/BunFileSystem'))" >&2 2>&1 || echo "require.resolve('@effect/platform-bun/BunFileSystem') FAILED via -e eval" >&2
"$BUN" {invocation}
touch "$OUT"
""".format(invocation = ctx.attr.invocation),
        execution_requirements = {
            "no-remote-exec": "1",
            "requires-network": "1",
        },
        progress_message = "bun " + ctx.attr.invocation + " (%{label})",
    )
    return [DefaultInfo(files = depset([out]))]

_bun_action = rule(
    implementation = _bun_action_impl,
    attrs = {
        "bun": attr.label(
            allow_single_file = True,
            cfg = "exec",
            executable = True,
        ),
        "bun_lock": attr.label(allow_single_file = True, default = "//:bun.lock"),
        "invocation": attr.string(mandatory = True),
        "package_json": attr.label(allow_single_file = True, default = "//:package.json"),
        "srcs": attr.label_list(allow_files = True),
        "workspace_package_json": attr.label(allow_single_file = True, default = "//:packages/product/package.json"),
    },
)

def bun_check(name, script, srcs, extra_srcs = [], bun = "//tools/bun:bun"):
    """Defines a cacheable Bazel test that runs `bun run <script>`.

    Args:
        name: base target name; produces "<name>_run" (the action) and
            "<name>" (build_test, the actual `bazel test` target).
        script: the package.json script name to run, e.g. "check:rifty".
        srcs: source files/globs this check actually reads.
        extra_srcs: additional labels (e.g. other targets' outputs) to
            depend on.
        bun: label of the bun executable.
    """
    run_name = name + "_run"
    _bun_action(
        name = run_name,
        bun = bun,
        invocation = "run --no-install " + script,
        srcs = srcs + extra_srcs,
    )
    build_test(
        name = name,
        targets = [":" + run_name],
    )

def bun_run(name, args, srcs, extra_srcs = [], bun = "//tools/bun:bun"):
    """Like bun_check, but runs an arbitrary `bun <args...>` invocation
    (e.g. `run vitest run src`) instead of a bare package.json script name.

    `args` must start with "run " -- --no-install is inserted right after
    it (see bun_check's docstring in this module and the module-level
    comment on --no-install for why this is permanent, not a one-off
    debugging flag).
    """
    if not args.startswith("run "):
        fail("bun_run: args must start with \"run \", got: " + args)
    run_name = name + "_run"
    _bun_action(
        name = run_name,
        bun = bun,
        invocation = "run --no-install " + args[len("run "):],
        srcs = srcs + extra_srcs,
    )
    build_test(
        name = name,
        targets = [":" + run_name],
    )
