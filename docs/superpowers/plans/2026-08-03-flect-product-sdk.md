# Flect Product-Adoption SDK Implementation Plan

> Execute inline in the existing isolated worktree. The current task authorizes
> PR work but not commit, push, npm publish, GitHub release, or issue closure, so
> those mutations are intentionally absent.

**Goal:** Produce a separately versioned, packable `@flect/product` SDK, make
Flect consume its public contracts, and prove three structurally different
products plus deterministic adoption and recovery behavior.

**Architecture:** Move existing public schemas and transport-only Effect
services into one self-contained workspace package, leaving protected Flect
state private. Add strict product integration/adoption contracts, a narrow
runtime definition, a compatibility evaluator, and three public-only reference
adopters. Prove the packed tarball in a clean consumer and adoption behavior in
production Chromium and packaged macOS.

**Tech stack:** Effect 4.0.0-beta.102, TypeScript 7 NodeNext package output, Bun
workspace tooling, npm pack, Vitest with @effect/vitest, React 19, production
Playwright Chromium, Tauri 2/Rust.

**Design:**
[`docs/superpowers/specs/2026-08-03-flect-product-sdk-design.md`](../specs/2026-08-03-flect-product-sdk-design.md)

## Global constraints

- `@flect/product` begins at version `0.1.0`; no registry publish occurs.
- Every serializable or external value is strict Effect Schema version 1.
- No `any`, `as` cast, namespace, thrown domain error, or private-text error.
- Product denial runs before transport and user approval never overrides it.
- Credentials remain inside trusted host closures and never enter package
  metadata, capsules, instructions, diagnostics, models, logs, or results.
- Flect owns grants, user forks, protected storage, safe mode, and recovery.
- Existing shared import paths are compatibility re-exports, not duplicate
  schemas.
- Tests begin RED and exercise exported behavior, not source-text assertions.
- No commit, push, release, publish, or issue close.

---

## Task 1: Scaffold and prove the self-contained package boundary

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `tsconfig.app.json`
- Modify: `vitest.config.ts`
- Create: `packages/product/package.json`
- Create: `packages/product/tsconfig.json`
- Create: `packages/product/README.md`
- Create: `packages/product/src/index.ts`
- Create: `packages/product/src/contracts.ts`
- Create: `packages/product/src/host.ts`
- Create: `scripts/product-sdk-package.test.ts`
- Create: `scripts/package-product-sdk.ts`

**Produces:** A workspace dependency named `@flect/product`, deterministic ESM
and declaration build, local tarball command, and clean-consumer proof.

- [x] Write `scripts/product-sdk-package.test.ts` first. It must create a fresh
  temporary consumer, build and pack the package, assert tar entries are limited
  to package metadata/README/LICENSE/dist, install the tarball plus the local
  exact Effect dependency, compile a consumer import from
  `@flect/product`, run it, and remove only its temporary directory.
- [x] Run
  `bunx vitest run scripts/product-sdk-package.test.ts`; observe RED because
  the package and packaging command do not exist.
- [x] Add root workspaces, `@flect/product: workspace:*`, source aliases for
  root tests, and a `build:product` script. Add the package manifest with exact
  Effect peer/development versions, ESM exports for root/contracts/host, files
  allowlist, Apache-2.0 license, repository metadata, and side-effect-free flag.
- [x] Add NodeNext package compilation with declaration maps, strict mode,
  DOM/ES2023 libraries, and `rootDir: src`, `outDir: dist`. Add explicit
  public barrels with no deep export.
- [x] Implement `scripts/package-product-sdk.ts` as Bun/TypeScript. It removes
  only `packages/product/dist`, compiles the package, runs
  `npm pack --json`, strictly decodes the result, and prints the exact tarball
  path/digest/size as JSON.
- [x] Run the focused package test GREEN, inspect `npm pack --dry-run`, and
  confirm a clean consumer resolves no repository-relative import.

