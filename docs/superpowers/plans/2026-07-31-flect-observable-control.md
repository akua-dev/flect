# Flect Observable Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flect's live workspace reliable, observable, user-respecting,
and fully controllable by an explicitly authorized local CLI, JSON/SSE API, or
MCP client through the same Effect command authority used by the UI.

**Architecture:** One schema-defined `FlectWorkspaceController` in the
connected browser/WebView owns semantic commands and publishes one reactive
snapshot and event stream. The Bun runtime owns only an authenticated,
lifecycle-scoped loopback broker that forwards commands to the connected
workspace; React, HTTP, CLI, and MCP remain adapters rather than alternate
state machines. Pi emits exact proposal and tool lifecycle events, while a
bounded in-memory `OperationJournal` keeps safe correlated evidence.

**Tech Stack:** TypeScript 7, Bun, Effect 4 beta, Effect Schema/Layer/Stream/
SubscriptionRef/Queue/Scope, Pi SDK, TypeBox, React 19, Effect HTTP/RPC,
Tauri 2, Vitest with `@effect/vitest`, Playwright, Rust tests.

## Global Constraints

- Preserve all existing uncommitted T3 Code UX, Markdown, and verification
  work.
- Do not commit, push, merge, publish, or release without separate authority.
- External control is loopback-only, disabled by default, explicitly enabled
  in the protected UI, authenticated by a rotating 256-bit capability, and
  immediately revocable.
- No outside client may enable or expand its own authority.
- The connected Flect workspace remains authoritative; the broker stores no
  shadow revision, conversation, model, or UI state.
- Every external value crosses an Effect Schema boundary with strict excess
  property rejection.
- Use `Schema.Class`, `Schema.TaggedClass`, and `Schema.TaggedErrorClass` for
  reusable contracts; use `.make(...)`, never unsafe casts or `any`.
- Define services with `Context.Service`, construct them in named Layers,
  provide dependencies at composition edges, and use `ManagedRuntime` only at
  host boundaries.
- Use `Effect.fn` for named business operations, `SubscriptionRef` for
  reactive state, `Stream` for events, `Queue`/`Deferred` for command
  hand-off, and `Effect.acquireRelease`/Scope for broker and session cleanup.
- Pi provider credentials and bearer capabilities never enter logs, events,
  screenshots, model context, argv, or API response bodies.
- App Agent, Shaper, and Guardian remain separate Pi roles; their sandbox and
  extension policies remain intact.
- The browser remains a first-class runtime; no feature may require a
  machine-installed shell, Git, Bun, or native binary.
- Operation history is in-memory only, bounded to 500 entries and 2 MiB, and
  contains safe summaries rather than full prompt, output, or credential data.
- Sticky follow uses a 48 px bottom threshold, suspends after the user moves
  away, never steals focus, and exposes a keyboard-operable “Jump to latest”
  control.
- Test observable behavior through public services, HTTP/RPC contracts, DOM
  semantics, CLI output, and real browser/native flows.

---

## File Structure

### Shared contracts

- `shared/control.ts` — versioned command envelope, command union, snapshots,
  events, receipts, operation records, client metadata, and protocol errors.
- `shared/contracts.ts` — Pi turn/tool/proposal event contracts shared by HTTP,
  RPC, browser, and desktop.
- `shared/rpc.ts` — private desktop workspace-channel RPCs in addition to the
  existing Pi runtime RPCs.

### Pi runtime

- `server/pi-proposal-tool.ts` — exact TypeBox proposal tool and safe Effect
  validation diagnostic mapping.
- `server/pi-runtime.ts` — registers proposal and Bash tools, streams their
  lifecycle, performs one bounded corrective retry, and preserves sessions on
  validation failure.
- `server/test-runtime.ts` — deterministic equivalents of the new events.

### Connected workspace

- `src/lib/operation-journal.ts` — bounded `OperationJournal` service.
- `src/lib/agent-workspace.ts` — Effect-owned App/Shaper session lifecycle and
  role timelines extracted from the React hook.
- `src/lib/workspace-controller.ts` — sole semantic command/state authority.
- `src/lib/workspace-control-bridge.ts` — browser HTTP and desktop RPC bridge
  adapters that register the workspace, deliver commands, and publish
  snapshots/events/receipts.
- `src/hooks/use-workspace.ts` — thin React subscription and dispatch adapter.
- `src/lib/runtime.ts` — one composed browser application runtime.

### Interface

- `src/components/activity-card.tsx` — live tool and operation instruments.
- `src/components/diagnostics-panel.tsx` — filters and safe structured detail.
- `src/hooks/use-sticky-follow.ts` — per-role viewport-follow policy.
- `src/components/agent-rail.tsx` — consumes controller state and new
  instruments without re-owning workflow state.
- `src/components/role-aware-shell.tsx` — protected control toggle and client
  visibility.
- `src/app.tsx` — renders controller snapshot and dispatches typed commands.
- `src/styles.css` — activity, diagnostics, sticky-follow, and attribution
  styling.

### Local broker and adapters

- `server/control-descriptor.ts` — secure descriptor path, encode/decode,
  permissions, stale-instance rejection, and cleanup.
- `server/control-broker.ts` — scoped token, queue, state cache, waiters,
  external loopback listener, and workspace registration.
- `server/control-http.ts` — authenticated JSON/SSE external API.
- `server/app.ts` — protected browser workspace-channel routes.
- `server/rpc-handlers.ts` — private desktop workspace-channel handlers.
- `server/index.ts` and `server/sidecar.ts` — compose one shared broker layer.
- `cli/flect-client.ts` — descriptor discovery and schema-safe HTTP/SSE client.
- `cli/flectctl.ts` — human and JSON CLI.
- `cli/flect-mcp.ts` — MCP stdio adapter over the same client.
- `scripts/build-sidecar.ts`, `src-tauri/tauri.conf.json`, and release
  packaging files — build and bundle `flectctl`.

