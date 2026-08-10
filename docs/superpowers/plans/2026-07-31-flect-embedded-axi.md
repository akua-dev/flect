# Flect Embedded AXI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. This repository currently forbids
> commits without separate user authorization, so each task ends with a diff
> and test checkpoint instead of a commit.

**Goal:** Replace the separately shipped `flectctl` and `flect-mcp` binaries
with one AXI-compliant `flect` command surface embedded in the native app and
the role-owned browser shell, backed by one Effect command/state authority.

**Architecture:** A reusable Effect `FlectAxiProgram` parses commands and
renders bounded TOON through source-specific gateways. Native invocations use
the authenticated loopback broker; App Agent and Shaper use a bounded
in-process Effect queue whose source identity is captured by their sandbox.
The Tauri executable remains the only public native executable and forwards
CLI/MCP modes to the existing private Bun runtime.

**Tech Stack:** TypeScript 7, Effect 4 beta, `@effect/vitest`,
`@toon-format/toon@4.1.0`, Bun 1.4+, just-bash 3.2.0, Pi 0.82.1, React 19,
Tauri 2/Rust, MCP v2, Vitest, Playwright/Chromium.

## Global Constraints

- Follow
  [`../specs/2026-07-31-flect-embedded-axi-design.md`](../specs/2026-07-31-flect-embedded-axi-design.md).
- Preserve all existing uncommitted T3-style composer, Markdown, control,
  shell, release, and documentation work.
- Do not commit, push, merge, publish, release, or modify real agent
  configuration without separate user authorization.
- Start every behavior change with a failing observable test and verify that it
  fails for the intended missing behavior before adding production code.
- Keep application behavior in Effect: strict Effect Schema boundaries,
  `Context.Service`, named Layers, `Effect.fn`, typed failures, `Queue`,
  `Deferred`, `Stream`, `Ref`/`SubscriptionRef`, Scope, and interruption.
- Use the pinned `.repos/effect` checkout and the repository Effect guides for
  exact APIs; keep all Effect package versions aligned at `4.0.0-beta.102`.
- Use the official `@toon-format/toon` package pinned exactly to `4.1.0`; TOON
  is an output encoding, never application state or transport state.
- Guardian stays tool-free. App and Shaper stay isolated and cannot forge
  their command source or broaden their role authority.
- Browser `flect` must run entirely inside the existing just-bash sandbox and
  must not call localhost, spawn native processes, expose credentials, or gain
  host filesystem/network access.
- Outside control remains disabled by default, loopback-only, explicitly
  user-enabled, authenticated, attributable, bounded, and revocable.
- Default stdout follows AXI; stderr is diagnostics only; exit codes are `0`
  success/no-op, `1` operational failure, and `2` usage failure.
- Test observable exports, protocols, rendered UI, and real artifacts; never
  assert that implementation source contains a chosen string.

---

## File map

### New files

- `src/axi/contracts.ts` — AXI invocation, audience, output, exit-code, public
  failure, and result schemas.
- `src/axi/output.ts` — bounded projections and official TOON/JSON encoding.
- `src/axi/output.test.ts` — AXI formatting, truncation, empty-state, channel,
  and byte-limit behavior.
- `src/axi/gateway.ts` — transport-neutral `FlectCommandGateway` Effect
  service.
- `src/axi/broker-gateway.ts` — gateway backed by `FlectControlClient`.
- `src/axi/command.ts` — strict noun-first parser and command-local help.
- `src/axi/command.test.ts` — parser, unknown-input, idempotent syntax, and help
  behavior.
- `src/axi/program.ts` — content-first home view and command orchestration.
- `src/axi/program.test.ts` — gateway-level AXI behavior.
- `src/axi/agent-command-bus.ts` — bounded in-process request queue with exact
  Deferred responses.
- `src/axi/agent-command-bus.test.ts` — capacity, interruption, timeout, and
  shutdown tests.
- `src/axi/agent-command-bridge.ts` — source-aware controller consumer.
- `src/axi/agent-command-bridge.test.ts` — controller/gateway parity and role
  denial tests.
- `src/axi/agent-gateway.ts` — role-bound gateway used by the virtual command.
- `src/shell/flect-command.ts` — just-bash custom command adapter.
- `src/shell/flect-command.test.ts` — argv, output, source binding, and error
  projection tests.
- `cli/flect.ts` — unbundled native-development AXI entrypoint.
- `cli/flect.test.ts` — native broker adapter and process-facing I/O tests.
- `server/sidecar-mode.ts` — strict private runtime mode selection.
- `server/sidecar-mode.test.ts` — RPC/AXI/MCP selection tests.
- `src/lib/agent-integration.ts` — idempotent Codex, Claude Code, and OpenCode
  integration planning and mutation service.
- `src/lib/agent-integration.test.ts` — temporary-root install/repair/remove
  behavior.
- `assets/agent-integrations/opencode/flect.js` — dependency-free OpenCode V2
  plugin template.
- `.agents/skills/flect/SKILL.md` — generated static discovery skill.
- `scripts/generate-flect-skill.ts` — generates/checks the skill from the AXI
  static guidance.
- `scripts/generate-flect-skill.test.ts` — deterministic generation test.
- `tests/e2e/embedded-axi.spec.ts` — real-browser role and reactive-state proof.

### Renamed or removed files

- Replace `cli/flectctl.ts` and `cli/flectctl.test.ts` with `cli/flect.ts` and
  `cli/flect.test.ts` after behavioral characterization is migrated.
- Keep `cli/flect-mcp.ts` as a source module but remove its auto-running public
  binary entrypoint; `flect mcp` invokes its exported server.
- Delete generated `src-tauri/binaries/flectctl-aarch64-apple-darwin` and
  `src-tauri/binaries/flect-mcp-aarch64-apple-darwin` only after packaging no
  longer references them.
- Delete `server/pi-proposal-tool.ts` and its test only after Shaper Bash
  proposal parity passes.

### Existing files modified

