# Flect typed product adapters implementation plan

> Execute inline in the existing isolated worktree. Git commit/push steps are
> intentionally absent because current repository authority does not authorize
> them.

**Goal:** Add fixed-document GraphQL and bounded resumable event adapters behind
the existing product capability broker, then prove a reference product through
browser and packaged macOS public surfaces.

**Architecture:** Keep callers on named JSON operations. Make the unary registry
transport-neutral, add schema-owned GraphQL and event services, and bind event
scope to the same capability reservation and revocation model. Product host
Layers own endpoints, documents, connectors, credentials, and authorization.

**Tech stack:** Effect 4 beta services, Layers, Schema, Stream, Queue, Scope,
Clock and TestClock; TypeScript 7; Vitest; React 19; Playwright Chromium; Tauri
2/Rust packaged proof.

**Design:**
[`docs/superpowers/specs/2026-08-03-flect-product-adapter-design.md`](../specs/2026-08-03-flect-product-adapter-design.md)

---

## Task 1: Define strict GraphQL contracts

**Files:**

- Create: `shared/product-graphql.test.ts`
- Create: `shared/product-graphql.ts`

**Produces:** `ProductGraphqlPolicy`, `ProductGraphqlRegistration`,
`ProductGraphqlRequest`, `ProductGraphqlResponse`, `ProductGraphqlPublicError`,
and `ProductGraphqlFailure`.

- [x] Write failing schema tests for a valid fixed query and for unknown fields,
  non-HTTPS endpoints, endpoint paths with fragments, mismatched operation IDs,
  malformed digests, excessive variables, and private error fields.
- [x] Run `bunx vitest run shared/product-graphql.test.ts` and observe module-not-
  found failure.
- [x] Add schema classes with these externally visible shapes:

```ts
export class ProductGraphqlPolicy extends Schema.Class<ProductGraphqlPolicy>(
  "ProductGraphqlPolicy",
)({
  version: Schema.Literal(1),
  id: ProductAdapterPolicyId,
  endpoint: ProductHttpsEndpoint,
  operationId: ProductOperationId,
  operationName: ProductGraphqlOperationName,
  operationType: Schema.Literals(["query", "mutation"]),
  documentSha256: Sha256,
  requestBytes: ByteLimit,
  responseBytes: PositiveByteLimit,
  deadlineMs: DeadlineMillis,
}) {}

export class ProductGraphqlRequest extends Schema.Class<ProductGraphqlRequest>(
  "ProductGraphqlRequest",
)({ version: Schema.Literal(1), policyId: ProductAdapterPolicyId, variables: Schema.Json }) {}

export class ProductGraphqlFailure extends Schema.TaggedErrorClass<ProductGraphqlFailure>()(
  "ProductGraphqlFailure",
  {
    policyId: ProductAdapterPolicyId,
    reason: Schema.Literals([
      "invalid-policy", "denied", "invalid-variables", "transport",
      "deadline", "oversized-response", "invalid-response", "product-denied",
    ]),
    message: Schema.Literal("The product GraphQL operation failed safely."),
  },
) {}
```

- [x] Put shared identifiers and strict byte/deadline filters in this one schema
  module; do not duplicate HTTP policy schemas.
- [x] Re-run the focused test and observe all cases pass.

## Task 2: Implement the fixed-document GraphQL Effect service

**Files:**

- Create: `src/capabilities/product-graphql.test.ts`
- Create: `src/capabilities/product-graphql.ts`

**Consumes:** Task 1 contracts and existing `ProductHttp`.

**Produces:** `ProductGraphql` Context service and
`makeProductGraphqlLayer({ registrations, credentialHeaders? })`.

- [x] Write failing tests proving: only registered policy is accepted; canonical
  document digest is checked during Layer construction; callers cannot replace
  endpoint/document/name/headers; private credentials are inserted after public
  validation; variables and responses are byte-bounded; timeout is typed;
  malformed JSON and GraphQL errors are sanitized; no credential or resolver
  detail occurs in encoded output/error.
- [x] Observe `bunx vitest run src/capabilities/product-graphql.test.ts` fail on
  the missing service.
- [x] Implement the service with an explicit shape:

```ts
export interface ProductGraphqlShape {
  readonly invoke: (
    request: ProductGraphqlRequest,
  ) => Effect.Effect<ProductGraphqlResponse, ProductGraphqlFailure>;
}

export class ProductGraphql extends Context.Service<
  ProductGraphql,
  ProductGraphqlShape
>()("flect/ProductGraphql") {}
```

- [x] Validate all registrations once in `Layer.effect`; SHA-256 the exact UTF-8
  document with the Effect crypto service/helper already used by capsules.
- [x] Encode only `{ operationName, query, variables }`, use an internally
  constructed `ProductHttpPolicy`/`ProductHttpRequest`, and decode the body with
  `Schema.parseJson` plus the strict GraphQL response schema.