### Verification and documentation

- Unit tests adjacent to every new module.
- `tests/e2e/flect.spec.ts` — real browser UI behavior.
- `tests/e2e/control-plane.spec.ts` — browser plus real `flectctl`.
- `tests/e2e/native-control.spec.ts` or the existing native smoke harness —
  packaged-app control.
- `ARCHITECTURE.md`, `DESIGN.md`, `PRODUCT.md`, `README.md`, `VISION.md`, and
  `AGENTS.md` — only the information owned by each document.
- `docs/verification/flect-observable-control/` — commands, screenshots, safe
  logs, and final evidence.

---

### Task 1: Define the versioned command, snapshot, event, and error contracts

**Files:**
- Create: `shared/control.ts`
- Create: `shared/control.test.ts`
- Modify: `shared/contracts.ts`
- Modify: `shared/contracts.test.ts`

**Interfaces:**
- Produces:
  - `FlectCommandEnvelope`
  - `FlectCommand`
  - `FlectWorkspaceSnapshot`
  - `FlectWorkspaceEvent`
  - `FlectCommandReceipt`
  - `FlectCommandError`
  - `OperationRecord`
  - `ToolActivity`
  - `ControlClientSummary`
- Consumes: existing `InterfaceDocument`, `InteractiveAgentRole`,
  `ModelSummary`, `ShapingSnapshot`, and shell result summaries.

- [ ] **Step 1: Write failing schema round-trip and rejection tests**

```ts
it.effect("round-trips every command and rejects unknown fields", () =>
  Effect.gen(function* () {
    const value = FlectCommandEnvelope.make({
      version: 1,
      commandId: "cmd-00000001",
      workspaceId: "workspace-00000001",
      source: UserCommandSource.make({ kind: "user" }),
      command: SubmitShaperInstruction.make({
        type: "submit-shaper-instruction",
        instruction: "Make the headline quieter"
      })
    })
    const encoded = yield* Schema.encodeEffect(FlectCommandEnvelope)(value)
    const decoded = yield* decodeFlectCommandEnvelope(encoded)
    assert.deepStrictEqual(decoded, value)
    const exit = yield* Effect.exit(
      decodeFlectCommandEnvelope({ ...encoded, invented: true })
    )
    assert.isTrue(Exit.isFailure(exit))
  })
)
```

Add table-driven cases for all commands and prove:

- control sources require `clientId` and `clientName`;
- `enable-control` decodes but is later authorizable only for user sources;
- instruction, prompt, width, identifier, and log-detail bounds hold;
- unknown command tags, button actions, and excess keys fail closed.

- [ ] **Step 2: Run the focused tests and confirm red**

Run:

```bash
bunx vitest run shared/control.test.ts shared/contracts.test.ts
```

Expected: FAIL because the new schemas and event variants do not exist.

- [ ] **Step 3: Implement reusable named schemas and tagged unions**

Use this public shape:

```ts
export class FlectCommandEnvelope extends Schema.Class<FlectCommandEnvelope>(
  "FlectCommandEnvelope"
)({
  version: Schema.Literal(1),
  commandId: CommandId,
  workspaceId: WorkspaceId,
  source: FlectCommandSource,
  expectedSequence: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  command: FlectCommand
}) {}

export const decodeFlectCommandEnvelope = Schema.decodeUnknownEffect(
  FlectCommandEnvelope,
  { errors: "all", onExcessProperty: "error" }
)
```

Define each command as a `Schema.TaggedClass` with its literal `type`.
Represent expected protocol failures as `Schema.TaggedErrorClass` variants:
`InvalidControlCommand`, `ControlUnauthorized`, `WorkspaceUnavailable`,
`CommandConflict`, `CommandRejected`, and `OperationFailed`.

Extend Pi events with exact, bounded variants:

```ts
ToolExecutionStarted
ToolExecutionUpdated
ToolExecutionCompleted
ProposalValidationFailed
```

Tool records carry role, call ID, tool name, phase, started/completed
timestamps, duration, bounded command/result summaries, exit code, and optional
preview URL; no raw credentials or unlimited output.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bunx vitest run shared/control.test.ts shared/contracts.test.ts
bun run typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Inspect the diff for duplicate contracts**

```bash
rg -n "FlectCommandEnvelope|OperationRecord|ToolActivity" shared src server
git diff --check
```

Expected: each reusable contract has one shared source of truth and
`git diff --check` prints nothing.

### Task 2: Replace free-form Shaper JSON with a terminating proposal tool

**Files:**
- Create: `server/pi-proposal-tool.ts`
- Create: `server/pi-proposal-tool.test.ts`
- Modify: `server/pi-runtime.ts`
- Modify: `server/pi-runtime.test.ts`
- Modify: `server/test-runtime.ts`
- Modify: `server/test-runtime.test.ts` if present

**Interfaces:**
- Consumes: `InterfaceDocument`, `validateInterfaceDocument`,
  `ProposalValidationFailed`, and Pi `defineTool`.
- Produces:
  - `makePiProposalTool(onEvent)`
  - `InterfaceProposalValidationError`
  - shape streams that terminate only after a validated proposal or one
    bounded corrective retry.

- [ ] **Step 1: Write failing exact-schema and diagnostic tests**