- `package.json`, `bun.lock`
- `shared/control.ts`, `shared/control.test.ts`
- `shared/contracts.ts`, `shared/contracts.test.ts`
- `shared/bun-command.ts`, `shared/bun-command.test.ts`
- `src/lib/workspace-controller.ts`, `src/lib/workspace-controller.test.ts`
- `src/lib/agent-workspace.ts`, `src/lib/agent-workspace.test.ts`
- `src/lib/runtime.ts`
- `src/shell/sandboxed-shell-service.ts`
- `src/shell/sandboxed-shell.ts`, `src/shell/sandboxed-shell.test.ts`
- `server/pi-runtime.ts`, `server/pi-runtime.test.ts`
- `server/sidecar.ts`
- `cli/flect-client.ts`, `cli/flect-client.test.ts`
- `cli/flect-mcp.ts`, `cli/flect-mcp.test.ts`
- `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`, `src-tauri/capabilities/main.json`
- `scripts/build-sidecar.ts`
- `scripts/package-release.ts`, `scripts/package-release.test.ts`
- `scripts/smoke-pi.ts`
- `src/components/diagnostics-panel.tsx` and its test
- `src/lib/tauri-transport.ts` and its test
- `tests/e2e/flect.spec.ts`, `playwright.config.ts`
- `AGENTS.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `README.md`, `VISION.md`
- `docs/local-control.md`, `docs/trust-model.md`

---

### Task 1: AXI result contract and TOON output boundary

**Files:**

- Create: `src/axi/contracts.ts`
- Create: `src/axi/output.ts`
- Create: `src/axi/output.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**

- Produces `AxiAudience`, `AxiInvocation`, `AxiPublicError`, `AxiRunResult`,
  `renderAxiSuccess`, and `renderAxiFailure`.
- `AxiRunResult` is the only value process and just-bash adapters write to
  their output channels.

- [ ] **Step 1: Write the failing output tests**

Cover these exact cases in `src/axi/output.test.ts` with `@effect/vitest`:

```ts
it.effect("renders compact TOON with a definitive empty collection", () =>
  Effect.gen(function* () {
    const result = yield* renderAxiSuccess({
      format: "toon",
      value: { count: 0, actions: [] },
    })
    assert.strictEqual(result.exitCode, 0)
    assert.strictEqual(result.stderr, "")
    assert.match(result.stdout, /^count: 0\nactions\[0\]:$/)
  }),
)

it.effect("puts structured errors on stdout with usage exit code 2", () =>
  Effect.gen(function* () {
    const result = yield* renderAxiFailure(
      AxiPublicError.make({
        code: "unknown-flag",
        message: "Unknown flag --stat for action list.",
        help: ["Run `flect action list --help`"],
      }),
      "toon",
      2,
    )
    assert.strictEqual(result.exitCode, 2)
    assert.strictEqual(result.stderr, "")
    assert.include(result.stdout, "code: unknown-flag")
  }),
)
```

Also assert JSON compatibility, a 1,000-character default preview with total
character count, `--full` preservation, newline termination, and rejection of
encoded output above the shared byte limit.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
bunx vitest run src/axi/output.test.ts
```

Expected: failure because `src/axi/output.ts` does not exist.

- [ ] **Step 3: Pin the official encoder**

Run:

```bash
bun add --exact @toon-format/toon@4.1.0
```

Confirm `package.json` contains exactly `"@toon-format/toon": "4.1.0"`.

- [ ] **Step 4: Implement typed AXI results and formatting**

Use these public shapes in `src/axi/contracts.ts`:

```ts
export const AxiAudience = Schema.Literals(["native", "app", "shaper"])

export class AxiInvocation extends Schema.Class<AxiInvocation>(
  "AxiInvocation",
)({
  audience: AxiAudience,
  bin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)),
  format: Schema.Literals(["toon", "json"]),
  full: Schema.Boolean,
}) {}

export class AxiPublicError extends Schema.Class<AxiPublicError>(
  "AxiPublicError",
)({
  code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  help: Schema.Array(Schema.String.check(Schema.isMaxLength(500))).check(
    Schema.isMaxLength(4),
  ),
}) {}

export class AxiRunResult extends Schema.Class<AxiRunResult>("AxiRunResult")({
  exitCode: Schema.Literals([0, 1, 2]),
  stdout: Schema.String,
  stderr: Schema.String,
}) {}
```

In `output.ts`, use `encode` from `@toon-format/toon`, `JSON.stringify` only
inside `Effect.try`, a recursive bounded projection before encoding, and a
final UTF-8 byte check. Map encoder defects to one `AxiFormatError` tagged
error; never leak encoder details.

- [ ] **Step 5: Run GREEN and the existing shared contract tests**

```bash
bunx vitest run src/axi/output.test.ts shared/control.test.ts
```

Expected: all selected tests pass without warnings.

- [ ] **Step 6: Review the task diff without committing**

```bash
git diff --check
git diff -- package.json bun.lock src/axi/contracts.ts src/axi/output.ts src/axi/output.test.ts
```

---

### Task 2: Strict noun-first AXI parser and transport-neutral program

**Files:**

- Create: `src/axi/gateway.ts`
- Create: `src/axi/command.ts`
- Create: `src/axi/command.test.ts`
- Create: `src/axi/program.ts`
- Create: `src/axi/program.test.ts`
- Create: `src/axi/broker-gateway.ts`
- Create: `cli/flect.ts`
- Create: `cli/flect.test.ts`
- Modify: `cli/flect-client.ts`
- Remove after parity: `cli/flectctl.ts`, `cli/flectctl.test.ts`

**Interfaces:**

```ts
export interface FlectCommandGatewayShape {
  readonly audience: AxiAudience
  readonly bin: string
  readonly status: Effect.Effect<ControlBrokerStatus, FlectGatewayError>
  readonly inspect: Effect.Effect<FlectWorkspaceSnapshot, FlectGatewayError>
  readonly logs: Effect.Effect<ControlLogsResponse, FlectGatewayError>
  readonly events: (
    after: number,
  ) => Stream.Stream<FlectWorkspaceEvent, FlectGatewayError>
  readonly command: (
    command: FlectCommand,
    expectedSequence?: number,
  ) => Effect.Effect<FlectCommandReceipt, FlectCommandError | FlectGatewayError>
}
```

- `runFlect(argv)` returns `Effect<AxiRunResult, never,
  FlectCommandGateway>`.
- `BrokerFlectCommandGatewayLive` adapts the existing authenticated client and
  translates its private errors into stable gateway errors.

- [ ] **Step 1: Characterize and then replace the old CLI behavior**

Copy the useful existing `flectctl` tests into `cli/flect.test.ts`, then change
their required behavior:

- no arguments request the live home view rather than help;
- default output is TOON;
- `--json` remains valid;
- errors use stdout and exit `1` or `2`;
- unknown flags fail before the gateway is called;
- noun-first commands are required;
- `favorite add|remove` and `extensions enable|disable` replace toggles; and
- `--help` works at every noun and leaf.

- [ ] **Step 2: Add parser RED tests**

Use table-driven tests for the complete command catalog from the design. At
minimum, assert these concrete parses:

```ts
yield* assertParse(["mode", "set", "run"], {
  type: "set-mode",
  mode: "run",
})
yield* assertParse(["action", "invoke", "run-report"], {
  type: "invoke-interface-action",
  nodeId: "run-report",
})
yield* assertParse(["extensions", "enable", "shaper"], {
  type: "set-external-extensions",
  role: "shaper",
  enabled: true,
})
yield* assertUsage(["action", "list", "--stat"], "unknown-flag")
```

- [ ] **Step 3: Run parser/program/CLI tests and confirm RED**

```bash
bunx vitest run src/axi/command.test.ts src/axi/program.test.ts cli/flect.test.ts
```

Expected: failure because the AXI parser/program modules do not exist.

- [ ] **Step 4: Implement the parser as closed command definitions**

Represent each leaf with its exact path, allowed flags, usage, examples,
audiences, and an Effect parser. Do not scan and remove global flags from
arbitrary positions as `flectctl` currently does. Parse recognized global
flags first, then reject every unconsumed argument by name.

The only universal flags are `--help`, `--json`, and `--full`. `--stdin`,
`--fields`, `--limit`, `--after`, `--role`, and `--operation` are leaf-local.
The removed `raw` escape hatch is not part of AXI; MCP/HTTP retain the strict
closed command schema for machine clients.

- [ ] **Step 5: Implement content-first program behavior**

The native no-argument output must contain `bin`, `description`, workspace
mode/phase/sequence, compact role status, proposal summary when present, and
two or three contextual commands. If control is disabled or no workspace is
connected, return a successful, definitive state such as:

```text
bin: /Applications/Flect.app/Contents/MacOS/flect
description: Inspect and operate the live Flect workspace
control: disabled
workspace: unavailable
help[2]:
  Open Flect and enable Local control in Diagnostics
  Run `flect app` to open Flect
