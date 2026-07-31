# Flect Role-Aware Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Flect’s old launcher and fixed Shaper overlay with a
T3Code-inspired protected shell whose blank-state Shaper conversation moves
into an adaptive right rail beside the generated interface, while accepted
products open with a separate App Agent.

**Architecture:** Extend the protected Pi runtime from Guardian/Shaper to
Guardian/App/Shaper and keep one bounded external session handle per selected
model. A shared Effect-backed workspace controller exposes role-scoped
histories and operations to a React shell that keeps one composer mounted while
CSS layout moves it from the centered empty state into the rail. Existing
Effect shaping, revision, validation, transport, sandbox, and recovery
capabilities remain authoritative.

**Tech Stack:** Effect 4.0.0-beta.102, Effect Schema, `@effect/vitest`, Pi SDK
0.82.1, React 19.2.8, TypeScript 7.0.2, Vite 8.1.5, Playwright 1.62.0, Tauri
2.11, Rust, CSS, Bun.

## Global Constraints

- Blank workspaces open in **Edit · Shaper**; accepted product experiences open
  in **Run · App Agent**.
- App Agent, Shaper, and Guardian use independent Pi `SessionManager`,
  `SettingsManager`, `ResourceLoader`, prompts, operation controllers, and
  histories.
- Guardian remains extension-free and tool-free. App Agent and Shaper receive
  separate browser-resident `SandboxedShell` workspaces.
- The active role is visible before send. Switching roles never submits a
  draft and never re-labels one role’s history as another role.
- The centered composer and docked composer are one mounted React component.
- Interface candidates remain untrusted until the existing Effect shaping
  kernel validates and previews them.
- Safe mode, rollback, and the protected fallback composer remain compiled and
  independent from user interface documents.
- Persisted shell preferences use Effect Schema and an Effect service. Invalid
  values fail to defaults.
- The wide rail is inline, 400 px by default, keyboard-resizable from 340–520
  px; medium and narrow layouts use an accessible sheet.
- Motion is at most 240 ms and disabled by `prefers-reduced-motion`.
- No coding-only T3 Code control is ported without a matching Flect
  capability.
- Substantially adapted T3 Code source retains its MIT attribution.
- Every behavior is implemented red-green-refactor and tested through public
  contracts or rendered behavior.
- Do not use `any`, unsafe assertions, raw JSON trust, ad hoc Promise services,
  or local Effect layer provisioning.

---

## File map

### Protected runtime and contracts

- Modify `shared/contracts.ts`: add protected agent roles and role-aware cancel
  and shell-result contracts.
- Modify `shared/rpc.ts`: carry role data through private native RPC.
- Modify `server/pi-runtime.ts`: create, supervise, route, cancel, and dispose a
  three-session agent set.
- Modify `server/runtime.ts`, `server/app.ts`, `server/rpc-handlers.ts`, and
  `server/test-runtime.ts`: expose role-aware operations consistently over HTTP
  and private RPC.
- Modify matching tests in `shared/`, `server/`, and `src/lib/`.

### Browser Effect application

- Modify `src/shell/sandboxed-shell-service.ts`,
  `src/shell/sandboxed-shell.ts`, and tests: provide isolated App and Shaper
  shell profiles behind one role-aware service.
- Create `shared/shell-preferences.ts`: schema for protected shell layout and
  model favorites.
- Create `src/lib/shell-preferences.ts` and test: Effect service and storage
  layer for preferences.
- Create `src/hooks/use-shell-preferences.ts` and test: the single React/runtime
  adapter for the preference service.
- Modify `src/lib/runtime.ts`: compose role shells and preferences once at the
  browser runtime edge.
- Replace `src/hooks/use-agent-session.ts` with a role-aware workspace
  controller while preserving its public runtime boundary.

### React shell

- Create `src/components/role-aware-shell.tsx`: protected shell and layout
  state.
- Create `src/components/agent-rail.tsx`: role header, timeline, revision
  decisions, failures, and composer anchor.
- Create `src/components/role-switcher.tsx`: explicit Run/Edit selection.
- Replace `src/components/composer.tsx` with the T3Code-derived role-aware
  composer structure.
- Upgrade `src/components/model-menu.tsx`: search, provider grouping,
  favorites, selection, and bounded keyboard navigation.
- Modify `src/components/composer-actions-menu.tsx`: expose only role-valid,
  implemented actions.