```ts
it.effect("accepts only an exact InterfaceDocument proposal", () =>
  Effect.gen(function* () {
    const capture = yield* makeProposalCapture()
    const tool = yield* makePiProposalTool(capture.emit)
    const result = yield* Effect.promise(() =>
      tool.execute("tool-1", { document: validDocument }, undefined)
    )
    assert.strictEqual(result.details.status, "accepted")
    assert.deepStrictEqual(yield* capture.proposal, validDocument)
  })
)
```

Also prove that missing `text.style`, invented button actions,
`agent-panel.children`, missing `agent-panel.title`, excess properties,
oversized trees, and reused node IDs produce safe issues such as:

```ts
{
  path: ["root", "children", 0, "style"],
  code: "required",
  message: "Required field is missing."
}
```

- [ ] **Step 2: Run focused tests and confirm red**

```bash
bunx vitest run server/pi-proposal-tool.test.ts server/pi-runtime.test.ts
```

Expected: FAIL because `propose_interface` and validation issue events are
absent.

- [ ] **Step 3: Implement the TypeBox tool from the exact closed UI schema**

Define `propose_interface` with:

```ts
defineTool({
  name: "propose_interface",
  label: "Propose interface",
  description: "Submit one complete Flect InterfaceDocument.",
  parameters: Type.Object(
    { document: interfaceDocumentTypeBox },
    { additionalProperties: false }
  ),
  executionMode: "sequential",
  terminate: true,
  promptSnippet: "Use propose_interface for the final complete interface.",
  promptGuidelines: [
    "Never invent node fields, node types, or button actions.",
    "Every text node requires style.",
    "Only stack nodes have children."
  ],
  execute
})
```

Validate again with Effect Schema inside `execute`; TypeBox is model guidance,
not the application trust boundary. Convert `SchemaError` issues to bounded
safe paths and reasons.

- [ ] **Step 4: Register tool lifecycle events and one corrective retry**

In `server/pi-runtime.ts`:

- subscribe to Pi `tool_execution_start`, `tool_execution_update`, and
  `tool_execution_end`;
- emit the shared lifecycle variants for Bash and proposal tools;
- retain the Shaper Pi session when proposal validation fails;
- append the safe validation issues as the single retry instruction;
- permit exactly one retry per shape command;
- return `ProposalValidationFailed` after the second invalid proposal;
- remove the broad first-`{`/last-`}` JSON extraction path.

- [ ] **Step 5: Update deterministic runtime fixtures**

Make the test runtime emit the same event order:

```text
turn/tool started -> proposal tool started -> proposal tool completed
-> shape completed
```

Add an instruction keyword used only by tests that yields a controlled
validation failure event without weakening production validation.

- [ ] **Step 6: Run focused runtime tests and the real Pi smoke**

```bash
bunx vitest run server/pi-proposal-tool.test.ts server/pi-runtime.test.ts server/app.test.ts server/rpc-handlers.test.ts
bun run test:pi-smoke
```

Expected: unit tests PASS; real Pi smoke returns one validated document and no
generic parse failure.

### Task 3: Add the bounded structured operation journal

**Files:**
- Create: `src/lib/operation-journal.ts`
- Create: `src/lib/operation-journal.test.ts`

**Interfaces:**
- Consumes: `OperationRecord`, `FlectWorkspaceEvent`, `ToolActivity`.
- Produces:

```ts
interface OperationJournalShape {
  readonly snapshot: Effect.Effect<ReadonlyArray<OperationRecord>>
  readonly changes: Stream.Stream<ReadonlyArray<OperationRecord>>
  readonly append: (
    event: OperationJournalInput
  ) => Effect.Effect<OperationRecord>
  readonly query: (
    filter: OperationFilter
  ) => Effect.Effect<ReadonlyArray<OperationRecord>>
}
```

- [ ] **Step 1: Write failing retention, correlation, and redaction tests**

Test:

- lifecycle order and monotonic sequence;
- `operationId`, `commandId`, `sessionId`, `toolCallId`, and revision
  correlation;
- eviction at 500 records;
- eviction before encoded size exceeds 2 MiB;
- query filters for role, status, operation, tool, revision, client, and
  failures;
- rejection/redaction of bearer tokens, authorization headers, provider
  secrets, and full prompts.

- [ ] **Step 2: Run and confirm red**

```bash
bunx vitest run src/lib/operation-journal.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service with `SubscriptionRef`**

Construct one named layer with:

```ts
export class OperationJournal extends Context.Service<
  OperationJournal,
  OperationJournalShape
>()("flect/OperationJournal") {}

export const OperationJournalLive = Layer.effect(
  OperationJournal,
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make(JournalState.empty())
    // append/query/snapshot/changes
    return implementation
  })
)
```

Use `Schema.encodeEffect(OperationRecord)` to count encoded bytes. Redact at
the append boundary, not in renderers.

- [ ] **Step 4: Run focused tests**

```bash
bunx vitest run src/lib/operation-journal.test.ts
bun run typecheck
```

Expected: PASS.

### Task 4: Extract Pi session and role state into an Effect service

**Files:**
- Create: `src/lib/agent-workspace.ts`
- Create: `src/lib/agent-workspace.test.ts`
- Modify: `src/hooks/use-agent-session.ts`
- Modify: `src/hooks/use-agent-session.test.tsx`

**Interfaces:**
- Consumes: `FlectClient`, `SandboxedShell`, `OperationJournal`,
  `SessionSelection`, and the new Pi events.
- Produces:

```ts
interface AgentWorkspaceShape {
  readonly snapshot: Effect.Effect<AgentWorkspaceSnapshot>
  readonly changes: Stream.Stream<AgentWorkspaceSnapshot>
  readonly refresh: Effect.Effect<void, AgentWorkspaceError>
  readonly selectModel: (
    selection: ModelSelection | undefined
  ) => Effect.Effect<void, AgentWorkspaceError>
  readonly toggleExternalExtensions: (
    role: InteractiveAgentRole
  ) => Effect.Effect<void, AgentWorkspaceError>
  readonly submitAppPrompt: (
    operation: OperationContext,
    text: string
  ) => Effect.Effect<void, AgentWorkspaceError>
  readonly submitShaperInstruction: (
    operation: OperationContext,
    instruction: string,
    document: InterfaceDocument
  ) => Effect.Effect<InterfaceDocument, AgentWorkspaceError>
  readonly cancel: (
    role: InteractiveAgentRole
  ) => Effect.Effect<void, AgentWorkspaceError>
}
```

- [ ] **Step 1: Port current hook behavior into failing service tests**

Cover session reuse, model-change session replacement, per-role busy guards,
App/Shaper concurrency, cancellation, shell completion, extension selection,
setup-required/unavailable states, tool activity updates, validation failure
without session closure, and scoped finalization.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
bunx vitest run src/lib/agent-workspace.test.ts
```

