# Flect Browser Bun Command Implementation Plan

## Status

Implemented and verified on 2026-07-30. The ordinary composer now exercises
the complete Pi tool event -> browser `SandboxedShell` -> result transport in
production Chromium.

Implementation decisions made during the gate:

- the compatible transpiler is pinned `esbuild-wasm@0.28.1`;
- preview routing uses a small Flect-owned service worker rather than adopting
  Rifty's higher-level service-worker package;
- `node:zlib` is replaced at the Vite boundary by a fail-closed adapter because
  compression commands and compressed ripgrep input are unsupported; and
- the Pi shell bridge, HTTP endpoint, and private Effect RPC operation were
  added so the feature is available to the agent rather than only to a
  diagnostic.

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Flect agent a reserved, browser-portable Bun-compatible
command through its single `bash` tool, with scoped execution, package
mutation, preview, explicit compatibility limits, and no system Bun
dependency.

**Architecture:** This plan begins only after
`2026-07-30-flect-rifty-execution-substrate.md` passes. `just-bash` parses the
shell language and delegates the reserved `bun` executable to one
Effect-managed `BunCommand` service. That service routes module execution,
package mutation, and preview to narrow Rifty-backed adapters operating on a
disposable proposal mirror; validated deltas return through the workspace
broker, never through a direct canonical OPFS handle.

**Tech Stack:** Effect `4.0.0-beta.102`, `@effect/vitest
4.0.0-beta.102`, `just-bash` `3.2.0`, Rifty leaf packages `0.2.0`, TypeScript
`7.0.2`, Vite `8.1.5`, Vitest `4.1.10`, Playwright `1.62.0`, React `19.2.8`,
Bun `1.4+` for repository development only.

## Global Constraints

- The prerequisite Rifty adoption decision and all its tests must pass first.
- Pin `just-bash` exactly to `3.2.0`; preserve its Apache-2.0 license.
- `bun` is reserved. Capsules, extensions, packages, aliases, and functions
  cannot replace or bypass it.
- The initial supported commands are exactly `run`, `build`, `install`, `add`,
  `remove`, and `stop`.
- The compatibility surface never claims to be the native Bun executable.
- Do not vendor Burrow's checked-in `bun.wasm`; its pinned SHA-256 is
  `4dddd6083635da83d7eb2a41aeaa6b44f428909d612b2f5f35b52bf3bf556630`,
  but its build provenance is incomplete.
- Until a reproducibly built Bun transpiler artifact passes its own adoption
  gate, TypeScript uses the reviewed transform provider injected into Rifty and
  the help output says `transpiler: compatible`.
- All Rifty, just-bash, Worker, package, preview, and filesystem APIs remain
  behind Effect services and strict Schema boundaries.
- A run sees a disposable proposal mirror. It cannot access canonical OPFS,
  Git metadata, credentials, Flect-origin storage, the parent DOM, native
  bridges, or ambient network.
- Package registry access uses the trusted package broker with integrity
  verification. Lifecycle scripts and native addons remain disabled.
- Browser and Tauri WebView expose the same command behavior.
- Production code follows test-first red/green/refactor cycles.
- Do not commit or push without current explicit authorization.

---

## File map

- `shared/bun-command.ts` owns versioned requests, results, compatibility data,
  package mutations, and public typed failures.
- `src/shell/bun-command.ts` owns argument routing and the public
  `BunCommand` Effect service.
- `src/shell/bun-command-live.ts` composes module, package, preview, and
  cancellation adapters once.
- `src/shell/sandboxed-shell.ts` owns the one `just-bash` instance per role and
  registers reserved commands.
- `server/pi-shell-bridge.ts` owns the pending Pi tool request lifecycle.
- `shared/contracts.ts`, `server/app.ts`, `shared/rpc.ts`, and their client
  adapters own the browser/desktop request-result transport.
- `src/execution/bun-module-execution.ts` owns run/build/stop against the
  scoped Rifty module runtime.
- `src/execution/bun-package-mutation.ts` owns install/add/remove against the
  Rifty npm client and returns a bounded file delta.
- `src/execution/bun-preview.ts` owns fetch-handler registration with the
  isolated preview broker.
- `tests/e2e/bun-command.spec.ts` proves the production browser artifacts.
- `docs/bun-compatibility.md` is the single public compatibility matrix.

---

### Task 1: Define the strict Bun command contract and router

**Files:**

- Create: `shared/bun-command.ts`
- Create: `shared/bun-command.test.ts`
- Create: `src/shell/bun-command.ts`
- Create: `src/shell/bun-command.test.ts`

**Interfaces:**

- Produces `BunCommandRequest`, `BunCommandResult`, `BunCompatibility`,
  `BunCommandFailed`, and `BunCommand`.

- [x] **Step 1: Write strict contract tests**