- Modify `src/components/interface-renderer.tsx`: keep product prompt nodes
  shapeable while routing protected fallback rendering through the rail.
- Modify `src/app.tsx`: derive blank/preview/accepted state from the shaping
  snapshot and connect role controllers.
- Delete `src/components/launcher.tsx` and
  `src/components/shaper-panel.tsx` after replacement tests pass.
- Replace their tests with role-shell, rail, composer, mode, and accessibility
  tests.
- Rewrite the owned shell sections of `src/styles.css`.

### Verification, documentation, and media

- Extend `tests/e2e/flect.spec.ts` with the complete blank-to-product workflow
  and responsive coverage.
- Update `scripts/capture-release-media.ts` and media tests for the new states.
- Create `THIRD_PARTY_NOTICES.md` with the T3 Code MIT attribution.
- Update `DESIGN.md`, `ARCHITECTURE.md`, `README.md`, and release-facing media.
- Build, smoke, install, and inspect the packaged macOS app.

---

### Task 1: Add the real App Agent trust domain

**Files:**
- Modify: `server/pi-runtime.ts`
- Modify: `server/pi-runtime.test.ts`

**Interfaces:**
- Consumes: existing `PiSession`, `PiSdk`, `FlectRuntime`, session registry,
  Guardian and Shaper policies.
- Produces:

```ts
export type PiSessionPolicy = {
  readonly role: "guardian" | "app" | "shaper";
  readonly tools: "none" | "sandbox-bash";
  readonly storage: "memory";
  readonly extensions: "disabled";
  readonly userResources: "disabled";
};

export interface PiAgentSet {
  readonly guardian: PiSession;
  readonly app: PiSession;
  readonly shaper: PiSession;
}
```

- [ ] **Step 1: Write failing runtime tests**

Add tests proving that `prompt()` calls only the App Agent, `shape()` calls only
Shaper, and `diagnoseRecovery()` calls only Guardian. Add acquisition-failure
tests proving that any successfully created earlier role is disposed when a
later role fails.

```ts
it.effect("routes prompt, shape, and recovery to independent Pi roles", () =>
  Effect.gen(function* () {
    const runtime = yield* FlectRuntime;
    const sessionId = yield* runtime.createSession(SessionSelection.make({}));

    yield* runtime.prompt(sessionId, "Use the product").pipe(Stream.runDrain);
    yield* runtime
      .shape(sessionId, "Change the product", defaultInterfaceDocument)
      .pipe(Stream.runDrain);
    yield* runtime.diagnoseRecovery(sessionId, "rollback-failed");

    expect(fake.appPrompt).toHaveBeenCalledWith("Use the product");
    expect(fake.shaperPrompt).toHaveBeenCalledOnce();
    expect(fake.guardianPrompt).toHaveBeenCalledOnce();
  }),
);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run server/pi-runtime.test.ts
```

Expected: FAIL because `PiAgentSet.app` and the App policy do not exist and
ordinary prompts still use Shaper.

- [ ] **Step 3: Implement the three-role Pi set**

Add the immutable App policy and system prompt:

```ts
app: Object.freeze({
  role: "app",
  tools: "sandbox-bash",
  storage: "memory",
  extensions: "disabled",
  userResources: "disabled",
} satisfies PiSessionPolicy)
```

Construct Guardian, App Agent, and Shaper sequentially with Effect finalization
on partial failure. Store separate `appOperation`, `shaperOperation`, and
`guardianOperation` controllers in each registry record. Route ordinary
prompts to `record.app`, shaping to `record.shaper`, and recovery diagnostics
to `record.guardian`. Close, eviction, refresh, and construction rollback must
dispose all three sessions with bounded concurrency.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bunx vitest run server/pi-runtime.test.ts
```

Expected: all Pi runtime tests pass with three independent role assertions.

- [ ] **Step 5: Commit**

```bash
git add server/pi-runtime.ts server/pi-runtime.test.ts
git commit -m "feat(runtime): add protected App Agent role"
```

### Task 2: Make cancellation and shell completion role-aware

**Files:**
- Modify: `shared/contracts.ts`
- Modify: `shared/contracts.test.ts`
- Modify: `shared/rpc.ts`
- Modify: `server/runtime.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `server/rpc-handlers.ts`
- Modify: `server/rpc-handlers.test.ts`
- Modify: `server/test-runtime.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.test.ts`
- Modify: `src/lib/tauri-transport.ts`
- Modify: `src/lib/tauri-transport.test.ts`