Expected: FAIL because `AgentWorkspace` is absent.

- [ ] **Step 3: Implement `AgentWorkspaceLive`**

Move session handles, role fibers, cancellation flags, models, selections,
messages, and tool activity into one `SubscriptionRef`. Use:

```ts
Effect.acquireRelease(createOrReuseSession, closeSession)
Fiber.interrupt
Effect.onInterrupt
Stream.runForEach
```

Tool start creates an activity; update changes the same call ID; end records
duration and bounded result. A proposal validation error becomes a structured
Shaper timeline item and does not release an otherwise healthy Pi session.

- [ ] **Step 4: Reduce the React hook to a compatibility adapter**

Until Task 6 removes it from `App`, make `useAgentSession` subscribe to
`AgentWorkspace.changes` and invoke service methods. It must not retain its
own session, model, fiber, or message refs.

- [ ] **Step 5: Run service and existing hook tests**

```bash
bunx vitest run src/lib/agent-workspace.test.ts src/hooks/use-agent-session.test.tsx
bun run typecheck
```

Expected: PASS with the previous observable hook contract preserved.

### Task 5: Build the sole Effect workspace command/state authority

**Files:**
- Create: `src/lib/workspace-controller.ts`
- Create: `src/lib/workspace-controller.test.ts`
- Modify: `src/lib/runtime.ts`

**Interfaces:**
- Consumes: `AgentWorkspace`, `ShapingKernel`, `ShellPreferences`,
  `ExtensionExecution`, `OperationJournal`, `FlectCommandEnvelope`.
- Produces:

```ts
interface FlectWorkspaceControllerShape {
  readonly snapshot: Effect.Effect<FlectWorkspaceSnapshot>
  readonly changes: Stream.Stream<FlectWorkspaceSnapshot>
  readonly events: Stream.Stream<FlectWorkspaceEvent>
  readonly dispatch: (
    envelope: FlectCommandEnvelope
  ) => Effect.Effect<FlectCommandReceipt, FlectCommandError>
}
```

- [ ] **Step 1: Write failing state-machine tests**

Use test layers and exercise only `dispatch`. Prove:

- every command tag has a deterministic receipt and event;
- commands from user and control sources reach the same transition;
- model favorites and App/Shaper external-extension toggles update the same
  reactive state for either source;
- duplicate `commandId` returns the prior receipt without rerunning;
- the recent command window is bounded;
- stale `expectedSequence` returns `CommandConflict`;
- `enable-control` with `source.kind === "control"` returns
  `ControlUnauthorized`;
- shape creates a proposal preview; accept/reject/rollback/safe-mode preserve
  ShapingKernel invariants;
- interface action invocation resolves a node ID from the current validated
  document and rejects stale/unknown IDs;
- long-running operations are cancellable and publish terminal events;
- each transition appears in `OperationJournal`.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
bunx vitest run src/lib/workspace-controller.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement controller state and dispatch**

Use one `SubscriptionRef<ControllerState>`, one bounded result cache, and one
broadcast event source. Keep command authorization separate:

```ts
const authorize = Effect.fn("Flect.Workspace.authorize")(function* (
  envelope: FlectCommandEnvelope
) {
  if (
    envelope.command.type === "enable-control" &&
    envelope.source.kind !== "user"
  ) {
    return yield* Effect.fail(ControlUnauthorized.make({
      message: "Outside clients cannot enable control."
    }))
  }
})
```

Dispatch the closed union with exhaustive `Match.value(...).pipe(...)` or
equivalent typed branching. Do not accept arbitrary callbacks or action
strings.

- [ ] **Step 4: Compose one browser application runtime**

Replace the split browser/shaping ownership with one named top-level layer:

```ts
const FlectApplicationLive = WorkspaceControllerLive.pipe(
  Layer.provideMerge(WorkspaceDependenciesLive)
)

export const flectRuntime = ManagedRuntime.make(FlectApplicationLive)
```

Keep compatibility exports temporarily if existing tests need them, but make
them aliases over the same managed runtime rather than separate service
instances.

- [ ] **Step 5: Run controller, kernel, and repository tests**

```bash
bunx vitest run src/lib/workspace-controller.test.ts src/lib/shaping-kernel.test.ts src/lib/interface-repository.test.ts
bun run typecheck
```

Expected: PASS.

### Task 6: Make React a reactive adapter and render visible activity