```

Mutations wait for the exact terminal receipt already provided by
`FlectControlClient.command`, then fetch one relevant post-state projection in
the same command response.

- [ ] **Step 6: Implement broker and process adapters**

`cli/flect.ts` exports `runFlectCli(argv, io)` and has a guarded
`import.meta.main` boundary for repository development. `io.stdout` receives
only `result.stdout`; `io.stderr` receives only `result.stderr`; the process
exit code is `result.exitCode`.

Keep state-directory and client-name selection as private adapter options, not
public agent-facing help. Reject missing option values.

- [ ] **Step 7: Run GREEN and remove the old entrypoint**

```bash
bunx vitest run src/axi/command.test.ts src/axi/program.test.ts cli/flect.test.ts cli/flect-client.test.ts
```

After the replacement tests pass, remove `cli/flectctl.ts` and
`cli/flectctl.test.ts`; update imports and the package script from `flectctl`
to `flect`.

- [ ] **Step 8: Review the task diff without committing**

```bash
git diff --check
rg -n "flectctl" cli package.json
git diff -- cli src/axi package.json
```

Expected: no executable or script named `flectctl` remains in active CLI code.

---

### Task 3: Idempotent shared commands and agent source authorization

**Files:**

- Modify: `shared/control.ts`
- Modify: `shared/control.test.ts`
- Modify: `src/lib/workspace-controller.ts`
- Modify: `src/lib/workspace-controller.test.ts`
- Modify: `src/lib/agent-workspace.ts`
- Modify: `src/lib/agent-workspace.test.ts`
- Modify: `src/hooks/use-workspace.ts`
- Modify: UI tests that construct the replaced commands

**Interfaces:**

Add these strict schema values:

```ts
export class AgentCommandSource extends Schema.Class<AgentCommandSource>(
  "AgentCommandSource",
)({
  kind: Schema.Literal("agent"),
  role: InteractiveAgentRole,
  sessionId: Identifier,
  parentOperationId: OperationId,
  requestId: ToolCallId,
}) {}

export class SetModelFavorite extends Schema.Class<SetModelFavorite>(
  "SetModelFavorite",
)({
  type: Schema.Literal("set-model-favorite"),
  model: ModelSelection,
  favorite: Schema.Boolean,
}) {}