Create tests that decode with excess properties rejected and assert:

```ts
const run = BunCommandRequest.make({
  version: 1,
  argv: ["run", "src/index.ts"],
  cwd: "/workspace",
});

assert.deepStrictEqual(run.argv, ["run", "src/index.ts"]);

const compatibility = BunCompatibility.make({
  version: 1,
  implementation: "flect-browser",
  transpiler: "compatible",
  commands: ["run", "build", "install", "add", "remove", "stop"],
});

assert.strictEqual(compatibility.implementation, "flect-browser");
```

Reject an unknown request property, an empty `argv`, more than 128 arguments,
an argument longer than 4,096 characters, a cwd outside `/workspace`, and an
output above 1 MiB.

- [x] **Step 2: Run the contracts and observe RED**

Run:

```bash
bunx vitest run shared/bun-command.test.ts
```

Expected: FAIL because `shared/bun-command.ts` does not exist.

- [x] **Step 3: Implement the version-one schemas**

Define:

```ts
export class BunCommandRequest extends Schema.Class<BunCommandRequest>(
  "BunCommandRequest",
)({
  version: Schema.Literal(1),
  argv: Schema.Array(
    Schema.String.check(Schema.isMaxLength(4_096)),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  cwd: Schema.String.check(
    Schema.isPattern(/^\/workspace(?:\/[^.][^/]*)*$/),
  ),
}) {}

export class BunCommandResult extends Schema.Class<BunCommandResult>(
  "BunCommandResult",
)({
  version: Schema.Literal(1),
  exitCode: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 255 }),
  ),
  stdout: Schema.String.check(Schema.isMaxLength(1_048_576)),
  stderr: Schema.String.check(Schema.isMaxLength(1_048_576)),
  previewUrl: Schema.optional(Schema.String),
}) {}

export class BunCompatibility extends Schema.Class<BunCompatibility>(
  "BunCompatibility",
)({
  version: Schema.Literal(1),
  implementation: Schema.Literal("flect-browser"),
  transpiler: Schema.Literals(["compatible", "bun-wasm"]),
  commands: Schema.Array(
    Schema.Literals(["run", "build", "install", "add", "remove", "stop"]),
  ),
}) {}
```

Define `BunCommandFailed` with reasons `invalid-input`, `unsupported`,
`workspace`, `package`, `execution`, `preview`, `deadline`, and `cancelled`.
Its public message is capped at 500 characters and contains no guest source,
foreign stack, registry response, or filesystem content.

- [x] **Step 4: Write router tests**

Use a test Layer and assert exact routing:

```ts
const result = yield* BunCommand.execute(
  BunCommandRequest.make({
    version: 1,
    argv: ["run", "src/index.ts"],
    cwd: "/workspace",
  }),
);

assert.strictEqual(result.exitCode, 0);
assert.deepStrictEqual(yield* Ref.get(calls), [
  { operation: "run", args: ["src/index.ts"], cwd: "/workspace" },
]);
```

Also assert:

- `bun file.ts` aliases `bun run file.ts`;
- no arguments and `--help` return compatibility help;
- `--version` returns `flect-browser/1`;
- `test`, `x`, `publish`, `repl`, and every unknown command return exit `1`
  with an explicit unsupported message;
- `run`, `build`, `install`, `add`, `remove`, and `stop` route once; and
- no public error includes a thrown adapter stack.

- [x] **Step 5: Run the router tests and observe RED**

Run:

```bash
bunx vitest run src/shell/bun-command.test.ts
```

Expected: FAIL because `BunCommand` does not exist.

- [x] **Step 6: Implement the minimal router and test Layer**

Define `BunCommand` with:

```ts
readonly execute: (
  request: BunCommandRequest,
) => Effect.Effect<BunCommandResult, BunCommandFailed>;
```

The router parses only the first argument. It maps `i` to `install` and `rm`
to `remove`, rejects option-looking entry paths, and delegates to one private
`BunOperations` service. `makeBunCommandTestLayer` injects operations without
exposing test-only methods on the production service.

- [x] **Step 7: Run focused tests**

Run:

```bash
bunx vitest run shared/bun-command.test.ts src/shell/bun-command.test.ts
```

Expected: PASS.

---

### Task 2: Execute JavaScript and TypeScript through scoped Rifty Workers

**Files:**

- Create: `src/execution/bun-module-execution.ts`
- Create: `src/execution/bun-module-execution.test.ts`
- Modify: `src/execution/rifty-js-runtime.ts`

**Interfaces:**

- Consumes a disposable workspace mirror and the Rifty runtime factory.
- Produces `BunModuleExecution` with `run`, `build`, and `stop`.

- [x] **Step 1: Write lifecycle-first tests**

The tests create an in-memory workspace containing:

```text
/workspace/package.json
/workspace/src/index.ts
```

with:

```ts
export const answer: number = 42;
console.log(answer);
```

Assert that `run` returns stdout `42\n`, `build` reports the resolved module
path, `stop` interrupts an active run, and release count is exactly one after
success, guest failure, deadline, and interruption.

- [x] **Step 2: Run the test and observe RED**

Run:

```bash
bunx vitest run src/execution/bun-module-execution.test.ts
```

Expected: FAIL because `BunModuleExecution` does not exist.

- [x] **Step 3: Implement scoped run/build/stop**

Use one role-owned `Scope` with at most one active run. `run`:

1. validates the entry is below `/workspace`;
2. creates a fresh Rifty runtime Worker;
3. copies only the disposable mirror;
4. injects the reviewed TypeScript transform provider;
5. imports the entry from the requested cwd;
6. captures bounded stdout/stderr; and
7. disposes the Worker on every terminal path.

`build` resolves and transforms the graph without executing its entry and
returns a stable newline-delimited module list. `stop` interrupts the active
fiber and waits for Worker disposal. Map the outer deadline to
`BunCommandFailed(reason: "deadline")`.

- [x] **Step 4: Run lifecycle and production-build checks**

Run:

```bash
bunx vitest run src/execution/bun-module-execution.test.ts
bun run build
```

Expected: PASS with no unresolved Node builtins.

---

### Task 3: Implement package mutation through the Rifty npm client

**Files:**

- Create: `src/execution/bun-package-mutation.ts`
- Create: `src/execution/bun-package-mutation.test.ts`
- Reuse: `src/execution/fixtures/package-registry.ts`

**Interfaces:**

- Produces `BunPackageMutation.install`, `.add`, and `.remove`.
- Returns a bounded `WorkspaceDelta`; it never returns a VFS or OPFS handle.

- [x] **Step 1: Write offline registry tests**

Use the deterministic `flect-fixture@1.0.0` registry fixture and assert:

- `install` creates `node_modules/flect-fixture` and `package-lock.json`;
- `add flect-fixture@1.0.0` updates `package.json`, installs it, and returns
  only changed portable files;
- `remove flect-fixture` removes the manifest dependency and package directory;
- integrity mismatch fails with reason `package`;
- lifecycle scripts are never run;
- traversal package names are rejected before registry access; and
- interruption leaves the source mirror unchanged by applying mutations to a
  staging VFS and publishing the delta only after success.

- [x] **Step 2: Observe RED**

Run:

```bash
bunx vitest run src/execution/bun-package-mutation.test.ts
```

Expected: FAIL because `BunPackageMutation` does not exist.

- [x] **Step 3: Implement staged package mutation**

Clone the proposal mirror into a fresh `MemoryVfs`, update its manifest with
stable two-space JSON and trailing newline, then call:

```ts
install({
  vfs,
  cwd: "/workspace",
  registry,
  signal,
});
```

Validate installed manifests and the v3 lockfile. Diff the staging VFS against
the input mirror, reject paths outside `/workspace`, cap the delta at 4,096
files and 64 MiB, then return it to the trusted workspace broker.

- [x] **Step 4: Run focused tests**

Run:

```bash
bunx vitest run src/execution/bun-package-mutation.test.ts
```

Expected: PASS with the fixture fetcher proving zero ambient network.

---