## Task 2: Move public schemas into the package without duplication

**Files:**

- Move source of truth:
  - `shared/product-adapter.ts` ->
    `packages/product/src/product-adapter.ts`
  - `shared/product-capability.ts` ->
    `packages/product/src/product-capability.ts`
  - `shared/product-http.ts` -> `packages/product/src/product-http.ts`
  - `shared/product-graphql.ts` ->
    `packages/product/src/product-graphql.ts`
  - `shared/product-events.ts` -> `packages/product/src/product-events.ts`
  - `shared/extensions.ts` -> `packages/product/src/extensions.ts`
  - `shared/capsule.ts` -> `packages/product/src/capsule.ts`
- Recreate each old path as one compatibility re-export.
- Modify package public barrels.
- Modify existing contract tests only where import paths are part of public
  consumer proof.

**Produces:** One package-owned source of truth for capsule, extension,
capability, HTTP, GraphQL, and event contracts.

- [x] Add a failing public-import test under
  `packages/product/src/contracts.test.ts` that decodes representative capsule,
  extension, capability, HTTP, GraphQL, and event values exclusively from the
  package barrel and rejects excess fields.
- [x] Run the package contract test and observe RED on missing exports.
- [x] Move the seven implementations with package-local explicit `.js`
  imports. Recreate old shared files as `export * from` compatibility modules.
- [x] Export only intentional contract values and types from
  `packages/product/src/contracts.ts`; do not export strict parse options,
  private constants, or implementation helpers.
- [x] Run package and all existing shared contract tests GREEN, then build the
  declaration output and inspect the public import graph.

## Task 3: Move transport-only Effect host adapters into the SDK

**Files:**

- Move source of truth:
  - `src/capabilities/product-http.ts` ->
    `packages/product/src/host/product-http.ts`
  - `src/capabilities/product-graphql.ts` ->
    `packages/product/src/host/product-graphql.ts`
  - `src/capabilities/product-events.ts` ->
    `packages/product/src/host/product-events.ts`
- Recreate each old path as one compatibility re-export.
- Create: `packages/product/src/host/adapter-failure.ts`
- Create: `packages/product/src/host/adapter-failure.test.ts`
- Modify package host/root barrels.

**Produces:** Public `ProductHttp`, `ProductGraphql`, and `ProductEvents`
services/Layers whose only runtime dependency is Effect and trusted callbacks.

- [x] Write a failing host-barrel test proving an offline import has no fetch
  requirement; HTTP rejects arbitrary URL/method/header widening; GraphQL fixes
  endpoint/document; events are bounded and scoped; private callback defects
  encode only fixed errors.
- [x] Run the host test RED on missing exports.
- [x] Move the services and use package-local contracts. Centralize only the
  fixed public adapter-failure mapping; preserve interrupts and sanitize
  defects.
- [x] Re-export compatibility modules at the old Flect paths and keep existing
  Flect tests unchanged wherever possible.
- [x] Run all HTTP/GraphQL/event tests GREEN and build/pack the package.

## Task 4: Add integration, compatibility, user-state, and detach contracts

**Files:**

- Create: `packages/product/src/integration.ts`
- Create: `packages/product/src/integration.test.ts`
- Create: `packages/product/src/adoption.ts`
- Create: `packages/product/src/adoption.test.ts`
- Modify: `packages/product/src/contracts.ts`
- Modify: `packages/product/src/index.ts`

**Produces:**

- `ProductDescriptor`, `ProductInferencePolicy`,
  `ProductExperienceDescriptor`, `ProductMigration`
- `ProductOperationDefinition`, `ProductEventDefinition`,
  `ProductIntegrationInput`, `ProductIntegration`
- `defineProductIntegration(input)`
- `ProductHostFacts`, `ProductConnectionRecord`, `ProductUserState`,
  `ProductAdoptionDiagnostic`, `ProductAdoptionSnapshot`
