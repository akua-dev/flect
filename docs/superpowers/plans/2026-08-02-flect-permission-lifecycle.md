# Flect Permission Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Robin has directed Flect PR work to
> continue without approval checkpoints; keep the tests as the checkpoints.

**Goal:** Replace Flect’s boolean product grants with a complete, protected,
Effect-owned capability lifecycle that is scoped, expiring, rate-aware,
inspectable, revocable, redacted, browser-portable, and available in safe mode.

**Architecture:** Versioned Schema contracts describe trusted capability
manifests, user decisions, lifecycle projections, and receipts. A focused
decision store owns strict durable migration; a `ProductCapabilityBroker`
atomically owns decisions and usage; the existing registry applies independent
product policy and invokes adapters only after brokerage. The shared workspace
controller remains the sole semantic entry point and React renders protected
projections only.

**Tech Stack:** Effect 4.0.0-beta.102, Effect Schema, Context services, Layers,
`SynchronizedRef`, Effect `Clock`/`TestClock`, `@effect/vitest`, React 19,
Playwright Chromium, Tauri 2, Bun 1.4+.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-02-flect-permission-lifecycle-design.md`.
- Do not use `any`, `as` assertions, `instanceof`, raw throwing decoders, or
  Promise-shaped application services.
- Start every behavior change with a failing public or exported-contract test
  and observe the intended failure before implementation.
- Compose Layers once in `src/lib/runtime.ts`; React never accesses persistence,
  clocks, or capability services directly.
- Product input, redirects, aliases, manifest updates, and registry updates may
  never widen an existing decision.
- Keep credentials, headers, raw inputs/outputs, URLs, response bodies, and
  thrown values out of projections, receipts, logs, fixtures, and screenshots.
- Preserve all unrelated dirty-worktree changes. Do not commit, push, publish,
  or mutate releases without authority under `AGENTS.md`.

---

### Task 1: Versioned capability and decision contracts

**Files:**

- Modify: `shared/product-capability.ts`
- Modify: `shared/contracts.test.ts`
- Test: `shared/product-capability.test.ts`

**Interfaces:**

- Produces `ProductCapabilityManifest`, `ProductCapabilityDecision`,
  `ProductCapabilityProjection`, `ProductCapabilityDecisionRecord`,
  `ProductCapabilityRateLimit`, `AuthorizedProductOperation`, and their branded
  identifiers/closed literals.
- Evolves `ProductOperationSummary` to contain a lifecycle projection rather
  than `granted: boolean`.
- Extends `ProductOperationFailure.reason` with `expired`, `revoked`,
  `rate-limited`, `product-denied`, and `unavailable` while retaining redacted
  public messages.

- [x] **Step 1: Write strict schema tests**

  Add tests that decode valid version-1 manifests and version-2 decisions, then
  reject excess properties, duplicate/empty scopes, invalid policy/workspace
  combinations, invalid expiry/rate values, and overlong fields with
  `Schema.decodeUnknownEffect(..., { onExcessProperty: "error" })`.

- [x] **Step 2: Run the contract tests and observe RED**

  Run:

  ```bash
  bunx vitest run shared/product-capability.test.ts shared/contracts.test.ts
  ```

  Expected: failure because the new schema classes and lifecycle fields do not
  exist.

- [x] **Step 3: Implement the smallest complete schema model**

  Define named classes and tagged unions. Model the persisted decision status
  as `granted | denied | revoked`; derive `available | requested | expired` in
  the broker. Use `Schema.optionalKey` for `workspaceId`, `expiresAtMillis`, and
  `rateLimit`. Bound all arrays and scalar lengths. Preserve
  `ProductOperationInvocation` version 1 for transport compatibility.

- [x] **Step 4: Run contract tests and typecheck GREEN**

  ```bash
  bunx vitest run shared/product-capability.test.ts shared/contracts.test.ts
  bun run typecheck
  ```

  Expected: both commands pass with no warnings.

### Task 2: Strict v2 decision persistence and v1 migration

**Files:**

- Rename: `src/capabilities/product-capability-grant-store.ts` →
  `src/capabilities/product-capability-decision-store.ts`
- Rename test accordingly
- Modify: `src/lib/runtime.ts`

**Interfaces:**

- Produces `ProductCapabilityDecisionStore` with:

  ```ts
  readonly load: (
    manifests: ReadonlyArray<ProductCapabilityManifest>,
  ) => Effect.Effect<ProductCapabilityDecisionStoreSnapshot,
    ProductCapabilityDecisionStoreFailure>
  readonly save: (
    snapshot: ProductCapabilityDecisionStoreSnapshot,
  ) => Effect.Effect<void, ProductCapabilityDecisionStoreFailure>
  ```

- Uses `flect.product-capability-decisions.v2` as the durable source and reads
  `flect.product-capability-grants.v1` only for one-way migration.

- [x] **Step 1: Write store and migration tests**

  Prove strict v2 round-trip and normalization; corrupt v2 fails closed; v1
  `true` migrates only to current operation/resource/data intersection; v1
  `false` migrates to revoked; a failed v2 save keeps v1; and successful
  migration makes v2 authoritative.

- [x] **Step 2: Run the focused test and observe RED**

  ```bash
  bunx vitest run src/capabilities/product-capability-decision-store.test.ts
  ```

  Expected: failure because the decision store does not exist.

- [x] **Step 3: Implement strict load/save/migration**

  Decode unknown JSON with excess properties rejected. Normalize by decision ID
  and capsule/capability/workspace identity, reject ambiguous duplicates, and
  write the complete v2 snapshot atomically through `InterfaceStorage`. Map all
  storage/schema failures to a schema-backed tagged store error.

- [x] **Step 4: Run focused tests GREEN**

  ```bash
  bunx vitest run src/capabilities/product-capability-decision-store.test.ts
  ```

  Expected: all persistence and migration cases pass.

### Task 3: Atomic Effect permission broker

**Files:**

- Create: `src/capabilities/product-capability-broker.ts`
- Test: `src/capabilities/product-capability-broker.test.ts`

**Interfaces:**

- Produces `ProductCapabilityBroker` with `catalog`, `decide`, `revoke`, and
  `reserve` Effect methods. Invocation completion receipts remain owned by the
  shared controller and its bounded operation journal.
- `reserve` accepts trusted capsule/workspace/revision identity plus an
  `AuthorizedProductOperation`; it returns a bounded reservation containing
  decision ID and policy, never a bearer or mutable state handle.
- Uses one `SynchronizedRef` for memory decisions and usage. Durable mutations
  call the decision store from `SynchronizedRef.modifyEffect` so failed saves do
  not change live state.

- [x] **Step 1: Write lifecycle tests with `@effect/vitest`**

  Prove distinct available/requested/granted/denied/revoked states, then use
  `TestClock.adjust` to prove expiry and rate-window reset. Prove once
  consumption, session reconstruction, workspace/persistent identity, manifest
  revision invalidation, and fail-closed unavailable capability behavior.

- [x] **Step 2: Write concurrency and persistence-failure tests**

  Fork two reservations against one remaining allowance and assert exactly one
  succeeds. Fail the durable store and assert the adapter reservation fails and
  the prior projection is unchanged.

- [x] **Step 3: Run broker tests and observe RED**

  ```bash
  bunx vitest run src/capabilities/product-capability-broker.test.ts
  ```

  Expected: failure because the broker service does not exist.

- [x] **Step 4: Implement the broker with named Effects**

  Use `Context.Service`, a named `Layer.effect`, `Clock.currentTimeMillis`, and
  `SynchronizedRef.modifyEffect`. Compute lifecycle projections from manifest,
  request, decision, usage, and time. Consume once on attempted invocation;
  reserve durable usage before returning. Annotate spans only with stable
  capsule/capability/decision IDs.

- [x] **Step 5: Run broker tests GREEN**

  ```bash
  bunx vitest run src/capabilities/product-capability-broker.test.ts
  ```

  Expected: lifecycle, TestClock, concurrency, and failure tests pass.

### Task 4: Registry product-policy intersection and adapter denial

**Files:**

- Modify: `src/capabilities/product-capability-registry.ts`
- Modify: `src/capabilities/product-capability-registry.test.ts`
- Modify: `src/capabilities/product-capability-diagnostic.tsx`

**Interfaces:**

- Registry construction receives trusted `manifests` and `operations`.
- `ProductOperationDefinition.authorize(input)` returns
  `Effect<AuthorizedProductOperation, ProductOperationFailure>` before request
  construction.
- `invoke(context, invocation)` applies broker reservation, product policy,
  existing HTTP policy, output projection, and redacted completion in order.

- [x] **Step 1: Write denial and anti-widening tests**

  Add observable tests proving undeclared/unavailable/ungranted/denied/expired/
  revoked/rate-limited calls never reach `authorize` or `ProductHttp`; product
  denial never reaches HTTP after a user grant; resource/data mismatch fails;
  redirects and aliases stay denied by the HTTP policy; and adding an operation
  or changing the capsule request does not widen an old decision.

- [x] **Step 2: Run registry and HTTP tests and observe RED**

  ```bash
  bunx vitest run src/capabilities/product-capability-registry.test.ts src/capabilities/product-http.test.ts
  ```

- [x] **Step 3: Integrate broker and product policy**

  Remove boolean defaults and `setGrant`. Require a broker reservation for
  every invocation, keep ProductHttp unchanged below the policy boundary, and
  translate all expected errors by `_tag`/closed reason rather than
  `instanceof`.

- [x] **Step 4: Run focused tests GREEN**

  ```bash
  bunx vitest run src/capabilities/product-capability-registry.test.ts src/capabilities/product-capability-registry-policy.test.ts src/capabilities/product-http.test.ts src/capabilities/product-capability-broker.test.ts
  ```

### Task 5: Shared controller, receipts, and agent-facing permission commands

**Files:**

- Modify: `shared/control.ts`
- Modify: `shared/control.test.ts`
- Modify: `src/lib/workspace-controller.ts`
- Modify: `src/lib/workspace-controller.test.ts`
- Modify: `src/lib/operation-journal.ts`
- Modify: `src/lib/operation-journal.test.ts`
- Modify: `src/axi/command.ts`
- Modify: `src/axi/command.test.ts`
- Modify: `src/axi/program.ts`
- Modify: `src/axi/program.test.ts`
- Modify: `src/shell/flect-command.ts`
- Modify: `src/shell/flect-command.test.ts`
- Modify: `scripts/generate-flect-skill.ts`
- Modify: `.agents/skills/flect/SKILL.md`

**Interfaces:**

- Replace `SetProductCapabilityGrant` with protected
  `DecideProductCapability` and `RevokeProductCapability` commands.
- Add read-only `permissions list` and revocation-only `permissions revoke`
  AXI commands. No agent-facing command can create a grant.
- Product invocation journal entries carry bounded receipt fields as structured
  operation metadata, never raw payloads.

- [x] **Step 1: Write controller authority and receipt tests**

  Prove protected UI can decide/revoke only current accepted or candidate
  requests; Guardian, Shaper, capsule, outside control, and App Agent cannot
  grant; paired control can list/revoke but not grant; revocation immediately
  blocks both capsule and App Agent; stale bindings fail; receipts include
  requester/decision/operation/revision/result and exclude seeded secrets.

- [x] **Step 2: Run focused tests and observe RED**

  ```bash
  bunx vitest run shared/control.test.ts src/lib/workspace-controller.test.ts src/lib/operation-journal.test.ts src/axi/command.test.ts src/axi/program.test.ts src/shell/flect-command.test.ts
  ```

- [x] **Step 3: Implement commands through the controller**

  Decode every command through Schema, enforce source policy before calling the
  broker, refresh all capsule review projections after decisions, and append
  one redacted receipt for every attempted invocation. Regenerate the Flect
  skill from command metadata.

- [x] **Step 4: Run focused tests and generator check GREEN**

  ```bash
  bunx vitest run shared/control.test.ts src/lib/workspace-controller.test.ts src/lib/operation-journal.test.ts src/axi/command.test.ts src/axi/program.test.ts src/shell/flect-command.test.ts scripts/generate-flect-skill.test.ts
  bun run generate:flect-skill
  git diff --check
  ```

### Task 6: Protected normal and safe-mode permission UI

**Files:**

- Modify: `src/components/agent-rail.tsx`
- Modify: `src/components/agent-rail.test.tsx`
- Modify: `src/components/role-aware-shell.tsx`
- Modify: `src/components/role-aware-shell.test.tsx`
- Modify: `src/app.tsx`
- Modify: `src/app.test.tsx`
- Modify: `src/styles.css`
- Modify: `DESIGN.md` only if a new durable visual token is required

**Interfaces:**

- A focused `ProductCapabilities` protected component renders lifecycle,
  availability, scope, lifetime, rate, decision details, and revoke actions.
- Default selected action is session. Pending transitions disable conflicting
  controls and failure leaves the prior projection visible.
- Safe mode uses the same protected projection and handlers, independent from
  capsule UI and Pi.

- [x] **Step 1: Write component and shell tests**

  Prove all lifecycle labels, session default, five applicable actions,
  accessible fieldset/legend/description relationships, pending and failure
  states, safe-mode inspection, and revoke without a model runtime.

- [x] **Step 2: Run UI tests and observe RED**

  ```bash
  bunx vitest run src/components/agent-rail.test.tsx src/components/role-aware-shell.test.tsx src/app.test.tsx
  ```

- [x] **Step 3: Implement the protected UI**

  Keep hierarchy restrained and consistent with `DESIGN.md`; use existing
  controls/tokens where possible. Present concise scope first and expandable
  technical detail second. Never render raw request/response content.

- [x] **Step 4: Run UI and accessibility tests GREEN**

  ```bash
  bunx vitest run src/components/agent-rail.test.tsx src/components/role-aware-shell.test.tsx src/app.test.tsx
  bunx playwright test tests/e2e/accessibility.spec.ts
  ```

### Task 7: Real Chromium lifecycle and recovery proof

**Files:**

- Replace: `tests/e2e/product-capability.spec.ts`
- Modify: `tests/e2e/flect.spec.ts`
- Modify: `playwright.config.ts` only if a deterministic diagnostic route needs
  an additional explicit environment flag

**Interfaces:**

- Production Chromium drives the rendered protected UI and shared controller;
  it does not edit storage or call implementation-only hooks.

- [x] **Step 1: Write/extend the production-browser workflow**

  Cover requested → session grant → invocation → runtime reload expiry;
  workspace/persistent grant across reload; equal capability IDs isolated
  between two capsules; product-policy denial; safe-mode inspection and
  revocation with model providers unavailable; and no unexpected console,
  request, or page errors.

- [x] **Step 2: Run the workflow and observe RED**

  ```bash
  bunx playwright test tests/e2e/product-capability.spec.ts
  ```

- [x] **Step 3: Make only boundary fixes needed by the public workflow**

  Correct controller/runtime/UI wiring exposed by the browser proof without
  weakening assertions or adding test-only authority.

- [x] **Step 4: Run Chromium GREEN**

  ```bash
  bunx playwright test tests/e2e/product-capability.spec.ts tests/e2e/flect.spec.ts tests/e2e/accessibility.spec.ts
  ```

### Task 8: Canonical documentation, evidence, and dedicated project

**Files:**

- Modify: `ARCHITECTURE.md` after implementation proof
- Modify: `docs/trust-model.md`
- Modify: `docs/product-capabilities.md`
- Modify: `docs/product-quality.md` only for stable proof links/status
- Modify: `docs/local-control.md`
- Modify: `README.md` only if its concise current-capability summary changes
- Create: `docs/verification/2026-08-02-permission-lifecycle-verification.md`

**External records:**

- Update GitHub issue #6 with exact evidence and remaining exclusions.
- Update only the dedicated Flect organization project’s live status/fields.

- [x] **Step 1: Run the complete non-release gate**

  ```bash
  bun run check:all
  ```

  Expected: Biome, typecheck, all Vitest, all production Chromium, Rust tests,
  and a fresh ad-hoc-signed macOS application bundle pass.

- [x] **Step 2: Install and dogfood the exact fresh bundle**

  Replace only the installed Flect bundle with the freshly built artifact using
  the repository’s existing recoverable install procedure. Keep exactly one
  main Flect process, its one runtime child, and exactly one visible layer-zero
  Flect window. Use the public `flect` executable to list permissions, invoke a
  granted diagnostic operation, revoke it, and prove the next invocation is
  denied. Enter safe mode and repeat inspection/revocation without Pi.

  The stock native composition intentionally contains no product operation, so
  its public command proved the empty bounded permission list plus packaged
  recovery. Grant/invoke/revoke/deny and safe-mode revocation were dogfooded
  through the production-browser diagnostic composition, which uses the same
  controller and public `flect` language. The dated evidence records this host
  split rather than implying a native reference product ships.

- [x] **Step 3: Record bounded evidence and update canonical owners**

  The verification note records exact commands, counts, bundle identity,
  CoreGraphics window count, and public-interface observations. Update
  `ARCHITECTURE.md` only with behavior proven in this run; link stable FQ rows
  to the dated evidence without duplicating criteria.

- [x] **Step 4: Update issue #6 and the dedicated Flect project**

  Use `gh-axi` to post the exact evidence and keep exclusions as follow-up
  issues. Close #6 only if every acceptance criterion is proven. Preserve the
  project as the live status source rather than copying a roadmap into docs.

- [x] **Step 5: Final hygiene audit**

  ```bash
  git diff --check
  git status --short
  ```

  Confirm there are no credentials, accidental binaries, duplicate sources of
  truth, stale boolean-grant references, unsupported implementation claims, or
  more than one visible Flect window.