**Interfaces:**
- Consumes: Task 1 role operation controllers.
- Produces:

```ts
export const InteractiveAgentRole = Schema.Literals(["app", "shaper"]);
export type InteractiveAgentRole = typeof InteractiveAgentRole.Type;

export class CancelRequest extends Schema.Class<CancelRequest>("CancelRequest")({
  role: InteractiveAgentRole,
}) {}

export class AgentShellResultRequest
  extends Schema.Class<AgentShellResultRequest>("AgentShellResultRequest")({
    role: InteractiveAgentRole,
    requestId: ShellRequestId,
    result: BunCommandResult,
  }) {}
```

`FlectRuntime.cancel(sessionId, role)` and
`FlectRuntime.completeShellRequest(sessionId, role, requestId, result)` are the
only cancellation and shell-result entry points.

- [ ] **Step 1: Write failing contract, HTTP, RPC, and client tests**

Prove strict decoding rejects missing or unknown roles; cancelling App Agent
does not interrupt Shaper; shell results complete only the selected role’s
pending request; browser and Tauri clients encode the same role.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run shared/contracts.test.ts server/app.test.ts server/rpc-handlers.test.ts src/lib/api.test.ts src/lib/tauri-transport.test.ts
```

Expected: FAIL because role fields and role-aware methods are absent.

- [ ] **Step 3: Implement schemas and transports**

Use `Schema.Class.make` constructors, strict decode options, and typed runtime
errors. Keep HTTP routes stable while adding schema bodies:

```ts
POST /api/sessions/:sessionId/cancel
POST /api/sessions/:sessionId/shell-results
```

Native RPC carries the same schema classes. Do not infer a role from a pending
request or search both operation controllers.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and expect every selected suite to pass.

- [ ] **Step 5: Commit**

```bash
git add shared/contracts.ts shared/contracts.test.ts shared/rpc.ts server/runtime.ts server/app.ts server/app.test.ts server/rpc-handlers.ts server/rpc-handlers.test.ts server/test-runtime.ts src/lib/api.ts src/lib/api.test.ts src/lib/tauri-transport.ts src/lib/tauri-transport.test.ts
git commit -m "feat(runtime): route interactive operations by agent role"
```

### Task 3: Isolate App and Shaper browser shells

**Files:**
- Modify: `src/shell/sandboxed-shell-service.ts`
- Modify: `src/shell/sandboxed-shell.ts`
- Modify: `src/shell/sandboxed-shell.test.ts`
- Modify: `src/lib/runtime.ts`

**Interfaces:**
- Consumes: `InteractiveAgentRole` from Task 2.
- Produces:

```ts
export interface SandboxedShellShape {
  readonly execute: (
    role: InteractiveAgentRole,
    command: string,
  ) => Effect.Effect<BunCommandResult, BunCommandFailed>;
  readonly stop: (
    role: InteractiveAgentRole,
  ) => Effect.Effect<void, BunCommandFailed>;
}

export const SandboxedShellLive = makeRoleSandboxedShellLayer({
  app: appWorkspace,
  shaper: shaperWorkspace,
});
```

- [ ] **Step 1: Write failing isolation tests**

Execute `echo app > marker` as App Agent and assert Shaper cannot read it.
Start one role’s preview, stop the other, and assert the first preview remains
owned and reachable.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run src/shell/sandboxed-shell.test.ts
```

Expected: FAIL because the current service owns one Shaper workspace.

- [ ] **Step 3: Implement the role shell layer**

Build two shell implementations once inside `Layer.effect`, store them in a
readonly role map, and route calls by the closed schema role. Reuse current
just-bash/Rifty lifecycle and bounds. Give App Agent a separate scratch
workspace with no interface source and give Shaper the current authoring
workspace. Scope disposal stops both implementations.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and expect role filesystem and preview isolation
tests to pass.

- [ ] **Step 5: Commit**

```bash
git add src/shell/sandboxed-shell-service.ts src/shell/sandboxed-shell.ts src/shell/sandboxed-shell.test.ts src/lib/runtime.ts
git commit -m "feat(sandbox): isolate App and Shaper shell workspaces"
```

### Task 4: Add protected shell preferences