- `evaluateProductAdoption(input)` and `detachProduct(input)`

- [x] Write RED schema tests for excess fields, invalid semantic versions/ranges,
  duplicate inference owners, absent default inference, invalid connection/auth
  combinations, invalid digests, duplicate/cross-missing capabilities and
  operations, unknown selected inference, bad archive digest, and ambiguous
  migrations.
- [x] Write RED adoption-table tests for ready, offline, update, fork-preserved,
  capability-review, extension-review, incompatible Flect, incompatible host,
  unsupported auth, migration-required, migration-blocked, and detached states.
  Assert exact diagnostic order, fixed messages/actions, and deterministic
  output.
- [x] Write RED security tests proving product denial beats a Flect grant before
  execute, model metadata cannot change authorization, callback defects are
  sanitized, and archive loader private text is absent from
  `ProductIntegrationFailure`.
- [x] Implement named Schema classes and
  `ProductIntegrationFailure extends Schema.TaggedErrorClass`. Use
  `Schema.decodeUnknownEffect` with excess-property errors at the boundary.
- [x] Implement `defineProductIntegration` with one validation pass, unique and
  exact cross-reference checks, archive SHA-256 verification, migration graph
  validation, and a branded returned value without unsafe casts.
- [x] Implement `evaluateProductAdoption` as a pure deterministic Effect
  business function. Sort diagnostics by a documented reason order and never
  inspect private closures.
- [x] Implement `detachProduct` so it removes only the connection record and
  returns byte-for-byte-equivalent user fork/export/grant references.
- [x] Run Task 4 tests GREEN, package declarations, and existing capability
  registry tests.

## Task 5: Make Flect registries consume the public runtime definitions

**Files:**

- Modify: `src/capabilities/product-capability-registry.ts`
- Modify: `src/capabilities/product-event-registry.ts`
- Modify: their existing tests
- Create: `src/capabilities/product-integration.ts`
- Create: `src/capabilities/product-integration.test.ts`
- Modify: `src/lib/runtime.ts`

**Produces:** `makeProductIntegrationLayer(integration)`, the private Flect
bridge from one validated public integration into protected broker/registry
Layers.

- [x] First change registry tests to import operation/event definitions from
  `@flect/product`; observe RED until the internal duplicate interfaces are
  removed.
- [x] Add bridge RED tests proving manifests, operations, and events register
  from one integration while decisions remain supplied by Flect; no integration
  method can grant, accept, access storage, or replace safe mode.
- [x] Replace internal definition interfaces with package imports/re-exports.
  Implement the bridge as a Layer composition at the protected runtime edge,
  never locally inside an operation.
- [x] Prove product authorization still precedes execute/connector start and
  exact scope validation still uses broker reservations.
- [x] Run focused integration, broker, registry, AXI, controller, and existing
  product adapter tests GREEN.

## Task 6: Build three public-only reference products

**Files:**

- Create: `examples/product-sdk/reference-support.ts`
- Create: `examples/product-sdk/offline-board.ts`
- Create: `examples/product-sdk/browser-projects.ts`
- Create: `examples/product-sdk/brokered-incidents.ts`
- Create: `examples/product-sdk/reference-products.test.ts`
- Create: `examples/product-sdk/README.md`
- Modify or retire:
  `examples/product-adapter/reference-product.ts` and its fixture only after
  equivalent coverage exists.

**Produces:** Three validated integrations whose adopter source imports only
`@flect/product`.

- [x] Write an adoption test that imports all three factories and hosts them
  through the public package plus the private Flect bridge. Start RED before
  creating adopter implementations.
- [x] The offline board test must invoke list/add with no fetch or credential,
  decode its recommended capsule, enable its optional Shaper guide, preserve a
  local fork on update, and detach without altering fork/export digests.
- [x] The browser projects test must invoke one fixed GraphQL query and two
  ordered events, prove cancellation, and produce an explicit offline
  diagnostic without replacing the accepted recommended interface.
