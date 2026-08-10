# Reference product adapter

This example is the smallest executable product-host composition for Flect. It
keeps interface code, App Agent, Shaper, and embedded Bash on four stable named
operations while trusted Effect Layers own product authorization, fixed
GraphQL documents, credentials, transport limits, event ordering, and cleanup.

The complete composition is in
[`reference-product.ts`](./reference-product.ts), and its consumer-facing proof
is in [`reference-product.test.ts`](./reference-product.test.ts).

## What it exposes

| Operation | Transport | Product authority |
| --- | --- | --- |
| `reference.status` | Offline Effect | Read local product status |
| `reference.projects.list` | Fixed GraphQL query | Read one workspace summary |
| `reference.projects.archive` | Fixed GraphQL mutation | Write project `alpha` |
| `reference.projects.subscribe` | Bounded Effect Stream | Read ordered workspace events |

Callers receive JSON or a schema-backed public failure. They cannot supply an
endpoint, GraphQL document, transport header, credential, socket, retry loop, or
event queue.

## Compose it

Start with a product-owned capability-decision store and connector, then provide
the resulting Layer wherever Flect's `ProductCapabilityRegistry` and
`ProductEventRegistry` are used:

```ts
import { Effect, Layer } from "effect";
import { ProductCapabilityDecisionStore } from
  "../../src/capabilities/product-capability-decision-store";
import { makeReferenceProductLayer } from "./reference-product";

const decisionStore = Layer.succeed(ProductCapabilityDecisionStore)({
  load: () => Effect.succeed({ decisions: [] }),
  save: () => Effect.void,
});

const ReferenceProductLive = makeReferenceProductLayer({
  inferenceOwner: "user",
  credentialHeaders: (policyId) =>
    policyId === "reference.projects.archive.v1"
      ? readCredentialFromProductHost()
      : Effect.succeed([]),
  authorize: ({ operationId, input }) =>
    productPolicyAllows(operationId, input),
  eventConnector: productEventConnector,
}).pipe(Layer.provide(decisionStore));
```

The in-memory store above is intentionally test-only. A real host provides the
existing durable decision store. `readCredentialFromProductHost`,
`productPolicyAllows`, and `productEventConnector` are host-owned Effects; they
must return only their public typed result and never log private failure detail.

For an offline-only product, copy the `reference.status` definition and omit the
GraphQL and event registrations. Flect still applies the same reserve → product
authorize → scope validate → execute ordering.

## Invoke safely

The user first grants a requested capability through the protected broker. A
trusted caller can then invoke a named operation:

```ts
const projects = yield* registry.invoke(
  referenceProductContext,
  ProductOperationInvocation.make({
    version: 1,
    operationId: "reference.projects.list",
    input: { workspaceId: "reference-workspace" },
  }),
);
```

A user grant never overrides product policy. If `authorize` returns `false`, the
operation returns `product-denied` before GraphQL or event transport starts.
Changing `inferenceOwner` between `user` and `product` changes who pays for
inference, not the capability manifest, decision binding, or product
authorization.

## Events and cancellation

`reference.projects.subscribe` has an eight-event backpressure queue, a 16 KiB
event ceiling, canonical decimal sequences, two reconnect attempts, and a 250 ms
retry delay. The connector receives the last accepted sequence after reconnect.
Caller cancellation, app disposal, or grant revocation aborts the connector and
releases its scoped work.

## Capsule fixture

[`reference-product-capsule.ts`](../../tests/fixtures/reference-product-capsule.ts)
builds a deterministic `.flect` fixture declaring the same four product
capabilities. Its App Agent extension mentions only named operations and
explicitly refuses raw URLs, documents, credentials, cookies, sockets, and
transport access.

Run the focused proof with:

```sh
bunx vitest run examples/product-adapter/reference-product.test.ts \
  tests/fixtures/reference-product-capsule.test.ts
```