**Files:**
- Create: `shared/shell-preferences.ts`
- Create: `shared/shell-preferences.test.ts`
- Create: `src/lib/shell-preferences.ts`
- Create: `src/lib/shell-preferences.test.ts`
- Create: `src/hooks/use-shell-preferences.ts`
- Create: `src/hooks/use-shell-preferences.test.tsx`
- Modify: `src/lib/runtime.ts`

**Interfaces:**
- Produces:

```ts
export class ShellPreferencesValue
  extends Schema.Class<ShellPreferencesValue>("ShellPreferencesValue")({
    version: Schema.Literal(1),
    railWidth: Schema.Number.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 340, maximum: 520 }),
    ),
    railCollapsed: Schema.Boolean,
    modelFavorites: Schema.Array(Schema.String).check(
      Schema.isMaxLength(24),
    ),
  }) {}

export interface ShellPreferencesShape {
  readonly load: Effect.Effect<ShellPreferencesValue>;
  readonly save: (
    value: ShellPreferencesValue,
  ) => Effect.Effect<void, InterfaceStorageError>;
}

export interface ShellPreferencesController {
  readonly value: ShellPreferencesValue;
  readonly setRailWidth: (width: number) => Promise<void>;
  readonly setRailCollapsed: (collapsed: boolean) => Promise<void>;
  readonly toggleModelFavorite: (modelKey: string) => Promise<void>;
}
```

- [ ] **Step 1: Write failing schema and service tests**

Cover defaults, valid round-trip, invalid JSON, excess properties, invalid
width, duplicate favorites normalization, storage read failure, and storage
write failure.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run shared/shell-preferences.test.ts src/lib/shell-preferences.test.ts src/hooks/use-shell-preferences.test.tsx
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement schema and Effect service**

Use the storage key `flect.shell.preferences.v1`. Decode with
`Schema.decodeUnknownEffect` and strict excess-property rejection. Invalid or
unreadable values return:

```ts
ShellPreferencesValue.make({
  version: 1,
  railWidth: 400,
  railCollapsed: false,
  modelFavorites: [],
})
```

Use `Context.Service`, named `Effect.fn` operations, a named live Layer, and
provide `InterfaceStorageLive` only from `src/lib/runtime.ts`.

The hook loads through the existing `browserRuntime`, updates optimistic state
only with schema-valid values, and restores the previous value when persistence
fails. It is the only React adapter that calls the preference service.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and expect all preference tests to pass.

- [ ] **Step 5: Commit**

```bash
git add shared/shell-preferences.ts shared/shell-preferences.test.ts src/lib/shell-preferences.ts src/lib/shell-preferences.test.ts src/hooks/use-shell-preferences.ts src/hooks/use-shell-preferences.test.tsx src/lib/runtime.ts
git commit -m "feat(shell): persist protected layout preferences"
```

### Task 5: Expose role-scoped workspace controllers

**Files:**
- Modify: `src/hooks/use-agent-session.ts`
- Modify: `src/hooks/use-agent-session.test.tsx`
- Modify: `src/lib/runtime.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:

```ts
export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "activity";
  readonly content: string;
}

export interface RoleConversationState {
  readonly role: InteractiveAgentRole;
  readonly status: AgentSessionStatus;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly lastPrompt: string;
  readonly error?: string;
  readonly cancel: () => Promise<void>;
}

export interface AppConversationController extends RoleConversationState {
  readonly submit: (text: string) => Promise<void>;
}

export interface ShaperConversationController extends RoleConversationState {
  readonly shape: (
    instruction: string,
    document: InterfaceDocument,
  ) => Promise<InterfaceDocument>;
}

export interface AgentWorkspaceController {
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel?: ModelSummary;
  readonly selectModel: (model?: ModelSummary) => void;
  readonly refresh: () => Promise<void>;
  readonly app: AppConversationController;
  readonly shaper: ShaperConversationController;
  readonly diagnoseRecovery: (
    reason: RecoveryReason,
  ) => Promise<GuardianDiagnostic>;
}
```

- [ ] **Step 1: Replace tests with failing role behavior**

Prove:

- one external session handle owns both interactive roles;
- App and Shaper messages, status, failures, cancellation, and retry remain
  separate;
- prompt uses App Agent and shape uses Shaper;
- shell requests execute in the emitting role’s shell;
- model change interrupts both roles, closes the set once, and preserves
  visible histories;
- a busy conflict preserves the relevant role session; and
- unmount disposes every active role fiber and the external session.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run src/hooks/use-agent-session.test.tsx
```