export class SetExternalExtensions extends Schema.Class<SetExternalExtensions>(
  "SetExternalExtensions",
)({
  type: Schema.Literal("set-external-extensions"),
  role: InteractiveAgentRole,
  enabled: Schema.Boolean,
}) {}
```

Remove `ToggleModelFavorite` and `ToggleExternalExtensions` only after every UI,
CLI, MCP, and test caller uses explicit desired state.

- [ ] **Step 1: Write schema and authorization RED tests**

Test strict decoding of `AgentCommandSource`, excess-property rejection, and
explicit state commands. Add a controller policy matrix with each command as a
row and `user`, `control`, `app`, and `shaper` as columns.

Mandatory denial assertions:

- App cannot set mode, submit Shaper work, change revisions, safe mode,
  models/extensions, control, rail, or another role.
- Shaper cannot accept/reject/rollback, safe mode, product actions,
  models/extensions, control, rail, or another role.
- Any agent cannot enable control.
- Control source cannot enable control.
- Guardian is not representable as an interactive agent source.

- [ ] **Step 2: Confirm RED**

```bash
bunx vitest run shared/control.test.ts src/lib/workspace-controller.test.ts
```

Expected: the new source and set commands are absent and policy tests fail.

- [ ] **Step 3: Implement source and explicit-state schemas**

Extend `FlectCommandSource` and `FlectCommand`. Update operation/message/event
attribution branches so agent sources retain role and parent operation without
being mistaken for outside clients.

- [ ] **Step 4: Implement controller authorization before claim**

Keep authorization inside `FlectWorkspaceController.authorize`. Use an
exhaustive command switch by source kind; do not derive security from parser
audiences or hidden help. Return `ControlUnauthorized` with bounded public copy.

- [ ] **Step 5: Make state changes idempotent**

Change AgentWorkspace methods to:

```ts
readonly setModelFavorite: (
  selection: ModelSelection,
  favorite: boolean,
) => Effect.Effect<void>
readonly setExternalExtensions: (
  role: InteractiveAgentRole,
  enabled: boolean,
) => Effect.Effect<void>
```

If current state already equals the request, return success without refreshing
or replacing Pi sessions. Add tests proving no close/create operation occurs
for an already-satisfied request.

- [ ] **Step 6: Migrate UI and adapters**

Visible toggle controls calculate explicit desired state from the current
snapshot and dispatch the set command. MCP's raw closed union automatically
uses the new schema; old toggle commands fail strict decoding.

- [ ] **Step 7: Run GREEN**

```bash
bunx vitest run shared/control.test.ts src/lib/workspace-controller.test.ts src/lib/agent-workspace.test.ts src/app.test.tsx src/components/model-menu.test.tsx cli/flect-mcp.test.ts
```

- [ ] **Step 8: Review the task diff without committing**

```bash
git diff --check
rg -n "ToggleModelFavorite|ToggleExternalExtensions|toggle-model-favorite|toggle-external-extensions" shared src cli server
```

Expected: no old toggle schema or call site remains.

---

### Task 4: Bounded in-process agent command bus and controller bridge

**Files:**

- Create: `src/axi/agent-command-bus.ts`
- Create: `src/axi/agent-command-bus.test.ts`
- Create: `src/axi/agent-command-bridge.ts`
- Create: `src/axi/agent-command-bridge.test.ts`
- Create: `src/axi/agent-gateway.ts`
- Modify: `src/lib/runtime.ts`

**Interfaces:**

```ts
export type AgentGatewayOperation =
  | { readonly type: "inspect" }
  | { readonly type: "logs" }
  | { readonly type: "command"; readonly command: FlectCommand }

export interface AgentCommandBusShape {
  readonly submit: (
    source: AgentCommandSource,
    operation: AgentGatewayOperation,
  ) => Effect.Effect<AgentGatewayResult, AgentCommandBusError>
  readonly take: Effect.Effect<AgentCommandRequest, AgentCommandBusError>
  readonly shutdown: Effect.Effect<void>
}
```

`AgentCommandRequest` is internal and carries a typed `Deferred`; it is not a
Schema boundary or persisted value. Queue capacity is 32 and each request has
a 30-second deadline.

- [ ] **Step 1: Write queue lifecycle RED tests**

Test exact response delivery, interruption removing/failing a pending request,
capacity rejection, timeout with `TestClock`, and scoped shutdown failing all
pending requests. Assert no unbounded queue or orphan fiber remains.

- [ ] **Step 2: Confirm RED**

```bash
bunx vitest run src/axi/agent-command-bus.test.ts
```

- [ ] **Step 3: Implement the bus with Queue and Deferred**

Use `Queue.bounded(32)`, one `Deferred` per request, `Effect.timeout`, and a
scoped finalizer that marks the service closed, shuts down the queue, and
completes pending Deferreds with `AgentCommandBusUnavailable`. Do not use an
EventEmitter, Promise map, module global, or polling.

- [ ] **Step 4: Write bridge RED tests**

Provide test Layers for controller and bus. Prove:

- inspect and logs are returned without a transport round trip;
- allowed App action dispatch gets an agent source envelope;
- forbidden App shaping fails before controller mutation;
- Shaper proposal-related child operations retain `parentOperationId`; and
- controller errors arrive on the exact caller's Deferred.

- [ ] **Step 5: Implement the scoped bridge**

The bridge takes the controller's current workspace ID, creates a fresh command
ID, dispatches the envelope, and completes the exact Deferred. It handles
requests sequentially by default; controller long work may fork only where an
existing cancellation requirement demands it. Name the consume and dispatch
operations with `Effect.fn` and annotate role, parent operation, and command ID
without logging payloads.

- [ ] **Step 6: Compose the acyclic Layer graph**

Build one shared bus first, provide it to the role-owned shell and
AgentWorkspace, construct the controller, then start the bridge as a scoped
consumer. `ManagedRuntime.make` remains the sole browser runtime boundary.

- [ ] **Step 7: Run GREEN and current control bridge tests**

```bash
bunx vitest run src/axi/agent-command-bus.test.ts src/axi/agent-command-bridge.test.ts src/lib/workspace-control-bridge.test.ts src/lib/runtime.test.ts
```

If `src/lib/runtime.test.ts` does not exist, cover composition through the
exported browser runtime in `src/hooks/use-workspace.test.tsx`; do not add a
source-string test.

- [ ] **Step 8: Review the task diff without committing**

```bash
git diff --check
git diff -- src/axi src/lib/runtime.ts
```

---

### Task 5: Reserved `flect` command inside role-owned just-bash

**Files:**

- Create: `src/shell/flect-command.ts`
- Create: `src/shell/flect-command.test.ts`
- Modify: `src/shell/sandboxed-shell-service.ts`
- Modify: `src/shell/sandboxed-shell.ts`
- Modify: `src/shell/sandboxed-shell.test.ts`
- Modify: `src/lib/agent-workspace.ts`

**Interfaces:**

Extend execution context without trusting environment variables:

```ts
export interface SandboxedAgentContext {
  readonly sessionId: string
  readonly parentOperationId: string
  readonly requestId: string
}

