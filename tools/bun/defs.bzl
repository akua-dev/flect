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
        command = """
set -euo pipefail
BUN="$1"
OUT="$2"
export HOME="$(mktemp -d)"
export CI=1
# package.json/bun.lock arrive as symlinks into the real source tree; bun's
# frozen-lockfile check spuriously reports "lockfile had changes" against a
# symlinked package.json/bun.lock, so materialize real copies first.
for f in package.json bun.lock; do
  if [ -e "$f" ]; then
    cp -L "$f" "$f.material"
    mv "$f.material" "$f"
  fi
done
# Each check installs its own node_modules in the same action/session that
# then runs it -- see the module docstring above for why that is load-
# bearing, not just simplicity.
"$BUN" install --frozen-lockfile --ignore-scripts
# Defensive belt-and-suspenders for the confirmed real gap in this exact
# dependency graph (@effect/platform-node-shared@4.0.0-beta.102's published
# dist imports "@effect/platform/Effectify", and @effect/platform never
# appears in bun.lock -- verified by grep). Installing it explicitly costs
# one small extra fetch and removes one known way this can fail even where
# the same-session fallback (this module's main fix) is not itself enough.
"$BUN" add "@effect/platform@^0.97" --no-save --ignore-scripts || true
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
        invocation = "run " + script,
        srcs = srcs + extra_srcs,
    )
    build_test(
        name = name,
        targets = [":" + run_name],
    )

def bun_run(name, args, srcs, extra_srcs = [], bun = "//tools/bun:bun"):
    """Like bun_check, but runs an arbitrary `bun <args...>` invocation
    (e.g. `run vitest run src`) instead of a bare package.json script name.
    """
    run_name = name + "_run"
    _bun_action(
        name = run_name,
        bun = bun,
        invocation = args,
        srcs = srcs + extra_srcs,
    )
    build_test(
        name = name,
        targets = [":" + run_name],
    )