Expected: FAIL because the hook exposes one shared status and history.

- [ ] **Step 3: Implement the role workspace controller**

Keep model discovery and the external session handle shared. Store App and
Shaper request fibers, status, messages, errors, and last prompts separately.
Pass an explicit role to cancellation, shell execution, and shell-result
completion. Shaper submission appends the user instruction immediately,
records bounded activity messages for shell requests, and appends a concise
assistant result only after a candidate is decoded:

```ts
{
  role: "assistant",
  content: `Preview ready: ${candidate.name}`,
}
```

Do not place raw generated interface JSON or commands containing secrets into
the timeline.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and expect the role-scoped hook suite to pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-agent-session.ts src/hooks/use-agent-session.test.tsx src/lib/runtime.ts
git commit -m "feat(shell): expose separate App and Shaper conversations"
```

### Task 6: Route blank and accepted workspaces through Effect-owned state

**Files:**
- Modify: `src/app.tsx`
- Create: `src/app.test.tsx`
- Create: `src/lib/workspace-phase.ts`
- Create: `src/lib/workspace-phase.test.ts`

**Interfaces:**
- Consumes: `ShapingSnapshot`, Task 5 workspace controller.
- Produces:

```ts
export type WorkspacePhase = "blank" | "preview" | "accepted" | "safe";

export const workspacePhase = (
  snapshot: ShapingSnapshot,
  explicitSafeMode: boolean,
): WorkspacePhase => {
  if (explicitSafeMode || snapshot.safeMode) return "safe";
  if (snapshot.proposal?.status === "previewed") return "preview";
  return snapshot.active.source === "built-in" ? "blank" : "accepted";
};
```

`App` passes the complete shaping snapshot and role controllers to
`RoleAwareShell`; it no longer passes a generic session plus detached Shaper
panel controller.

- [ ] **Step 1: Write failing phase and orchestration tests**

Cover built-in initialization, restored accepted revision, unresolved preview,
safe mode, first shape, keep, reject, rollback, and active-operation
interlocks. Assert a blank submission calls only `shaper.shape`.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run src/app.test.tsx src/lib/workspace-phase.test.ts
```

Expected: FAIL because App does not expose phase or role-aware orchestration.

- [ ] **Step 3: Implement phase derivation and role orchestration**

Keep snapshot observation and revision decisions in Effect. Replace broad
`catch` blocks with typed public messages at the React boundary while
preserving deterministic recovery. On blank and preview phases force Edit
mode; accepted phase initially selects Run; safe phase selects the protected
fallback.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and expect all selected tests to pass.

- [ ] **Step 5: Commit**

```bash
git add src/app.tsx src/app.test.tsx src/lib/workspace-phase.ts src/lib/workspace-phase.test.ts
git commit -m "feat(shell): derive role routing from revision state"
```

### Task 7: Build the role-aware shell and persistent rail

**Files:**
- Create: `src/components/role-aware-shell.tsx`
- Create: `src/components/role-aware-shell.test.tsx`
- Create: `src/components/agent-rail.tsx`
- Create: `src/components/agent-rail.test.tsx`
- Create: `src/components/role-switcher.tsx`
- Create: `src/components/role-switcher.test.tsx`
- Modify: `src/components/interface-renderer.tsx`
- Modify: `src/components/interface-renderer.test.tsx`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces:

```ts
export type ShellMode = "run" | "edit" | "safe";

export interface ShapingController {
  readonly status: "idle" | "shaping" | "preview" | "error";
  readonly error?: string;
  readonly rollbackAvailable: boolean;
  readonly isolation: "unchecked" | "checking" | "ready" | "unavailable";
  readonly verifyIsolation: () => Promise<void>;
  readonly request: (instruction: string) => Promise<void>;
  readonly accept: () => Promise<void>;
  readonly reject: () => Promise<void>;
  readonly rollback: () => Promise<void>;
}

export interface RoleAwareShellProps {
  readonly phase: WorkspacePhase;
  readonly document: InterfaceDocument;
  readonly preview: boolean;
  readonly workspace: AgentWorkspaceController;
  readonly shaping: ShapingController;
  readonly preferences: ShellPreferencesController;
  readonly onOpenSafeMode: () => void;
  readonly onRestoreSafeMode: () => Promise<void>;
}
```