export interface SandboxedShellExecuteOptions {
  readonly signal?: AbortSignal
  readonly agentContext?: SandboxedAgentContext
}
```

The role remains the existing non-user-controlled `execute(role, ...)`
argument. `makeFlectCommand(role, agentContext)` returns a just-bash custom
command backed by `FlectAxiProgram` and `AgentFlectCommandGatewayLive`.

- [ ] **Step 1: Write reserved-command RED tests**

Prove all of the following for both roles:

- `flect` prints `runtime: browser-embedded` and the role-specific home state;
- `flect --help` is concise and role-specific;
- pipes and redirection work;
- `alias flect=false`, a shell function, a `/workspace/flect` file, and PATH
  changes cannot shadow the command;
- `FLECT_ROLE=shaper flect ...` cannot change an App source;
- a missing `agentContext` fails safely rather than creating anonymous
  authority; and
- cancellation maps to exit `1` without stopping the shell workspace.

- [ ] **Step 2: Confirm RED**

```bash
bunx vitest run src/shell/flect-command.test.ts src/shell/sandboxed-shell.test.ts
```

- [ ] **Step 3: Implement the custom command**

Follow the existing reserved `bun` pattern: generate a randomized hidden
command name, register one custom command, and use an AST transform to rewrite
the visible `flect` command. Keep separate hidden names per role workspace.
Pass args as an argv array directly to `FlectAxiProgram`; never reconstruct a
shell command string.

Return `AxiRunResult.stdout`, `stderr`, and `exitCode` through just-bash. AXI
errors remain on command stdout; internal diagnostics remain stderr.

- [ ] **Step 4: Supply authenticated shell-call context**

In `AgentWorkspace.executeShellRequest`, pass the current Pi session ID,
controller operation ID, and Pi shell request ID through
`SandboxedShellExecuteOptions.agentContext`. Do not add them to shell env or
workspace files.

- [ ] **Step 5: Run GREEN and browser Bun regression tests**

```bash
bunx vitest run src/shell/flect-command.test.ts src/shell/sandboxed-shell.test.ts src/shell/bun-command-live.test.ts src/lib/agent-workspace.test.ts
```

- [ ] **Step 6: Review the task diff without committing**

```bash
git diff --check
git diff -- src/shell src/lib/agent-workspace.ts
```

---

### Task 6: Shaper proposal completion through Bash

**Files:**

- Modify: `shared/contracts.ts`, `shared/contracts.test.ts`
- Modify: `shared/bun-command.ts`, `shared/bun-command.test.ts`
- Modify: `server/pi-runtime.ts`, `server/pi-runtime.test.ts`
- Modify: `src/lib/agent-workspace.ts`, `src/lib/agent-workspace.test.ts`
- Modify: `src/lib/workspace-controller.ts`,
  `src/lib/workspace-controller.test.ts`
- Modify: `src/shell/flect-command.ts`, `src/shell/flect-command.test.ts`
- Remove after parity: `server/pi-proposal-tool.ts`,
  `server/pi-proposal-tool.test.ts`

**Interfaces:**

The browser-only `flect interface validate|propose <path>` adapter reads from
the role's existing just-bash `IFileSystem`, parses JSON as unknown, and runs
the same strict `validateInterfaceDocument` boundary. A successful proposal
command produces a bounded internal completion marker associated with the
current Shaper request; only the validated `InterfaceDocument` crosses that
marker.

- [ ] **Step 1: Write RED tests for Shaper CLI proposal flow**

Test a complete Shaper turn whose only Pi tool is Bash:

1. Pi runs `flect interface schema`.
2. Pi writes `/workspace/interface.json`.
3. Pi runs `flect interface validate /workspace/interface.json`.
4. Pi runs `flect interface propose /workspace/interface.json`.
5. The existing outer `submit-shaper-instruction` controller operation creates
   exactly one preview revision.
6. The command returns revision/name/status in TOON.

Also test invalid JSON, schema issues with field paths, path escape, two
proposal calls in one turn, no proposal call, and App attempting the command.

- [ ] **Step 2: Confirm RED**

```bash
bunx vitest run src/shell/flect-command.test.ts src/lib/agent-workspace.test.ts server/pi-runtime.test.ts src/lib/workspace-controller.test.ts
```

- [ ] **Step 3: Add a typed per-turn proposal latch**

Own the latch in AgentWorkspace, keyed by `parentOperationId` and Shaper shell
request ID. The first valid proposal wins; a second returns an idempotent no-op
only when the document is identical and otherwise a conflict. Scope and clear
it around the Shaper turn with `Effect.acquireUseRelease`; never persist it or
expose it to App.

- [ ] **Step 4: Change Pi Shaper from a dedicated proposal tool to Bash**

Update the immutable Shaper instructions to name the exact four commands and
state that `flect interface propose` must be its final action. Build the Shaper
session with only the existing Bash tool. Keep Guardian tool-free and App Bash
unchanged.

Change Shape streaming so a normally completed Pi turn is terminal without
requiring a server-owned proposal tool event. Browser AgentWorkspace requires
the proposal latch before it considers the turn successful. If the first turn
finishes without a valid proposal, issue one bounded corrective prompt in the
same Shaper session; the second miss fails safely.

- [ ] **Step 5: Preserve controller authority**

AgentWorkspace returns the validated latched candidate to the existing outer
controller command. The controller alone calls `ShapingKernel.propose`, emits
the revision transition, and completes the parent operation. The latch is not
revision state and cannot accept or activate its own candidate.

- [ ] **Step 6: Remove the old Pi tool after parity**

When all focused tests pass with Shaper configured as Bash-only, remove
`pi-proposal-tool.ts`, its tests/imports, TypeBox proposal schema, and old
`proposal_submitted` private event paths. Keep public validation-failure events
if the UI still consumes them; now create them from CLI validation failures.

- [ ] **Step 7: Run GREEN and Pi smoke**

```bash
bunx vitest run server/pi-runtime.test.ts server/pi-shell-bridge.test.ts src/lib/agent-workspace.test.ts src/lib/workspace-controller.test.ts src/shell/flect-command.test.ts shared/contracts.test.ts shared/bun-command.test.ts
bun run test:pi-smoke
```

The credential-dependent smoke may report setup-required when Pi is not
authenticated; that is not a pass. Before final completion, run it with the
already configured Pi authentication and require the documented success.

- [ ] **Step 8: Review the task diff without committing**

```bash
git diff --check
rg -n "propose_interface|pi-proposal-tool" server src shared
```

Expected after removal: no active Pi tool or instruction references remain.

---

### Task 7: App action invocation through embedded Bash

**Files:**

- Modify: `src/axi/program.ts`, `src/axi/program.test.ts`
- Modify: `src/axi/agent-command-bridge.ts`,
  `src/axi/agent-command-bridge.test.ts`
- Modify: `src/lib/workspace-controller.ts`,
  `src/lib/workspace-controller.test.ts`
- Modify: `src/components/interface-renderer.tsx` only if action projection is
  currently UI-local

**Interfaces:**

- `flect action list` projects visible action node ID, label, action type, and
  availability from the accepted validated document.
- `flect action inspect <node-id>` returns declaration and current grant state.
- `flect action invoke <node-id>` dispatches the existing
  `InvokeInterfaceAction` command as an App agent child operation.

- [ ] **Step 1: Write RED tests**

Prove list has definitive zero state, invoke returns combined action outcome
and post-state, missing node is structured exit `1`, and an App source cannot
invoke an action absent from the accepted document or lacking its capability
grant. Shaper invocation must be denied.

- [ ] **Step 2: Confirm RED**

```bash
bunx vitest run src/axi/program.test.ts src/axi/agent-command-bridge.test.ts src/lib/workspace-controller.test.ts
```

- [ ] **Step 3: Move action discovery behind controller projection**

Do not parse React DOM. Reuse the controller's validated `InterfaceDocument`
walk and capability broker state. Expose one typed projection used by React and
AXI so label/availability cannot drift.

- [ ] **Step 4: Link child operation evidence**

The nested action operation records `AgentCommandSource.parentOperationId`,
role `app`, session ID, and shell request ID. Do not log prompt, bearer, or raw
action payload. The parent turn remains interruptible.

- [ ] **Step 5: Run GREEN**

```bash
bunx vitest run src/axi/program.test.ts src/axi/agent-command-bridge.test.ts src/lib/workspace-controller.test.ts src/components/interface-renderer.test.tsx
```

- [ ] **Step 6: Review the task diff without committing**

```bash
git diff --check
git diff -- src/axi src/lib/workspace-controller.ts src/components/interface-renderer.tsx
```

---

### Task 8: One native `flect` executable with AXI and MCP modes

**Files:**

- Create: `server/sidecar-mode.ts`, `server/sidecar-mode.test.ts`
- Modify: `server/sidecar.ts`
- Modify: `cli/flect-mcp.ts`, `cli/flect-mcp.test.ts`
- Modify: `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- Modify: `scripts/build-sidecar.ts`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `package.json`