**Files:**
- Create: `src/hooks/use-workspace.ts`
- Create: `src/hooks/use-workspace.test.tsx`
- Create: `src/components/activity-card.tsx`
- Create: `src/components/activity-card.test.tsx`
- Create: `src/components/diagnostics-panel.tsx`
- Create: `src/components/diagnostics-panel.test.tsx`
- Modify: `src/app.tsx`
- Modify: `src/app.test.tsx`
- Modify: `src/components/agent-rail.tsx`
- Modify: `src/components/agent-rail.test.tsx`
- Modify: `src/components/role-aware-shell.tsx`
- Modify: `src/components/role-aware-shell.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `FlectWorkspaceController.snapshot/changes/events/dispatch`.
- Produces: semantic UI controls that dispatch command envelopes and display
  the controller's exact reactive state.

- [ ] **Step 1: Write failing adapter and activity UI tests**

Prove:

- external-source events update the rendered mode, messages, proposal, model,
  and attribution without reload;
- Bash and proposal tool cards show queued/running/succeeded/failed status,
  duration, command summary, exit code, output disclosure, and preview action;
- failed proposal shows exact safe paths and a retry action;
- operations can be filtered and correlation IDs copied;
- connected clients and a single protected enable/disable control are visible;
- toggling enable dispatches a user-source command;
- tool disclosures are keyboard and screen-reader operable.

- [ ] **Step 2: Run focused component tests and confirm red**

```bash
bunx vitest run src/hooks/use-workspace.test.tsx src/components/activity-card.test.tsx src/components/diagnostics-panel.test.tsx src/app.test.tsx
```

Expected: FAIL because the reactive adapter and instruments do not exist.

- [ ] **Step 3: Implement the thin React adapter**

`useWorkspace`:

- reads the initial snapshot through `flectRuntime`;
- subscribes to `changes` in a scoped fiber;
- interrupts that fiber on unmount;
- builds user-source envelopes with `crypto.randomUUID()`;
- exposes `dispatch(command, expectedSequence?)`;
- owns no parallel session, revision, operation, or model state.

- [ ] **Step 4: Implement compact T3-like activity instruments**

Use a quiet one-line collapsed card:

```text
● Bash · bun test · 1.2s
```

Expanded content uses labelled sections for input, bounded output, validation
issues, preview URL, operation/correlation IDs, source attribution, and retry.
Use existing typography and icon primitives rather than adding a second
visual system.

- [ ] **Step 5: Refactor `App` and shell controls onto typed commands**

Remove direct `useState` workflow ownership and direct calls to
`ShapingKernel`, `useAgentSession`, or shell preferences. `App` renders the
controller snapshot; buttons dispatch exact command classes. Preserve only
ephemeral draft, focus, disclosure, and scroll state in React.

- [ ] **Step 6: Run component tests and accessibility checks**

```bash
bunx vitest run src/hooks/use-workspace.test.tsx src/components/activity-card.test.tsx src/components/diagnostics-panel.test.tsx src/app.test.tsx src/components/agent-rail.test.tsx src/components/role-aware-shell.test.tsx
bun run typecheck
```

Expected: PASS with no inaccessible-name or focus-order regressions.

### Task 7: Add per-role sticky follow and jump-to-latest

**Files:**
- Create: `src/hooks/use-sticky-follow.ts`
- Create: `src/hooks/use-sticky-follow.test.tsx`
- Modify: `src/components/agent-rail.tsx`
- Modify: `src/components/agent-rail.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces:

```ts
interface StickyFollow {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly following: boolean
  readonly unreadCount: number
  readonly jumpToLatest: () => void
}
```

- [ ] **Step 1: Write failing scroll-policy tests**

With a controllable scroll element prove:

- initial and already-near-bottom updates follow;
- distance greater than 48 px suspends follow;
- streaming updates while suspended do not change `scrollTop`;
- unread count increments by message/tool update;
- jump uses non-focus-stealing scroll and resumes follow;
- switching roles restores each role's own follow state;
- reduced motion selects instant behavior.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
bunx vitest run src/hooks/use-sticky-follow.test.tsx src/components/agent-rail.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement the hook and disable native anchoring**

Observe `scroll` and content size, compute:

```ts
const distance = scrollHeight - scrollTop - clientHeight
const nearBottom = distance <= 48
```

Set `overflow-anchor: none` on the timeline. Only set `scrollTop` when
following or after explicit jump. Do not call `.focus()`.

- [ ] **Step 4: Render the accessible jump control**

Render `Jump to latest` with optional unread count only while suspended.
Place it inside the timeline footer so it does not cover composer controls.

- [ ] **Step 5: Run focused tests**

```bash
bunx vitest run src/hooks/use-sticky-follow.test.tsx src/components/agent-rail.test.tsx
```

Expected: PASS.

### Task 8: Build the scoped local control broker and protected descriptor

**Files:**
- Create: `server/control-descriptor.ts`
- Create: `server/control-descriptor.test.ts`
- Create: `server/control-broker.ts`
- Create: `server/control-broker.test.ts`
- Create: `server/control-http.ts`
- Create: `server/control-http.test.ts`

**Interfaces:**
- Consumes: shared control schemas.
- Produces:

```ts
interface FlectControlBrokerShape {
  readonly status: Effect.Effect<ControlBrokerStatus>
  readonly enable: (
    workspace: WorkspaceRegistration
  ) => Effect.Effect<ControlBrokerStatus, ControlBrokerError>
  readonly disable: Effect.Effect<void, ControlBrokerError>
  readonly nextCommand: (
    workspaceId: string
  ) => Effect.Effect<FlectCommandEnvelope, ControlBrokerError>
  readonly complete: (
    receipt: FlectCommandReceipt
  ) => Effect.Effect<void, ControlBrokerError>
  readonly publishSnapshot: (
    snapshot: FlectWorkspaceSnapshot
  ) => Effect.Effect<void, ControlBrokerError>
  readonly publishEvent: (
    event: FlectWorkspaceEvent
  ) => Effect.Effect<void, ControlBrokerError>
}
```