- [ ] **Step 1: Write failing rendered-behavior tests**

Prove:

- blank state shows one centered Edit composer;
- first send calls Shaper and changes to split layout;
- the composer DOM node and active focus survive the transition;
- accepted startup selects Run and submits to App Agent;
- Run/Edit histories remain separate;
- role switching is blocked during active operations;
- preview decisions are visible in the rail;
- safe mode bypasses customized prompt nodes;
- rail collapse restores focus to the reopen button; and
- a customized interface without a prompt cannot remove the protected rail.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run src/components/role-aware-shell.test.tsx src/components/agent-rail.test.tsx src/components/role-switcher.test.tsx src/components/interface-renderer.test.tsx
```

Expected: FAIL because the role shell components do not exist.

- [ ] **Step 3: Implement one mounted shell**

Render `AgentRail` once as a stable child of `RoleAwareShell`. Change its CSS
grid area between `center` and `rail`; do not render distinct centered and
docked composer branches. Use the accepted/preview document only in
`WorkspaceCanvas`. Keep revision actions in the protected rail and delegate
all operations to supplied controllers.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and expect all new shell tests to pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/role-aware-shell.tsx src/components/role-aware-shell.test.tsx src/components/agent-rail.tsx src/components/agent-rail.test.tsx src/components/role-switcher.tsx src/components/role-switcher.test.tsx src/components/interface-renderer.tsx src/components/interface-renderer.test.tsx
git commit -m "feat(ui): move shaping conversation beside the canvas"
```

### Task 8: Port the T3Code composer and model interaction

**Files:**
- Modify: `src/components/composer.tsx`
- Modify: `src/components/composer.test.tsx`
- Modify: `src/components/model-menu.tsx`
- Modify: `src/components/model-menu.test.tsx`
- Modify: `src/components/composer-actions-menu.tsx`
- Modify: `src/components/composer-actions-menu.test.tsx`
- Modify: `src/components/icons.tsx`
- Create: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Consumes: role, model, favorites, and action controllers from Tasks 4–7.
- Produces a multiline composer with:
  - role control;
  - searchable provider-grouped model menu;
  - favorites;
  - supported actions;
  - responsive action rail;
  - send/stop state;
  - bounded growth; and
  - complete focus and keyboard behavior.

- [ ] **Step 1: Write failing composer and picker tests**

Cover Enter, Shift+Enter, IME, draft retention by role, bounded growth, send,
stop, disabled explanations, responsive compaction, role label, model search,
provider grouping, favorites, empty results, Arrow/Home/End navigation,
Escape, outside dismissal, and focus restoration.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run src/components/composer.test.tsx src/components/model-menu.test.tsx src/components/composer-actions-menu.test.tsx
```

Expected: FAIL on role, search, favorites, and responsive behavior.

- [ ] **Step 3: Adapt the T3Code patterns**

Use T3 Code commit `d19039aeef6942e6eb204856c43b5354c0333e2d` as the
reference for surface hierarchy, compact controls, model rows, bounded list
scrolling, scroll fades, focus traversal, and footer compaction. Keep Flect’s
React textarea rather than importing Lexical, because Flect does not yet have
file mentions, slash commands, or annotation tokens.

Add the T3 Code MIT text and exact adapted commit to
`THIRD_PARTY_NOTICES.md`. Add source comments only where substantial logic is
copied.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and expect all composer suites to pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composer.tsx src/components/composer.test.tsx src/components/model-menu.tsx src/components/model-menu.test.tsx src/components/composer-actions-menu.tsx src/components/composer-actions-menu.test.tsx src/components/icons.tsx THIRD_PARTY_NOTICES.md
git commit -m "feat(ui): adapt the T3Code composer for Flect"
```