- [x] Map every HTTP/private error through `ProductGraphqlFailure`; never include
  response bodies, exception text, headers, documents, or credentials.
- [x] Re-run Task 2 tests and the existing product HTTP tests.

## Task 3: Make unary product operations transport-neutral

**Files:**

- Modify: `src/capabilities/product-capability-registry.test.ts`
- Modify: `src/capabilities/product-capability-registry-policy.test.ts`
- Modify: `src/capabilities/product-capability-registry.ts`
- Modify: `src/capabilities/product-capability-diagnostic.tsx`
- Modify: `src/lib/runtime.ts`

**Produces:** A transport-neutral `ProductOperationDefinition` while preserving
`catalog`, `permissions`, `decide`, `revoke`, `invoke`, and `invokeDetailed`.

- [x] Change tests first to construct operations with:

```ts
export interface ProductOperationDefinition {
  readonly id: string;
  readonly capabilityId: string;
  readonly authorize: (
    input: ProductJson,
  ) => Effect.Effect<AuthorizedProductOperation, ProductOperationFailure>;
  readonly execute: (
    input: ProductJson,
  ) => Effect.Effect<ProductJson, ProductOperationFailure>;
}
```

- [x] Add a failing GraphQL-backed definition test that proves product denial
  happens before `execute`, a widened authorization fails before `execute`, and
  provider/model metadata cannot alter registry policy.
- [x] Run the two registry test files and observe type/test failure against the
  HTTP-specific interface.
- [x] Refactor `invokeDetailed` to reserve, authorize, validate, execute, and
  strict-decode `Schema.Json` in that order. Preserve every existing public
  failure reason and receipt.
- [x] Update the diagnostic and stock runtime definitions by putting their
  existing `ProductHttp.invoke` + response projection inside `execute`.
- [x] Re-run focused registry, runtime, AXI, controller, and product capability
  tests.

## Task 4: Define strict event contracts

**Files:**

- Create: `shared/product-events.test.ts`
- Create: `shared/product-events.ts`

**Produces:** `ProductEventPolicy`, `ProductEventRequest`, `ProductEvent`, and
`ProductEventFailure`.

- [x] Write failing tests for valid sequence-aware policy/request/event plus
  unknown fields, zero/unbounded capacity, excessive retry count/delay/event
  bytes, empty/oversized cursor, and non-JSON payload.
- [x] Observe module-not-found RED.
- [x] Implement schema classes with maximums: capacity 1–256, event size 1
  byte–1 MiB, reconnect attempts 0–10, reconnect delay 100–60,000 ms, cursor
  1–256 UTF-8 characters, and request input `Schema.Json`.
- [x] Give the error only policy ID, closed reason union, and fixed public copy.
- [x] Re-run focused tests GREEN.

## Task 5: Implement scoped bounded event transport

**Files:**

- Create: `src/capabilities/product-events.test.ts`
- Create: `src/capabilities/product-events.ts`

**Consumes:** Task 4 and Effect `Stream`, `Queue`, `Scope`, `Deferred`, `Clock`.

**Produces:** `ProductEvents`, `ProductEventConnector`, and
`makeProductEventsLayer({ policies, connectors })`.

- [x] Write failing Effect tests proving: connector starts only for registered
  policy; queue capacity applies backpressure; every event is decoded and
  byte-bounded before offer; duplicate/regressing sequences fail; last accepted
  cursor is passed to reconnect; retries stop exactly at policy count;
  TestClock controls reconnect delay; interruption aborts connector and closes
  queue; overflow/private connector failure is sanitized.
- [x] Observe focused RED.
- [x] Implement the connector contract:

```ts
export interface ProductEventConnector {
  readonly open: (options: {
    readonly request: ProductEventRequest;
    readonly resumeAfter?: string;
    readonly signal: AbortSignal;
    readonly emit: (event: unknown) => Effect.Effect<void, ProductEventFailure>;
  }) => Effect.Effect<void, ProductEventFailure>;
}

export interface ProductEventsShape {
  readonly subscribe: (
    request: ProductEventRequest,
  ) => Stream.Stream<ProductEvent, ProductEventFailure>;
}
```

- [x] Construct each subscription with `Stream.unwrapScoped`, a bounded Queue,
  an AbortController finalizer, and one owned connector fiber. Reconnect by an
  explicit bounded loop using `Clock.sleep`, never `retry` without a cap.
- [x] Use queue backpressure; do not choose dropping or sliding semantics.
- [x] Re-run Task 5 tests GREEN and run leak/cancellation tests repeatedly.

## Task 6: Bind event subscriptions to capability reservations and revocation

**Files:**

- Modify: `src/capabilities/product-capability-broker.test.ts`
- Modify: `src/capabilities/product-capability-broker.ts`
- Create: `src/capabilities/product-event-registry.test.ts`
- Create: `src/capabilities/product-event-registry.ts`

