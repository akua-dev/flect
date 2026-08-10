# Flect typed product-adapter design

Date: 2026-08-03
Issue: #7
Affected quality criteria: FQ-05.2–FQ-05.7, FQ-11.4–FQ-11.7,
FQ-13.3–FQ-13.5, FQ-15.7–FQ-15.9, FQ-16.3, FQ-21.1, FQ-21.4, FQ-22.4

## Outcome

A product host can expose unary HTTP, fixed-document GraphQL, and bounded
resumable event capabilities through the same protected Flect broker. Capsules,
App Agent, Shaper, embedded Bash, and outside control continue to see only named
operations and bounded JSON. They never receive a URL, GraphQL document,
credential, cookie, socket, transport exception, or reconnect primitive.

This closes the first transport-adapter slice required by product adoption. It
does not publish the final standalone SDK or implement remote runtime pairing,
native OS capabilities, databases, or arbitrary transport plugins.

## Existing boundary

Flect already has strict Effect Schema contracts for capability manifests,
request binding, decisions, reservations, invocations, results, and bounded
HTTP. `ProductCapabilityRegistry` reserves user authority, asks trusted host code
for the exact product-authorized scope, validates that scope, invokes
`ProductHttp`, and decodes JSON output. Product credentials are inserted only by
the HTTP layer after caller headers are validated.

The missing behavior is transport independence, fixed GraphQL operations,
bounded event ownership, live revocation for long-running work, and one adopter
example that proves the contracts instead of requiring Flect internals.

## Considered approaches

### Raw transport capabilities

Expose bounded `fetch`, GraphQL, SSE, or WebSocket primitives to capsules. This
is flexible but makes interface code responsible for origins, documents,
credentials, reconnect behavior, and data minimization. It violates the named
operation and least-authority model and is rejected.

### One declarative mega-configuration

Describe every HTTP, GraphQL, event, authentication, mapping, and retry detail
in one serializable product manifest. This is easy to inspect but turns Flect
into a transport DSL, makes product-specific authorization awkward, and would
prematurely freeze the eventual SDK. It is rejected for version 1.

### Named operations backed by typed host adapters

Keep the public capability surface as stable operation IDs. Trusted host code
performs independent product authorization and selects a typed HTTP, GraphQL,
or event adapter. Effect services own transport, resources, cancellation, and
sanitized failures. This extends the existing architecture without expanding
capsule authority and is selected.

## Unary operation architecture

`ProductCapabilityRegistry` becomes transport-neutral. A
`ProductOperationDefinition` contains:

- stable operation and capability IDs;
- `authorize(input)`, which returns only the exact
  `AuthorizedProductOperation` resource/data projection or a sanitized product
  denial; and
- `execute(input)`, which performs trusted adapter work and returns bounded
  `ProductJson` or `ProductOperationFailure`.

Invocation order remains authoritative:

1. find the registered operation and reserve its capability/operation grant;
2. run product authorization without transport;
3. validate the authorized resource/data scope against the reservation;
4. execute the trusted adapter;
5. decode the result as bounded JSON; and
6. record only payload-free receipt metadata through the existing controller.

The existing HTTP example is migrated to this interface by making its execute
effect invoke `ProductHttp`. No capsule or agent API changes.

## GraphQL contract

`shared/product-graphql.ts` owns closed version-1 schemas:

- `ProductGraphqlPolicy`: policy ID, exact HTTPS endpoint, fixed operation ID,
  operation name, query or mutation kind, canonical document SHA-256, request
  and response byte ceilings, and deadline;
- `ProductGraphqlRequest`: policy ID and bounded JSON variables only;
- `ProductGraphqlResponse`: bounded JSON data plus bounded public GraphQL errors
  containing stable code and public message only; and
- `ProductGraphqlFailure`: invalid policy, denied, invalid variables,
  transport, deadline, invalid response, product denied, or oversized response.

The trusted `makeProductGraphqlLayer` registration holds the canonical GraphQL
document and optional credential-header Effect. The caller cannot provide or
replace the endpoint, document, operation name, transport headers, or
credentials. Construction verifies that the document digest and operation
metadata match the policy. Invocation encodes `{operationName, query,
variables}`, uses the existing bounded HTTP transport with a private policy,
requires a JSON response, and maps all transport/private GraphQL detail to the
closed public failure contract. Product `errors` make the operation fail unless
the registered projection explicitly maps a safe partial result.

## Event contract

`shared/product-events.ts` owns closed version-1 schemas:

