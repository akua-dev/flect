# Flect product SDK references

These are four independently adoptable `@flect/product` integrations. Product
source imports only the public SDK, Effect, and the local capsule helper. The
test harness imports Flect's private runtime bridge because grants and protected
state belong to Flect, not to product code.

## Offline board

[`offline-board.ts`](offline-board.ts) is the smallest shape: local list/add
operations, no fetch, no authentication, user inference by default, and one
recommended capsule whose public guide may be enabled separately for App Agent
and Shaper.

## Browser projects

[`browser-projects.ts`](browser-projects.ts) adds one SHA-256-pinned GraphQL
query and one bounded ordered event policy. Caller input cannot choose an
endpoint, document, header, socket, queue, or reconnect behavior. It assumes a
product-owned browser session and surfaces offline as adoption state while the
accepted interface and personal fork remain available.

## Brokered incidents

[`brokered-incidents.ts`](brokered-incidents.ts) adds two fixed named broker
operations. The broker callback's closure owns authentication; its request
contains only an operation ID and decoded JSON. Independent product denial runs
before the callback, and callback defects become a fixed public failure.
Product inference is the default, but switching to user inference does not
change authorization.

## Private sharing

[`private-sharing.ts`](private-sharing.ts) composes a named private source at
the trusted host boundary. The credential exists only in the transport closure;
the public source descriptor contains an opaque adapter ID and reference. Raw
transport failures and defects become a fixed `ShareSourceFailure`, and the
returned archive bytes still pass through Flect's ordinary quarantine and
inactive review before any retain or activation decision.

Run the complete public-boundary proof:

```bash
bunx vitest run examples/product-sdk/reference-products.test.ts
```

The suite proves operation behavior, recommended capsule/extension decoding,
protected grants, denial precedence, ordered cancellation, inference
invariance, private-source closure boundaries, secret absence, personal
fork/export preservation, and detach.