### Task 4: Register the reserved command in one just-bash shell

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/shell/sandboxed-shell.ts`
- Create: `src/shell/sandboxed-shell.test.ts`
- Create: `src/shell/bun-command-live.ts`

**Interfaces:**

- Produces `SandboxedShell.execute(line)` for Pi's `BashOperations`.

- [x] **Step 1: Add exact `just-bash` pin**

Add:

```json
"just-bash": "3.2.0"
```

Run `bun install` and verify the lock resolves integrity
`sha512-hRTLLWBXCKuosjaNFJR7uPYBza+T2vjG3NdPBz4wxlctlnxwrbLjtLQf6RtSKmy/jzNJ6/URCtvxrXjy6yFGeQ==`.

- [x] **Step 2: Write shell behavior tests**

Assert through the actual just-bash parser:

```text
bun run src/index.ts
bun install && bun run src/index.ts
bun add flect-fixture@1.0.0 | tee install.log
bun stop
```

Also assert that a shell function, alias, executable file, capsule command, and
PATH change named `bun` cannot shadow the reserved command; cancellation
reaches the active Effect fiber; and separate App/Shaper shells do not share
cwd, environment, VFS, or run scope.

- [x] **Step 3: Observe RED**

Run:

```bash
bunx vitest run src/shell/sandboxed-shell.test.ts
```

Expected: FAIL because `SandboxedShell` does not exist.

- [x] **Step 4: Implement one scoped shell per role**

Use the browser entry from `just-bash`. Register `bun` as a host-owned custom
command before accepting a line, enforce the reserved-name rule in command
resolution, thread cwd and environment through the role scope, and map
`AbortSignal` to Effect interruption. Do not enable just-bash JavaScript,
Python, SQLite, Node filesystem, or direct-network integrations.

- [x] **Step 5: Run shell tests and build**

Run:

```bash
bunx vitest run src/shell/sandboxed-shell.test.ts
bun run build
```

Expected: PASS without a `node:zlib` browser import. The implemented Vite
adapter fails closed for the deliberately unsupported compression surface.

---

### Task 5: Add isolated preview registration

**Files:**

- Create: `src/execution/bun-preview.ts`
- Create: `src/execution/bun-preview.test.ts`
- Modify: `public/sw.js`
- Create: `tests/e2e/bun-command.spec.ts`

**Interfaces:**

- Produces one preview URL for `Bun.serve({ fetch })` or a server-shaped default
  export.

- [x] **Step 1: Write preview protocol tests**

Assert that one run may register one integer port, requests and responses are
strictly schema-decoded, bodies and headers are bounded, a stopped run returns
503, a handler deadline returns 504, and a preview document cannot claim the
parent bridge or another run's port.

- [x] **Step 2: Observe RED**

Run:

```bash
bunx vitest run src/execution/bun-preview.test.ts
```

Expected: FAIL because the preview adapter does not exist.

- [x] **Step 3: Implement the preview adapter**

Adapt the pinned Rifty service-worker protocol behind `BunPreview`. The guest
receives only:

```ts
globalThis.Bun = {
  env: {},
  version: "flect-browser/1",
  serve: registerFetchHandler,
};
```

No real socket is bound. The isolated iframe loads only
`/preview/<allocated-port>/`; its CSP denies parent DOM, Flect storage, native
bridges, and undeclared egress.

- [x] **Step 4: Write the real-browser flow**

The Playwright diagnostic opens a fixed test workspace, executes:

```text
bun run src/index.ts
bun add flect-fixture@1.0.0
bun run src/server.ts
```

It asserts stdout, manifest mutation, preview response, `bun stop`, Worker
release, no unexpected console/page errors, and denial of direct canonical
OPFS and ambient network.

- [x] **Step 5: Run production Chromium**

Run:

```bash
bunx playwright test tests/e2e/bun-command.spec.ts
bunx playwright test tests/e2e/flect.spec.ts
```

Expected: PASS against the production Vite build.

---

### Task 6: Publish honest compatibility documentation and verify everything

**Files:**

- Create: `docs/bun-compatibility.md`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/trust-model.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Produces the public support matrix and durable repository guidance.

- [x] **Step 1: Document the exact supported surface**

The matrix records:

- supported commands and aliases;
- JavaScript, TypeScript, JSX, and TSX behavior;
- package and lockfile behavior;
- `Bun.serve` fetch-handler behavior;
- every unsupported Bun API and CLI family;
- browser/Tauri parity;
- absence of system Bun, native process, raw socket, lifecycle-script, and
  native-addon support; and
- the difference between cooperative Rifty execution and Flect's origin,
  broker, schema, workspace, validation, and recovery boundaries.

- [x] **Step 2: Update repository guidance only after proof**

`AGENTS.md` states that agents use Bun only by typing the reserved `bun`
command through `SandboxedShell`; repository development may use the host Bun,
but capsule/App/Shaper execution may not.

- [x] **Step 3: Run the full gate**

Run:

```bash
bun run check:rifty
bun run check:all
git diff --check
git status --short
```

Expected: Effect, Biome, TypeScript, Vitest, Chromium, Rust, and packaged macOS
builds pass; only intended Bun/Rifty/shell/docs changes and the preserved
unrelated `docs/.DS_Store` remain.

---

## Self-review

- **Spec coverage:** The plan covers the reserved command, compatible runtime,
  package operations, cancellation, preview, shell registration, browser and
  native parity, compatibility documentation, and retained Burrow references.
- **Dependency boundary:** It depends on the independently testable Rifty
  adoption plan and does not hide that prerequisite inside Bun work.
- **Provenance:** Burrow's opaque binary is retained as research but not
  selected. A reproducible Bun transpiler is a future compatible enhancement,
  not a false claim in the first slice.
- **Authority:** No guest obtains canonical OPFS, Git metadata, credentials,
  native bridges, ambient network, or host Bun.
- **Type consistency:** `BunCommand` is the only shell-facing service;
  `BunModuleExecution`, `BunPackageMutation`, and `BunPreview` are private
  adapters composed once in `bun-command-live.ts`.
- **Lifecycle:** Every run and preview is scoped, interruptible, bounded, and
  disposed; package mutation stages before publishing a validated delta.