**Produces:** `ProductCapabilityBroker.inspectReservation` and
`ProductEventRegistry.subscribe(context, invocation)`.

- [x] First write broker tests proving a reservation becomes `revoked`,
  `expired`, or `denied` when its exact decision changes after reservation.
- [x] Add `inspectReservation(reservation)` as a read-only Effect that checks
  the current decision ID/status/expiry without consuming another invocation.
  Preserve `validate` as scope-subset validation.
- [x] Write event-registry RED tests for reserve-before-authorize, product denial
  before connector, scope widening, revoke-while-idle, revoke-during-delivery,
  caller cancellation, and accepted-state preservation.
- [x] Implement registered `ProductEventDefinition` values with stable IDs,
  capability IDs, `authorize(input)`, and `request(input, resumeAfter?)`.
- [x] Use `Stream.interruptWhen` with a scoped finite-interval watcher that calls
  `inspectReservation`; map revocation/expiry to closed event failures and let
  scope interruption release the connector immediately.
- [x] Re-run broker/event registry/event transport suites GREEN.

## Task 7: Add the public reference adapter composition

**Files:**

- Create: `examples/product-adapter/README.md`
- Create: `examples/product-adapter/reference-product.ts`
- Create: `examples/product-adapter/reference-product.test.ts`
- Create: `tests/fixtures/reference-product-capsule.ts`

**Produces:** `makeReferenceProductLayer` and deterministic fixtures for one
offline operation, browser-direct GraphQL query, authenticated GraphQL mutation,
and sequence-aware event subscription.

- [x] Write the example consumer test before the implementation. Import only
  exported shared contracts and capability services; do not reach into React,
  storage keys, journals, or private runtime modes.
- [x] Prove product denial beats user approval, host credential text never
  occurs in encoded values/log capture, and changing inference ownership from
  `user` to `product` leaves capability authorization identical.
- [x] Implement the smallest composition and a recommended deterministic
  capsule fixture with public App Agent instructions naming only operation IDs.
- [x] Document a copyable Effect Layer composition starting with the offline
  operation, then GraphQL/events as optional additions.
- [x] Re-run example tests GREEN.

## Task 8: Prove the reference product in production Chromium

**Files:**

- Create: `src/capabilities/product-adapter-diagnostic.tsx`
- Modify: `src/main.tsx`
- Create: `tests/e2e/product-adapter.spec.ts`
- Modify: `playwright.config.ts` only if the existing production server cannot
  route the explicit diagnostic query.

**Produces:** Visible public-browser evidence for GraphQL, events, cancellation,
denial, and recovery.

- [x] Write Playwright RED against `/?reference-product-diagnostic=1`:
  protected permission review; query and mutation through named operations;
  sanitized product denial; two ordered events; cancel; persistent permission
  recovery after reload; accepted interface remains usable offline; no secret
  text in DOM, console, request bodies, or screenshots.
- [x] Implement the diagnostic as ordinary protected components wired to the
  reference Layer. It may select deterministic in-memory transports but must
  use the real broker, registries, and schemas.
- [x] Run `bunx playwright test tests/e2e/product-adapter.spec.ts` GREEN, then
  rerun `tests/e2e/product-capability.spec.ts` and portable-extension workflows.

## Task 9: Document, gate, and dogfood the exact packaged artifact

**Files:**

- Modify: `docs/product-capabilities.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/trust-model.md` only if the authority topology changed
- Modify: `README.md`
- Create: `docs/verification/2026-08-03-product-adapter-verification.md`
- Update: this plan checkboxes

- [x] Replace the GraphQL/events “open work” statement with exact implemented
  mechanics, keeping the executable schemas as contract source of truth.
- [x] Run focused tests, `bun run check:all`, `cargo fmt --check`, and
  `git diff --check` from a fresh command.
- [x] Safely replace `/Applications/Flect.app` with the exact gated bundle after
  moving the prior app to a unique recoverable Trash path.
- [x] Prove source/install parity, hashes, signature/notarization truth, exactly
  one window, and Local control off.
- [x] Dogfood GraphQL query, product denial, event delivery, cancellation, and
  offline recovery through packaged UI/AX surfaces; prove revocation and both
  inference owners through the reference Effect composition and browser gate.
- [x] Record exact commands, counts, timings, screenshots, failures, recovery,
  limitations, branch/base/dirty caveat, and artifact hashes in the report.
- [x] Add exact evidence to issue #7 without closing it; no commit or push.

## Plan self-review

- Every #7 required behavior maps to a test-first task and public proof.
- The plan preserves named operations, product authorization, credential
  locality, strict host policy, safe mode, accepted state, and revocation.
- GraphQL documents and event connectors remain trusted host composition; no
  capsule/agent raw transport was added.
- Event memory, reconnects, sequences, scope, and shutdown are explicitly
  bounded.
- #12 native capabilities, #13 remote runtimes, and #28 SDK publication remain
  separate issues rather than hidden scope.