**Interfaces:**

Private runtime modes are exactly `rpc`, `axi`, and `mcp`. The Rust host passes
one private mode marker before user arguments; unknown private modes fail
closed.

- [ ] **Step 1: Write sidecar mode RED tests**

Test no args selects RPC, `--flect-private-mode=axi` selects AXI and strips
only that marker, `mcp` selects MCP, and unknown/duplicate markers fail with a
typed startup error.

- [ ] **Step 2: Write Rust dispatch RED tests**

Extract a pure `select_launch_mode(args, stdin_is_terminal)` function and test:

- Finder-like no-tty/no-args -> GUI;
- terminal/no-args -> AXI;
- `app` -> GUI;
- `mcp` -> MCP;
- every other command -> AXI; and
- private mode flags supplied by users are rejected.

- [ ] **Step 3: Confirm RED**

```bash
bunx vitest run server/sidecar-mode.test.ts cli/flect-mcp.test.ts
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Implement one multi-mode Bun runtime**

Refactor `server/sidecar.ts` so it constructs exactly one selected Layer:

- RPC: existing Effect RPC server, control broker, and Pi runtime;
- AXI: `runFlectCli` with `BrokerFlectCommandGatewayLive`; or
- MCP: exported `serveFlectMcp` with the same broker gateway.

Keep `registerBunOAuthFlows()` in modes that need Pi/runtime provider support.
Do not start RPC or Pi for a broker-only AXI/MCP client.

- [ ] **Step 5: Implement the Rust public dispatcher**

Before `flect_lib::run()`, use `std::io::IsTerminal` to select mode. AXI/MCP
locate sibling `flect-runtime`, inherit stdio, pass the private marker plus
arguments, and propagate exit status. Rust recognizes only host lifecycle
`app`; it does not parse domain flags or render output.

- [ ] **Step 6: Build only the private runtime helper**

Change `scripts/build-sidecar.ts` to one compile target:

```text
src-tauri/binaries/flect-runtime-aarch64-apple-darwin
```

Remove `binaries/flectctl` and `binaries/flect-mcp` from Tauri `externalBin`.
Package scripts expose `flect` and `flect:mcp` for source development, both
through the shared modules, without compiling public companion executables.

- [ ] **Step 7: Run GREEN and inspect the bundle**

```bash
bunx vitest run server/sidecar-mode.test.ts cli/flect.test.ts cli/flect-mcp.test.ts
cargo test --manifest-path src-tauri/Cargo.toml
bun run build:sidecar
bun run build:desktop -- --bundles app
find src-tauri/target/release/bundle/macos/Flect.app/Contents/MacOS -maxdepth 1 -type f -print
```

Expected files include `flect` and `flect-runtime`; `flectctl` and `flect-mcp`
must be absent.

- [ ] **Step 8: Review the task diff without committing**

```bash
git diff --check
git diff -- server cli src-tauri scripts/build-sidecar.ts package.json
```

---

### Task 9: Safe command-line link and opt-in agent integrations

**Files:**

- Create: `src/lib/agent-integration.ts`,
  `src/lib/agent-integration.test.ts`
- Create: `assets/agent-integrations/opencode/flect.js`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri-transport.ts`, `src/lib/tauri-transport.test.ts`
- Modify: `src/components/diagnostics-panel.tsx`,
  `src/components/diagnostics-panel.test.tsx`
- Modify: `src/axi/program.ts`, `src/axi/program.test.ts`

**Interfaces:**

- Native host commands inspect/install/remove only the fixed user link
  `~/.local/bin/flect` targeting the current installed app executable.
- Agent integrations implement `status`, `install`, and `remove` for `codex`,
  `claude`, and `opencode` against an injected configuration root.

- [ ] **Step 1: Write Rust link lifecycle RED tests**

Using a temporary directory and explicit current-executable fixture, prove
install creates the parent and symlink, reinstall is a no-op, repair updates a
stale Flect-owned link, a regular file or foreign link is never overwritten,
and removal deletes only a link targeting Flect.

- [ ] **Step 2: Write agent integration RED tests**

Use temporary roots; never inspect or modify the developer's real config.
Assert exact idempotent merge/remove behavior:

- Codex: `.codex/hooks.json`, `SessionStart` matcher
  `startup|resume|clear|compact`, command `flect context --host codex`, and
  `additionalContextLimit: 1200`; preserve unrelated hook groups.
- Claude Code: `.claude/settings.local.json`, the same SessionStart matcher,
  command `flect context --host claude`, and preserved unrelated settings.