- [ ] **Step 1: Write failing descriptor and lifecycle tests**

Test in a temporary explicit directory:

- 256-bit token generation;
- random `127.0.0.1` port only;
- directory `0700`, descriptor `0600`;
- exact version/url/token/pid/instance/workspace schema;
- stale PID or instance rejection and cleanup;
- disable interrupts queue waiters, removes descriptor, rotates token, and
  rejects the prior bearer;
- scope release performs the same cleanup.

- [ ] **Step 2: Write failing external API security tests**

Prove:

- missing, malformed, and stale bearer returns 401 without detail leakage;
- non-loopback bind is rejected at construction;
- body and header limits apply before decode;
- `enable-control` is rejected externally;
- inspect, commands, logs, and SSE events use the shared schemas;
- command POST waits for the workspace receipt;
- disconnected workspace returns typed 409/503 behavior;
- no API response includes the bearer.

- [ ] **Step 3: Run focused tests and confirm red**

```bash
bunx vitest run server/control-descriptor.test.ts server/control-broker.test.ts server/control-http.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement secure descriptor handling**

Use `Effect.tryPromise` around filesystem boundaries with typed errors. Write
to a temporary file in the same directory, chmod, then rename atomically.
Resolve paths from `XDG_STATE_HOME` or the platform user state directory; test
layers inject an explicit directory and never target `HOME`, `~`, or `/`.

- [ ] **Step 5: Implement the scoped broker**

Use `Queue`, `Deferred`, `SubscriptionRef`, and `Effect.acquireRelease`.
Maintain only:

- active grant metadata;
- connected workspace metadata;
- latest published snapshot;
- bounded published events;
- pending command receipts.

Never reconstruct or mutate workspace state in the broker.

- [ ] **Step 6: Implement the authenticated Effect HTTP/SSE listener**

Expose versioned routes:

```text
GET  /v1/status
GET  /v1/instances
GET  /v1/workspaces/:id
GET  /v1/workspaces/:id/events
GET  /v1/workspaces/:id/logs
POST /v1/workspaces/:id/commands
POST /v1/control/disable
```

Start on `127.0.0.1:0`, discover the assigned port, and write the descriptor
only after the server is accepting connections.

- [ ] **Step 7: Run focused tests and leak scans**

```bash
bunx vitest run server/control-descriptor.test.ts server/control-broker.test.ts server/control-http.test.ts
rg -n "authorization|bearer|token" server/control-*.ts shared/control.ts
```

Expected: tests PASS; every sensitive-value use is confined to authentication
or descriptor code and never logging.

### Task 9: Connect browser and packaged desktop workspaces to the broker

**Files:**
- Create: `src/lib/workspace-control-bridge.ts`
- Create: `src/lib/workspace-control-bridge.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `shared/rpc.ts`
- Modify: `server/rpc-handlers.ts`
- Modify: `server/rpc-handlers.test.ts`
- Modify: `src/lib/tauri-transport.ts`
- Modify: `src/lib/tauri-transport.test.ts`
- Modify: `server/index.ts`
- Modify: `server/sidecar.ts`
- Modify: `src/lib/runtime.ts`

**Interfaces:**
- Consumes: `FlectControlBroker`,
  `FlectWorkspaceController.dispatch/changes/events`.
- Produces: one `WorkspaceControlBridge` service whose browser and desktop
  layers have identical semantics.

- [ ] **Step 1: Write failing browser channel tests**

Test:

- enable/register requires an allowed browser `Origin`;
- no-origin and cross-origin callers cannot impersonate the UI;
- the UI receives queued commands, posts typed receipts, and publishes state
  and events;
- disable closes the command stream;
- reconnect uses the same active workspace but a new channel instance;
- control commands appear immediately in the controller snapshot.

- [ ] **Step 2: Write failing desktop RPC channel tests**

Add streaming/private RPCs:

```text
ControlEnable
ControlDisable
ControlStatus
ControlRegisterWorkspace
ControlCommands (stream)
ControlComplete
ControlPublishSnapshot
ControlPublishEvent
```

Prove schema round-trip, stream interruption, broker sharing, and parity with
browser receipts.

- [ ] **Step 3: Run focused tests and confirm red**