### Task 9: Finish layout, resizing, responsive sheets, and accessibility

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/role-aware-shell.tsx`
- Modify: `src/components/role-aware-shell.test.tsx`
- Modify: `src/components/agent-rail.tsx`
- Modify: `src/components/agent-rail.test.tsx`
- Delete: `src/components/launcher.tsx`
- Delete: `src/components/launcher.test.tsx`
- Delete: `src/components/shaper-panel.tsx`
- Delete: `src/components/shaper-panel.test.tsx`

**Interfaces:**
- Consumes: stable shell and composer from Tasks 7–8.
- Produces:
  - inline rail at ≥981 px;
  - right sheet at 761–980 px;
  - full-height mobile sheet at ≤760 px;
  - 340–520 px pointer and keyboard resizing;
  - collapse/reopen;
  - FLIP-style ≤240 ms transition; and
  - reduced-motion bypass.

- [ ] **Step 1: Add failing accessibility and layout tests**

Use public DOM behavior and `matchMedia` test adapters. Prove labelled
complementary landmark, labelled separator, Arrow key resizing, width bounds,
sheet focus entry and restoration, Escape behavior, preview protection,
collapsed reopen focus, and reduced-motion class behavior.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run src/components/role-aware-shell.test.tsx src/components/agent-rail.test.tsx
```

Expected: FAIL because resizing, sheet focus, and final layout do not exist.

- [ ] **Step 3: Implement the Flect visual system**

Rewrite only shell-owned CSS. Use an inline grid and a single left divider for
the wide rail; use a modal sheet with focus management at smaller widths. Keep
the canvas tonal and uninterrupted. Use `--flect-rail-width` from validated
preferences. Measure the composer before and after layout and animate one
transform without opacity changes. Disable transform and continuous thinking
animation under reduced motion.

- [ ] **Step 4: Remove obsolete UI**

Delete Launcher and ShaperPanel only after their replacement suites pass.
Remove `.shell--shaping`, `.shaper-panel`, and obsolete conversation layout
styles. Preserve reusable message rendering, composer controls, and protected
runtime alerts.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bunx vitest run src/components src/app.test.tsx
bun run lint
bun run typecheck
```

Expected: component tests, accessibility behaviors, Biome, and TypeScript pass.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/components src/app.tsx
git commit -m "feat(ui): finish the adaptive Flect workspace"
```

### Task 10: Prove the workflow in production Chromium

**Files:**
- Modify: `tests/e2e/flect.spec.ts`
- Modify: `server/test-runtime.ts`
- Modify: `playwright.config.ts` only if a deterministic viewport project is
  required.

**Interfaces:**
- Consumes: production build and test runtime.
- Produces deterministic E2E coverage for blank Edit, split preview, accepted
Run, role separation, responsive sheet, safe mode, and keyboard operation.

- [ ] **Step 1: Write failing E2E scenarios**

Add tests that:

1. submit the initial blank composer to Shaper without opening a menu;
2. observe the same composer element dock right;
3. preview a validated UI on the canvas;
4. keep, reject, and rollback revisions;
5. explicitly choose **Use app** and complete a separate App Agent turn;
6. collapse and reopen the rail;
7. open the 900 px sheet and 720 px mobile sheet;
8. complete the primary flow by keyboard;
9. select and search Pi models;
10. stop an App or Shaper operation without crossing roles; and
11. recover through safe mode.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx playwright test tests/e2e/flect.spec.ts
```

Expected: FAIL on the initial Shaper routing and adaptive rail assertions.

- [ ] **Step 3: Complete deterministic test runtime fixtures**

Return role-distinct text:

```ts
App Agent: "The product action completed."
Shaper: validated proposal named "Focused project overview"
Guardian: "The protected launcher remains available."
```

Keep real SSE, shell request, browser sandbox, validation, and production
bundle paths in the test.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and expect every Chromium workflow to pass with no
console, page, or local request failures.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/flect.spec.ts server/test-runtime.ts playwright.config.ts
git commit -m "test(ui): cover the role-aware shell in Chromium"
```

### Task 11: Update canonical docs, screenshots, and demo

**Files:**
- Modify: `DESIGN.md`
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `scripts/capture-release-media.ts`
- Modify: `tests/media/release-media.test.ts`
- Modify: `tests/media/release-media-repro.test.ts`
- Replace: `assets/screenshots/flect-launcher.png`
- Replace: `assets/screenshots/flect-shaper-preview.png`
- Create: `assets/screenshots/flect-run-mode.png`
- Replace: `assets/flect-shell.png`
- Replace: `assets/flect-hero.png`
- Replace: `assets/demo/flect-v0.1-demo.webm`
- Replace: `assets/demo/flect-v0.1-demo.webp`
- Replace: `assets/demo/flect-v0.1-demo.mp4`