- [x] The brokered incidents test must invoke fixed read/acknowledge operations
  through a named callback, deny acknowledge before callback when product
  policy rejects, and prove a fake host secret is absent from capsule,
  instructions, outputs, diagnostics, test console, and captured logs.
- [x] Run each reference under user and product inference owners and assert
  identical product authorization requests and results.
- [x] Implement the smallest public-only factories, deterministic capsule
  archives, bounded capabilities, public App Agent instructions, and optional
  Shaper extension for each.
- [x] Write copyable docs beginning with the offline factory, then add
  browser-direct and brokered adapters as independent increments.
- [x] Run all reference and legacy product adapter tests GREEN.

## Task 7: Prove deterministic adoption UX in production Chromium

**Files:**

- Create: `src/capabilities/product-adoption-diagnostic.tsx`
- Create: `src/capabilities/product-adoption-diagnostic.test.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Create: `tests/e2e/product-adoption.spec.ts`

**Produces:** Test-only
`/?product-adoption-diagnostic=1` behind the existing capability diagnostic
build flag.

- [x] Write React RED tests for semantic product cards, connection/auth/inference
  labels, ordered diagnostics, protected recovery copy, and no private state.
- [x] Write Playwright RED for offline ready, browser offline, broker auth
  unavailable/ready, update with preserved fork, capability change, extension
  change, incompatible host, blocked migration, detach preservation, reload,
  keyboard access, and zero secret/console/page errors.
- [x] Implement the diagnostic from SDK snapshots only. Keep recommended
  interface and safe recovery visually distinct; never render raw errors,
  closures, endpoints, headers, or callback state.
- [x] Add contained responsive styles using existing semantic tokens and
  reduced-motion/forced-color behavior.
- [x] Run React tests and production Chromium workflow GREEN, then rerun product
  adapter, capability, capsule, extension, and accessibility workflows.

## Task 8: Package, document, gate, dogfood, and evidence

**Files:**

- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/product-capabilities.md`
- Modify: `docs/trust-model.md` only for the new public boundary
- Update: `docs/verification/2026-08-01-product-quality-baseline.md` only by a
  new dated superseding report, never by rewriting frozen evidence
- Create: `docs/verification/2026-08-03-product-sdk-verification.md`
- Update: this plan checkboxes

- [x] Replace the “future SDK” statements with exact current package, quickstart,
  reference, compatibility, inference, auth, user-ownership, and limitation
  facts.
- [x] Build and pack `@flect/product`; record filename, SHA-256, bytes,
  contents, exports, peer dependencies, and clean-consumer output. Do not
  publish.
- [x] Run focused tests, `bun run check:all`, `cargo fmt --check`, and
  `git diff --check`.
- [x] Package-dogfood the adoption UX, verify the three products and recovery
  states through public AX surfaces, then rebuild the ordinary app.
- [x] Replace `/Applications/Flect.app` recoverably with the exact ordinary
  gated artifact; prove source/install parity, hashes, signature/notarization
  truth, exactly one window, Pi ready, and Local control off.
- [x] Record exact commands, counts, timings, screenshots, failures, recovery,
  limitations, branch/base/dirty caveat, and package/app hashes.
- [x] Add exact evidence to issue #28 without closing it; no commit, push,
  release, or npm publish.

## Plan self-review

- Every issue #28 acceptance criterion maps to Tasks 4, 6, 7, or 8.
- The package tarball and clean consumer prove a real public boundary rather
  than monorepo-only source imports.
- Three products differ by transport, authentication ownership, events, and
  inference default while sharing one protected Flect host path.
- Product updates and detach cannot own or erase Flect user state.
- Credentials, arbitrary proxying, product-owned grants, and product-controlled
  safe mode are excluded structurally and adversarially tested.
- #12 native keychain/transport, #13 remote runtimes, and #29 collaboration stay
  separate rather than becoming hidden SDK authority.