```bash
bunx vitest run src/lib/workspace-control-bridge.test.ts server/app.test.ts server/rpc-handlers.test.ts src/lib/tauri-transport.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement browser and desktop bridge layers**

The bridge must:

- subscribe once to controller changes/events;
- publish them to the broker;
- consume broker commands;
- call the same `controller.dispatch`;
- return the exact receipt/error;
- use scoped fibers and interrupt all streams on disable/unmount.

Do not decode or branch on command tags in transport adapters beyond schema
validation.

- [ ] **Step 5: Compose exactly one broker instance per host**

In `server/index.ts` and `server/sidecar.ts`, bind `ControlBrokerLive` once and
provide the same layer reference to HTTP/RPC handlers and lifecycle startup.
Ensure sidecar exit and browser runtime shutdown release its scope.

- [ ] **Step 6: Run focused transport tests**

```bash
bunx vitest run src/lib/workspace-control-bridge.test.ts server/app.test.ts server/rpc-handlers.test.ts src/lib/tauri-transport.test.ts
bun run typecheck
```

Expected: PASS.

### Task 10: Ship the user-equivalent CLI, JSON mode, and MCP stdio adapter

**Files:**
- Create: `cli/flect-client.ts`
- Create: `cli/flect-client.test.ts`
- Create: `cli/flectctl.ts`
- Create: `cli/flectctl.test.ts`
- Create: `cli/flect-mcp.ts`
- Create: `cli/flect-mcp.test.ts`
- Modify: `package.json`
- Modify: `scripts/build-sidecar.ts`
- Modify: `scripts/build-sidecar.test.ts` if present
- Modify: `src-tauri/tauri.conf.json`
- Modify: release packaging tests and scripts that enumerate binaries

**Interfaces:**
- Consumes: protected descriptor and external JSON/SSE API.
- Produces:
  - compiled `flectctl`;
  - stable exit codes;
  - four MCP tools: `flect_inspect`, `flect_command`, `flect_wait`,
    `flect_logs`.

- [ ] **Step 1: Write failing client and CLI tests**

Cover:

- descriptor discovery and stale-instance failure;
- authorization header injection without exposing the bearer;
- `--stdin` for prompt/shape;
- human versus `--json` output;
- inspect/watch/logs, mode, prompt, shape, invoke, cancel, models/model,
  model favorites, App/Shaper external-extension toggles,
  accept/reject/rollback, safe/restore, rail, control status/disable, and raw
  schema command;
- `launch` opens the installed app or documented browser URL;
- no CLI `control enable`;
- exit codes for use error, unavailable, auth, conflict, operation failure,
  and interruption;
- stdout contains only schema JSON in JSON mode and diagnostics use stderr.

- [ ] **Step 2: Write failing MCP protocol tests**

Feed JSON-RPC frames over in-memory stdio and verify initialize, tool listing,
tool calls, schema validation, cancellation, and safe error responses. Confirm
the bearer never appears in tool schemas/results.

- [ ] **Step 3: Run focused tests and confirm red**

```bash
bunx vitest run cli/flect-client.test.ts cli/flectctl.test.ts cli/flect-mcp.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement the Effect CLI client and commands**

Use `Effect.fn` operations and one boundary runtime. Decode every response with
shared schemas. Generate command envelopes client-side with the workspace ID
from inspection and a named control source. Wait for terminal operation events
by default; `--no-wait` returns the accepted receipt.

Arguments support human convenience, but documentation and agent tests use:

```bash
printf '%s' 'Make the dashboard denser' | flectctl shape --stdin --json
```

- [ ] **Step 5: Implement the compact MCP adapter**

Use an official installed MCP SDK if already present; otherwise add the
smallest current official SDK package and inspect its local docs/source before
coding. Map all authority through the same client:

```text
flect_inspect -> snapshot
flect_command -> closed FlectCommand
flect_wait    -> event cursor / terminal operation
flect_logs    -> bounded OperationFilter
```

Do not create one MCP tool per Flect command.

- [ ] **Step 6: Compile and bundle `flectctl`**

Extend the build script to compile:

```text
src-tauri/binaries/flect-runtime-aarch64-apple-darwin
src-tauri/binaries/flectctl-aarch64-apple-darwin
```

Add `flectctl` to Tauri `externalBin` and release artifact verification.
`install-shell` may create a user-approved symlink in `~/.local/bin`; no
automatic PATH or shell-profile mutation.

- [ ] **Step 7: Run focused tests and binary smoke**

```bash
bunx vitest run cli/flect-client.test.ts cli/flectctl.test.ts cli/flect-mcp.test.ts scripts/package-release.test.ts
bun run build:sidecar
src-tauri/binaries/flectctl-aarch64-apple-darwin --help
```

Expected: tests PASS; help lists the documented commands and no enable command.

### Task 11: Verify real browser behavior through the public control surface

**Files:**
- Modify: `tests/e2e/flect.spec.ts`
- Create: `tests/e2e/control-plane.spec.ts`
- Modify: `playwright.config.ts` if a second worker/service fixture is needed
- Create: `docs/verification/flect-observable-control/browser.md`
- Create screenshots under:
  `docs/verification/flect-observable-control/screenshots/`

**Interfaces:**
- Consumes: running test runtime, UI, real `flectctl`, JSON/SSE API.
- Produces: public-surface browser evidence.

- [ ] **Step 1: Add a failing end-to-end Shaper reliability scenario**

Drive Edit mode through the visible UI, submit the prior reproduction
instruction `make a demo ui and show me`, and assert:

- proposal tool activity becomes visible;
- a valid preview appears;
- accept makes it active;
- no generic “could not produce” error appears;
- diagnostics contain correlated validation/tool/revision events.

- [ ] **Step 2: Add failing sticky-follow and activity scenarios**

Fill the timeline, scroll more than 48 px away, stream additional deltas/tool
updates, and assert viewport stability. Assert `Jump to latest` and unread
count, then jump and verify following resumes.

- [ ] **Step 3: Add failing CLI-to-live-UI scenarios**

Enable control via the protected UI, then invoke the compiled CLI from the
test:

```text
inspect -> mode edit -> shape -> accept -> mode run -> prompt
-> invoke a visible node -> logs -> safe-mode -> restore -> disable
```

Assert each external command changes the open page reactively and displays
client attribution. Assert the old token fails immediately after disable.

- [ ] **Step 4: Run the scenarios red, then implement only missing seams**

```bash
bunx playwright test tests/e2e/flect.spec.ts tests/e2e/control-plane.spec.ts
```

Expected before final fixes: at least one new scenario FAILS for the missing
observable behavior. Fix the smallest owning module for each failure.

- [ ] **Step 5: Run Playwright green and capture evidence**

```bash
bunx playwright test tests/e2e/flect.spec.ts tests/e2e/control-plane.spec.ts
```

Expected: PASS. Save light/dark relevant UI screenshots showing activity,
validation diagnostics, suspended scrolling, external attribution, and
connected control state.

### Task 12: Document ownership, security, adoption, and agent usage