- `ProductEventPolicy`: policy ID, operation ID, maximum buffer capacity,
  maximum event bytes, maximum reconnect attempts, reconnect delay, and whether
  sequence resumption is required;
- `ProductEventRequest`: policy ID, bounded JSON input, and optional public
  sequence cursor;
- `ProductEvent`: policy ID, canonical unsigned-decimal monotonic sequence, and bounded
  JSON payload; and
- `ProductEventFailure`: invalid policy, denied, invalid event, overflow,
  sequence violation, transport, reconnect exhausted, or revoked.

`ProductEventConnector` is a trusted host interface. It receives the validated
request, last accepted sequence, an abort signal, and an Effectful emit
function. The emit function applies backpressure to a bounded Effect Queue. A
connector that bypasses the emit contract is not a Flect adapter.

`makeProductEventsLayer` returns a scoped `Stream<ProductEvent,
ProductEventFailure>`. Scope interruption aborts the connector, shuts down the
queue, and joins owned work. Events are decoded and byte-bounded before enqueue.
Duplicate or regressing sequence values fail closed. When policy permits,
transport failure reconnects no more than the declared attempts and passes only
the last accepted sequence to the connector. No unbounded accumulation,
silent dropping, or reconnect forever behavior is allowed.

The capability registry adds a separate `subscribe` path for registered event
definitions. Starting a subscription consumes a normal reservation. A scoped
revocation watcher checks the exact decision while the stream is open and
interrupts the connector with a sanitized revoked failure. App shutdown,
component disposal, command cancellation, and explicit subscription
cancellation all close the same scope.

## Authentication and product authorization

Credentials remain host-owned Effects. GraphQL and event connectors receive
them only inside trusted transport composition. Public schemas, operation
inputs, event payloads, output, journals, capsules, Git, Pi messages, and logs
have no credential field.

User approval and product authorization are independent. The registry reserves
user authority first, but product `authorize` may still deny. A product denial
never becomes a transport call. Changing model provider or inference ownership
does not change the registered product policy, authorization function, or
decision binding.

## Reference integration

`examples/product-adapter/` is a small documented product host, not a second
Flect runtime. It provides:

- an offline local status operation;
- one browser-direct fixed GraphQL query with no credential;
- one authenticated fixed GraphQL mutation whose credential supplier is
  replaced by a test-only host layer;
- one sequence-aware event subscription; and
- a recommended capsule fixture whose App Agent can discover the same named
  operations.

The example composes public Effect Schemas, services, and Layers only. It shows
that a product can use its own inference policy or the user-selected Pi provider
without changing operation authorization. It contains no real secret, remote
dependency, or product-specific code in the Flect shell.

## Failure and recovery

All adapter failures are schema-backed tagged errors with fixed public copy.
Private response bodies, GraphQL resolver messages, stack traces, credential
errors, connector URLs, and retry exceptions are discarded at the adapter
boundary. A failed unary operation leaves accepted state unchanged. A failed or
revoked event stream releases resources and leaves the accepted capsule usable;
the user may retry through the same protected operation.

Unknown policies, endpoint/document mismatches, absolute caller URLs, extra
headers, invalid JSON, response overrun, event overrun, sequence regression,
buffer saturation, retry exhaustion, and cancellation are explicit tests.

## Verification

Contract and Effect tests prove strict schemas, policy construction, private
credentials, denial-before-transport, byte/deadline bounds, sanitized failures,
bounded backpressure, ordered resume, finite reconnect, revocation, and scope
cleanup. Tests are written and observed failing before implementation.

Production Chromium drives the reference capsule through protected permission
review, App Agent/embedded `flect`, GraphQL success and product denial, event
delivery, cancellation, and offline accepted-state recovery. The same built
contracts are then dogfooded in the exact packaged macOS app. Evidence is
recorded in a dated verification report and issue #7 remains open until Git
delivery is authorized.

## Documentation ownership

- `shared/product-graphql.ts` and `shared/product-events.ts` own executable wire
  contracts.
- `docs/product-capabilities.md` owns adopter mechanics.
- `ARCHITECTURE.md` owns implemented topology after proof.
- `docs/trust-model.md` owns authority boundaries.
- `README.md` links the smallest adopter quickstart only after the example is
  executable.
- A dated report under `docs/verification/` owns evidence and limitations.

## Non-goals

- Raw fetch, WebSocket, SSE, GraphQL documents, SQL, or credentials for
  capsules or agents.
- A generic unrestricted proxy.
- Remote non-loopback Flect runtime implementation.
- Native OS capabilities or Swift work.
- A complete public package/release of the product-adoption SDK; #28 owns that
  packaging and its three full reference products.