- OpenCode: `.opencode/plugins/flect.js`, a dependency-free V2 plugin with ID
  `dev.akua.flect-context`; its request hook adds the bounded output of
  `flect context --host opencode` to `event.system` once per session and after
  a compaction signal; preserve unrelated plugins/config.

Removal must delete only entries carrying Flect's stable ID/description and
leave user-authored commands untouched even when text is similar.

- [ ] **Step 3: Confirm RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
bunx vitest run src/lib/agent-integration.test.ts src/lib/tauri-transport.test.ts src/axi/program.test.ts
```

- [ ] **Step 4: Implement the fixed native link capability**

Use Tauri's home-directory resolver and Rust symlink APIs. Accept no arbitrary
source/destination from WebView or CLI. Return a typed status containing
`absent`, `installed`, `stale`, or `conflict` plus the public link path. Expose
buttons in Diagnostics with exact confirmation copy and browser-unavailable
state.

- [ ] **Step 5: Implement Effect-owned config mutations**

Define a platform file capability injected in tests. Decode existing JSON as
unknown through strict schemas that preserve unrelated JSON values while
validating the owned subtree. Write atomically with private user permissions.
Do not invoke host agent CLIs or interactive installers.

Use current authoritative formats verified on 2026-07-31:

- Codex hooks documentation in the current Codex manual;
- Claude Code hooks at <https://code.claude.com/docs/en/hooks>; and
- OpenCode V2 plugin request hooks at
  <https://opencode.ai/v2/docs/build/plugins>.

- [ ] **Step 6: Implement `context` and setup commands**

`flect context --host <host>` emits a static discovery line plus bounded live
workspace state and role/action suggestions; it never emits the control bearer.
`flect setup agent install|remove <host>` uses the Effect integration service.
`flect setup status` reports shell and all agent integrations with definitive
states.

- [ ] **Step 7: Run GREEN**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
bunx vitest run src/lib/agent-integration.test.ts src/lib/tauri-transport.test.ts src/components/diagnostics-panel.test.tsx src/axi/program.test.ts
```

- [ ] **Step 8: Review the task diff without committing**

```bash
git diff --check
git diff -- src/lib/agent-integration.ts src-tauri/src/lib.rs src/components/diagnostics-panel.tsx assets/agent-integrations
```

---

### Task 10: Generated Flect skill and durable repository rules

**Files:**

- Create: `scripts/generate-flect-skill.ts`
- Create: `scripts/generate-flect-skill.test.ts`
- Create: `.agents/skills/flect/SKILL.md`
- Modify: `package.json`
- Modify: `AGENTS.md`

**Interfaces:**

- `generateFlectSkill({ check })` renders static agent guidance from the same
  command metadata used by AXI help/home output.
- `bun run check:flect-skill` fails if the committed skill is stale.

- [ ] **Step 1: Write deterministic generation RED tests**

Assert the generated skill has trigger-shaped frontmatter, names the public
`flect` command, explains content-first discovery and role limits, contains no
live workspace IDs/models/control state, and exactly matches the checked-in
file. Mutating command metadata in the fixture must make check mode fail.

- [ ] **Step 2: Confirm RED**

```bash
bunx vitest run scripts/generate-flect-skill.test.ts
```

- [ ] **Step 3: Implement generation and check scripts**

Export static command metadata from `src/axi/command.ts`; do not scrape source
or shell out to the built CLI. Generate through Effect file services and write
with `apply_patch` during development. Add `check:flect-skill` to `check`.

- [ ] **Step 4: Add the concise permanent rule to AGENTS.md**

State that all agent-facing command surfaces must follow AXI, use the shared
Effect command/controller authority, default to bounded TOON, preserve stable
exit/channel behavior, and update the generated skill when command metadata
changes. Link to `docs/local-control.md` and the design; do not duplicate the
command catalog.

- [ ] **Step 5: Run GREEN**

```bash
bunx vitest run scripts/generate-flect-skill.test.ts
bun run check:flect-skill
```

- [ ] **Step 6: Review the task diff without committing**

```bash
git diff --check
git diff -- scripts/generate-flect-skill.ts .agents/skills/flect/SKILL.md AGENTS.md package.json
```

---

### Task 11: Real-browser AXI and reactive UI verification

**Files:**

- Create: `tests/e2e/embedded-axi.spec.ts`
- Modify: `tests/e2e/flect.spec.ts`
- Modify: `server/test-runtime.ts`
- Modify: `playwright.config.ts`

**Interfaces:**

- Test runtime supplies deterministic Pi turns that issue real Bash commands
  through the same RPC/shell bridge as production.
- Tests inspect behavior through UI accessibility, public HTTP/SSE, and
  command results, never private React state or direct storage mutation.

- [ ] **Step 1: Write the browser RED scenarios**

Add Playwright scenarios that prove:

1. Shaper runs embedded `flect`, validates a file, proposes it, and the preview
   appears reactively without reload.
2. Shaper's attempt to accept the proposal returns structured unauthorized
   output and the protected Keep button remains a user decision.
3. After Keep and Run mode, App lists and invokes a visible action through
   embedded `flect`; the result appears in both activity and product UI.
4. App attempts to shape or enter safe mode and is denied.
5. Role spoofing through env, alias, function, file, and PATH fails.
6. TOON output passes through `grep`, `head`, and redirection in just-bash.
7. Tool use is visible with command, phase, bounded result, duration, and
   failure state.
8. Manual upward scrolling is not stolen by streamed CLI/tool activity.

- [ ] **Step 2: Confirm RED in a real production Chromium build**

```bash
bunx playwright test tests/e2e/embedded-axi.spec.ts --project=chromium
```

Expected: new AXI scenarios fail before the deterministic runtime supports
their command trajectories.

- [ ] **Step 3: Extend only the deterministic test runtime inputs needed**

Emit the same `AgentShellRequest`, completion, and stream contracts used by
production. Do not add a DOM test hook or bypass `SandboxedShell`.

- [ ] **Step 4: Run GREEN and full browser suite**

```bash
bunx playwright test tests/e2e/embedded-axi.spec.ts --project=chromium
bun run test:e2e
```

Expected: all Chromium tests pass with zero unexpected console errors, page
errors, or failed local application requests.

- [ ] **Step 5: Review the task diff without committing**