**Interfaces:**
- Consumes: verified production UI from Task 10.
- Produces reproducible release media and documentation that describe only
implemented behavior.

- [ ] **Step 1: Update failing media expectations**

Add `flect-run-mode.png` to the tracked set and update README assertions for
blank Edit, moving rail, preview, and Run mode.

- [ ] **Step 2: Verify RED**

Run:

```bash
bunx vitest run tests/media/release-media.test.ts
```

Expected: FAIL because the new Run screenshot and README references do not
exist.

- [ ] **Step 3: Update canonical documents**

Make the adaptive rail normative in `DESIGN.md`. Describe the three real Pi
roles and role-owned shell workspaces in `ARCHITECTURE.md`. Keep future
capsules, OPFS Git, and product capabilities described only as future work.
Rewrite README’s first-run flow and screenshots without duplicating the
architecture or vision.

- [ ] **Step 4: Update the media scenario**

Capture at 1716×916:

1. centered blank Edit composer;
2. validated preview with docked right Shaper rail;
3. accepted Run mode with App Agent rail; and
4. hero composition based on these actual product states.

The demo must visibly show the centered composer moving right, the interface
appearing, Keep change, Use app, and one App Agent turn. Use deterministic
runtime responses and stable animation delays.

- [ ] **Step 5: Generate and verify media**

Run:

```bash
bun run media:release
bunx vitest run tests/media/release-media.test.ts
bun run media:verify-reproducible
```

Expected: generation succeeds, tracked size/format checks pass, and two
consecutive captures have identical hashes.

- [ ] **Step 6: Commit**

```bash
git add DESIGN.md ARCHITECTURE.md README.md scripts/capture-release-media.ts tests/media assets THIRD_PARTY_NOTICES.md
git commit -m "docs: show the role-aware Flect experience"
```

### Task 12: Package, inspect, install, and ship

**Files:**
- Modify only files required by failures found during the gates.
- Generated local artifact:
  `src-tauri/target/release/bundle/macos/Flect.app`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified `main`, installed `/Applications/Flect.app`, and open
  local process.

- [ ] **Step 1: Run targeted changed-area verification**

```bash
bun run check
bunx playwright test tests/e2e/flect.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit 0 with no failed tests.

- [ ] **Step 2: Run the full release gate**

```bash
bun run check:all
```

Expected: Effect and Rifty pins, Biome, TypeScript, all unit and contract tests,
all Chromium tests, Rust tests, sidecar build, Vite build, Tauri app build, and
ad-hoc signature complete successfully.

- [ ] **Step 3: Run no-mistakes with the requested review model**

Run the repository’s configured no-mistakes workflow with Luna at xhigh
reasoning. Fix every verified finding test-first, rerun affected suites, and
repeat until the protected head passes.

- [ ] **Step 4: Exercise the packaged macOS app**

Move any existing `/Applications/Flect.app` to a unique recoverable Trash
location, install the exact built bundle with `ditto`, and launch the exact app.
Verify bundle equality and signature:

```bash
diff -qr src-tauri/target/release/bundle/macos/Flect.app /Applications/Flect.app
codesign --verify --deep --strict /Applications/Flect.app
open /Applications/Flect.app
```

Use macOS desktop interaction to complete the blank Edit → preview → Keep →
Use app flow at normal width, then narrow the window and verify the sheet.
Capture evidence without credentials or private provider output. Confirm the
exact `/Applications/Flect.app/Contents/MacOS/flect` process remains running.

- [ ] **Step 5: Commit final verified fixes**

Inspect `git diff --name-only`, stage only the explicit files changed for each
verified finding, run `git diff --cached --check`, and commit with a message
that names that finding. Never use `git add --all` or stage an unrelated path.
Skip this step when the final gates require no fixes.

- [ ] **Step 6: Push the fast-forward result to main**

Fetch and prove `origin/main` is an ancestor, then:

```bash
git push origin HEAD:main
```

Do not force push. Verify local `HEAD`, `origin/main`, and
`git ls-remote origin refs/heads/main` resolve to the same commit.

- [ ] **Step 7: Completion audit**

Check every acceptance item in
`docs/superpowers/specs/2026-07-31-flect-role-aware-shell-design.md` against
current code, test output, generated media, packaged app behavior, remote Git
state, installed bundle equality, signature, and live process evidence. Leave
the goal active if any item is missing or supported only indirectly.