**Files:**
- Modify: `README.md`
- Modify: `VISION.md`
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `ARCHITECTURE.md`
- Modify: `AGENTS.md`
- Create: `docs/control-api.md`
- Create: `docs/verification/flect-observable-control/README.md`

**Interfaces:**
- Consumes: verified implemented behavior only.
- Produces: one authoritative home for each contract and workflow.

- [ ] **Step 1: Update architecture and security ownership**

In `ARCHITECTURE.md`, document:

- workspace-authoritative topology;
- App/Shaper/Guardian separation;
- browser versus desktop channel parity;
- broker lifecycle and descriptor;
- token and origin threat model;
- Effect services/layers/streams/scopes;
- journal retention and redaction;
- sandbox boundary unchanged by outside control.

- [ ] **Step 2: Update product and design ownership**

Put user outcomes and limits in `PRODUCT.md`, long-term self-shaping intent in
`VISION.md`, and activity/sticky-follow/control UI behavior in `DESIGN.md`.
Avoid copying protocol steps into those documents.

- [ ] **Step 3: Add adoption and quickstart material**

In `README.md`, show:

```bash
open /Applications/Flect.app
/Applications/Flect.app/Contents/MacOS/flectctl inspect
printf '%s' 'Create a project dashboard' |
  /Applications/Flect.app/Contents/MacOS/flectctl shape --stdin
```

Explain that control must first be enabled inside Flect and that Flect works
without outside control in both browser and desktop modes.

- [ ] **Step 4: Add the exact API/CLI/MCP reference**

`docs/control-api.md` owns endpoint routes, auth, schemas, commands, exit
codes, SSE cursors, MCP tools, examples, disable/revoke behavior, and safe
debugging. Generate examples from actual schema-encoded fixtures where
practical.

- [ ] **Step 5: Update `AGENTS.md` with codebase invariants only**

Record that:

- all semantic actions enter `FlectWorkspaceController`;
- React and control adapters cannot create alternate state;
- Effect is mandatory for UI shaping and orchestration;
- control boundaries use shared schemas;
- secrets never enter logs/model context;
- real-browser tests drive the public control surface.

Do not duplicate setup commands or API reference detail into `AGENTS.md`.

- [ ] **Step 6: Run documentation and formatting checks**

```bash
rg -n 'FIXME|PLACEHOLDER|control '"'<enable'" README.md VISION.md PRODUCT.md DESIGN.md ARCHITECTURE.md AGENTS.md docs/control-api.md
git diff --check
bun run lint
```

Expected: no placeholders or forbidden outside enable command; checks PASS.

### Task 13: Full verification, packaged macOS smoke, and handoff

**Files:**
- Modify: `docs/verification/flect-observable-control/README.md`
- Modify only owning source/tests for any discovered failure.

**Interfaces:**
- Produces: a verified, installed, open Flect app and reproducible evidence.

- [ ] **Step 1: Run the complete automated gate**

```bash
bun run check:all
```

Expected:

- Effect checkout/dependency checks PASS;
- Rifty dependency checks PASS;
- Biome PASS;
- TypeScript PASS;
- all Vitest tests PASS;
- all Playwright tests PASS;
- all Rust tests PASS;
- signed-local `.app` bundle builds.

- [ ] **Step 2: Run a real Pi Shaper smoke against the exact tool**

```bash
bun run test:pi-smoke
```

Expected: authenticated Pi selects a model, returns a schema-valid proposal,
emits tool lifecycle evidence, and keeps provider credentials out of output.

- [ ] **Step 3: Replace the installed app safely**

Stop only the previously launched Flect process, move the old
`/Applications/Flect.app` to a task-specific backup location, install the new
bundle, and retain the backup until smoke verification succeeds. Never target
a broad directory or use recursive deletion.

- [ ] **Step 4: Smoke the installed app through its public interface**

Open `/Applications/Flect.app`, enable control in the UI, and run:

```bash
/Applications/Flect.app/Contents/MacOS/flectctl inspect --json
printf '%s' 'Create a compact runnable demo interface' |
  /Applications/Flect.app/Contents/MacOS/flectctl shape --stdin --json
/Applications/Flect.app/Contents/MacOS/flectctl accept --json
/Applications/Flect.app/Contents/MacOS/flectctl logs --json
```

Verify the visible app updates after each command, then disable/re-enable once
and prove the prior bearer is rejected.

- [ ] **Step 5: Run a native user path**

In the installed app:

- select Edit;
- submit a shape request;
- inspect live proposal/Bash activity;
- accept it;
- switch to Run and chat;
- scroll away during streaming and verify the viewport holds;
- use Jump to latest;
- enter and leave safe mode;
- confirm no generic hidden failure.

- [ ] **Step 6: Record final evidence and inspect the entire diff**

Capture exact command outputs, test counts, app version/path, screenshots, and
known non-blocking limitations in the verification README. Then run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: only intended Flect work and preserved pre-existing changes; no
whitespace errors.

- [ ] **Step 7: Leave the verified application open**

Leave the final `/Applications/Flect.app` instance running and visible. Do not
commit, push, publish, merge, or create a release.

---

## Plan self-review checklist

- [x] Every approved design section maps to at least one task.
- [x] All command names and shared type names are consistent across tasks.
- [x] No task introduces a second workspace authority.
- [x] Browser and desktop paths use the same controller and broker semantics.
- [x] External clients cannot enable their own authority.
- [x] Pi validation failure is structured, retry-bounded, and session-safe.
- [x] Tool activity and operation logs are bounded and model/secret safe.
- [x] Sticky-follow behavior is exact and tested.
- [x] CLI, JSON/SSE, and MCP expose the full closed command union.
- [x] Final verification drives the public interface and leaves the app open.
- [x] No step commits, pushes, merges, publishes, or releases.