```bash
git diff --check
git diff -- tests/e2e server/test-runtime.ts playwright.config.ts
```

---

### Task 12: Release packaging, documentation, installed-app dogfood, and completion audit

**Files:**

- Modify: `scripts/package-release.ts`, `scripts/package-release.test.ts`
- Modify: `scripts/smoke-pi.ts`
- Modify: `ARCHITECTURE.md`
- Modify: `CONTRIBUTING.md`
- Modify: `README.md`
- Modify: `VISION.md` only if current-slice wording changes
- Modify: `docs/local-control.md`
- Modify: `docs/trust-model.md`
- Modify: `docs/verification/*`

**Interfaces:**

- Release layout requires only app, DMG, demo/checksum assets, and the private
  runtime helper inside the app.
- The public smoke path invokes `Flect.app/Contents/MacOS/flect`; no test or
  documentation invokes `flectctl` or `flect-mcp`.

- [ ] **Step 1: Write release-layout RED tests**

Change `ReleaseLayout` to remove `cli` and `mcp`. Assert validation succeeds
with `flect` plus `flect-runtime`, fails without either, and explicitly fails
when forbidden sibling executables `flectctl` or `flect-mcp` are present in
`Contents/MacOS`.

- [ ] **Step 2: Confirm RED**

```bash
bunx vitest run scripts/package-release.test.ts
```

- [ ] **Step 3: Update release and smoke mechanics**

Remove companion-binary paths/copies/checks. Package one app/DMG. Change smoke
commands to the public executable's AXI and MCP modes. Never print the control
descriptor or bearer.

- [ ] **Step 4: Update documentation ownership after implementation exists**

- `ARCHITECTURE.md`: verified one-public-executable topology, embedded agent
  bus, reserved command, Bash proposal, and role policy.
- `docs/local-control.md`: complete AXI command/reference, TOON/JSON behavior,
  exit codes, MCP mode, shell link, setup install/remove, and browser limits.
- `docs/trust-model.md`: external versus captured-agent authority and failure
  boundaries.
- `CONTRIBUTING.md`: current build/test/bundle/dogfood commands and exact bundle
  contents.
- `README.md`: concise install, enable-control, `flect` home, browser embedded
  use, and links; do not duplicate the full catalog.
- `VISION.md`: only update the implemented-slice paragraph, not the durable
  destination.

- [ ] **Step 5: Run the complete credential-free verification**

```bash
bun run check:all
bun run release:verify
```

Require clean success for Effect pin check, Rifty check, Biome, TypeScript,
Vitest, Playwright Chromium, Rust tests, and release-mode app build.

- [ ] **Step 6: Build and install the app**

```bash
bun run build:desktop -- --bundles app
```

Move the existing `/Applications/Flect.app` to a timestamped backup location
only if replacement cannot be done atomically; do not delete it. Install the
new verified bundle at `/Applications/Flect.app`, then open it with macOS
LaunchServices.

- [ ] **Step 7: Dogfood public native AXI**

After enabling Local control through the protected UI, run:

```bash
/Applications/Flect.app/Contents/MacOS/flect
/Applications/Flect.app/Contents/MacOS/flect inspect
/Applications/Flect.app/Contents/MacOS/flect shape "Create a compact project dashboard"
/Applications/Flect.app/Contents/MacOS/flect logs --limit 20
```

Verify TOON, exact terminal outcomes, reactive preview in the open app, visible
operation/tool evidence, and no bearer/credential output.

- [ ] **Step 8: Dogfood embedded browser AXI and MCP**

Use a live Shaper turn that runs `flect interface propose`, keep it as the user,
then use a live App turn that runs `flect action list`. Run a real MCP stdio
initialize/list/call exchange through:

```bash
/Applications/Flect.app/Contents/MacOS/flect mcp
```

Capture bounded verification evidence in `docs/verification/` without secrets.

- [ ] **Step 9: Audit every objective requirement**

Create a table mapping each acceptance criterion in the design to authoritative
evidence: source contract, focused test, full gate output, bundle listing,
browser trace/screenshot, native command output, or installed-app observation.
Treat missing or indirect evidence as incomplete and continue implementation.

- [ ] **Step 10: Run stale-name and secret scans**

```bash
rg -n "flectctl|flect-mcp" --glob '!docs/superpowers/**' --glob '!docs/verification/**' .
rg -n "Bearer |Authorization:|api[_-]?key|access[_-]?token" docs/verification dist-release 2>/dev/null
git diff --check
git status --short
```

Only deliberate historical migration references may remain outside active
implementation/user documentation. Inspect every secret-shaped match.

- [ ] **Step 11: Review the full diff without committing**

```bash
git diff --stat
git diff --check
git status --short
```

Do not commit, push, merge, publish, or create a release until the user gives
that separate authorization.

---

## Plan self-review

### Spec coverage

- One public native executable: Tasks 8 and 12.
- No public `flectctl`/`flect-mcp`: Tasks 2, 8, and 12.
- AXI/TOON semantics: Tasks 1, 2, and 10.
- One Effect command/state path: Tasks 3 and 4.
- Browser-reserved command and role source capture: Task 5.
- Shaper and App drive Flect through Bash: Tasks 6 and 7.
- Guardian/tool and sandbox boundaries: Tasks 3, 5, and 6.
- MCP/HTTP compatibility: Tasks 2, 4, and 8.
- Shell link and Codex/Claude/OpenCode opt-in integrations: Task 9.
- Generated Agent Skill and durable rule: Task 10.
- Real-browser, native, package, install, open, and dogfood evidence: Tasks 11
  and 12.
- Documentation ownership and completion audit: Task 12.

### Type consistency

- `AxiRunResult` is produced only by the AXI formatter/program and consumed by
  process/just-bash adapters.
- `FlectCommandGateway` is the sole command program dependency; broker and
  agent implementations share its exact shape.
- `AgentCommandSource` is created by the sandbox adapter and enforced by the
  controller.
- `AgentCommandBus` carries typed gateway operations and exact Deferred
  results; it is not persisted or schema-encoded.
- Shaper's proposal latch holds only an already validated InterfaceDocument;
  ShapingKernel remains revision authority.

### Placeholder scan

The plan contains no TBD/TODO/later placeholders. Conditional removal steps
have explicit parity gates and commands. The only conditional smoke outcome is
called out as not-a-pass and must be resolved before completion.
