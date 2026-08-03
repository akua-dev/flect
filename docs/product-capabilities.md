# Product capability adoption

Flect products expose named operations, never raw network access. A capsule or
App Agent may request `projects.list`; only trusted host composition knows that
this maps to a particular API, which credentials and policy apply, and which
bounded result is safe to return.

This document owns the adopter mechanics. The authority model lives in
[`docs/trust-model.md`](trust-model.md), and the implemented topology lives in
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Effect services

An adopter composes the transport services it needs at the trusted runtime
root:

1. `ProductCapabilityDecisionStore` persists strict version-2 decisions through
   protected `InterfaceStorage` and migrates matching legacy boolean state.
2. `ProductCapabilityBroker` owns lifecycle, exact request binding, scope,
   lifetime, rate limits, atomic reservation, and revocation.
3. `ProductCapabilityRegistry` maps stable unary operation IDs to one
   capability, independent product authorization, and bounded input/output
   projections.
4. `ProductHttp` owns HTTPS origin, path prefix, method, header, byte, deadline,
   transport, and private credential policy.
5. `ProductGraphql` pins an exact HTTPS endpoint, operation metadata, canonical
   document digest, document bytes, variable/result bounds, deadline, and
   private credential Effect behind a named operation.
6. `ProductEvents` owns a scoped connector, bounded backpressure queue, strict
   event decoding, canonical decimal sequence, finite reconnect policy, cursor
   resume, and cancellation. `ProductEventRegistry` binds that stream to the
   same broker reservation and live revocation lifecycle.

All are `Context.Service` contracts with named Layers. Capsules and agents see
only stable operation IDs plus bounded JSON. They never receive an origin,
GraphQL document, credential, cookie, socket, queue, or reconnect primitive.

## Public SDK boundary

The separately versioned [`@flect/product`](../packages/product/) package owns
the public contracts and transport-only Layers. Its supported exports are the
root module, `/contracts`, and `/host`; it has an exact Effect peer and no React,
Tauri, Node-runtime, or Flect application dependency. A built tarball contains
only declarations/ESM, package metadata, README, and license and is executed in
a clean consumer by `bun run product:package`.

`defineProductIntegration` joins strict product metadata, capability manifests,
named unary/event closures, a selected inference owner, and one digest-verified
recommended capsule. `evaluateProductAdoption` compares that integration with
host facts, a prior product connection record, and separate user state. Its
ordered diagnostics cover ready, offline, product update, capability/extension
review, incompatible host/Flect, unavailable authentication, required/blocked
migration, preserved fork, and detach. `detachProduct` clears the product
connection only; Flect remains responsible for any protected grant revocation
and never deletes the user's workspace, Git ref, capsule, or export.

The package deliberately does not export the decision store, capability broker,
protected permission UI, operation journal, workspace storage, capsule
activation, or safe mode. Those remain Flect-owned. The internal runtime bridge
consumes the same public operation/event types, so SDK and application contracts
cannot drift.

## Immutable request binding

Each decoded capsule becomes a `ProductCapabilityRequestContext` containing:

- capsule scope ID;
- Flect workspace ID;
- SHA-256 of the exact `.flect` archive;
- capsule provenance revision; and
- the exact requested capability IDs and required flags.

A decision matches all of that binding. Updating archive bytes, changing the
declared request, or replacing the capsule cannot silently widen an older
decision. Two apps requesting the same capability remain independent.

The host registers a strict `ProductCapabilityManifest` for every capability:
operation IDs, resource IDs, data classes, permitted confirmation policies, and
optional maximum duration and rate. Capsule content and model output cannot
register or expand a manifest.

## Lifecycle and user choices

Protected review projects one lifecycle value per request:

- `requested`: declared by the capsule and awaiting a decision;
- `available`: registered by the host but not requested by this capsule;
- `granted`: currently usable within the approved scope;
- `denied`: explicitly denied by the protected user;
- `expired`: its duration elapsed or its one-use allowance was consumed; or
- `revoked`: explicitly revoked.

Availability is separate: an unavailable request stays visible and blocks Keep
when required. The protected component shows operation/resource/data scope,
lifetime, rate, and decision identity without showing payloads or credentials.

An allow decision chooses one of the policies permitted by the manifest:

- `once`: in memory and atomically consumed by the next attempted operation;
- `session`: in memory until this Flect runtime ends;
- `workspace`: durable and valid only for the matching workspace; or
- `persistent`: durable for the exact capsule request binding.

Denial is durable. Revocation updates the existing decision and immediately
blocks later capsule and App Agent calls. A failed durable write leaves live
authority unchanged.

Only the protected user source can create a decision. Paired outside control may
run `flect permissions list` and revoke a visible decision with
`flect permissions revoke <decision-id>`; App Agent and Shaper may inspect but
cannot grant or revoke through their embedded command. There is deliberately no
agent-facing grant command.

## Invocation order

For each operation, Flect:

1. verifies the current accepted/candidate capsule binding and registered
   operation;
2. atomically reserves the matching decision, consuming one-use and rate
   allowance before product work;
3. runs the product's independent authorization projection;
4. validates its exact operation/resource/data scope against the reservation;
5. invokes the bounded unary adapter or opens the bounded event scope; and
6. decodes the bounded result.

User approval never overrides product authorization. Product denial and scope
widening stop before transport. Every attempted invocation adds structured,
payload-free capability metadata to the bounded operation journal: capsule
binding, decision, policy, operation, revision, and stable result reason.

## Host composition

Define `ProductCapabilityManifest` and operation definitions through
`@flect/product`, then select only the host adapters the product needs. Flect
composes the private decision store, broker, and registry at the protected
runtime root. The executable [`examples/product-sdk/`](../examples/product-sdk/)
directory contains independent offline, browser-direct, and authenticated
brokered integrations; the older combined
[`examples/product-adapter/`](../examples/product-adapter/) remains an
end-to-end adapter exercise.

For each operation:

- use a stable dotted operation ID such as `projects.list`;
- validate JSON input before constructing a transport request;
- keep HTTP paths, GraphQL endpoints/documents, and event connectors inside
  trusted host code;
- return an exact `AuthorizedProductOperation` resource/data projection;
- project the bounded response into JSON without secrets or raw transport
  errors; and
- keep registration and credentials in host-owned code.

Credential headers come from the host's Effect callback. They are inserted only
after caller input and headers are checked. Resolver defects are sanitized, and
credentials never appear in a response, permission projection, receipt,
journal, workspace snapshot, capsule, Pi prompt, interface document, revision,
or sandbox. A browser product should use its own protected same-origin session
or host endpoint; it must not embed a long-lived bearer secret in client code.

Fixed GraphQL registration validates the exact document SHA-256 and operation
kind/name before the Layer becomes available. Invocation sends only
`{ operationName, query, variables }` to that registration and treats private
GraphQL errors as `product-denied`.

Event connectors emit through the supplied Effect callback only. The queue
applies backpressure instead of dropping or growing. Each event is decoded and
byte-bounded before enqueue; duplicate or regressing decimal sequence values
fail closed. Reconnect passes only the last accepted cursor and stops at the
declared attempt count. Caller cancellation, component disposal, grant expiry,
or revocation aborts the same scoped connector.

## Current platform boundary

The stock distribution intentionally registers no product operation. The
browser and current desktop WebView execute the same schema-defined HTTP,
GraphQL, and event contracts. Browser-direct HTTP/GraphQL remains subject to
CORS, omits ambient browser credentials, and rejects redirects. OS-keystore
credentials or CORS-independent transport require a protected native adapter
behind the same contract; that adapter is not yet included. Database adapters,
arbitrary transport plugins, SDK registry publication, and stable 1.0
compatibility remain later work.

## Verification

Executable public contracts live in `packages/product/src`; the old `shared/`
and transport import paths are compatibility re-exports rather than duplicate
implementations. Store, broker, transport, authorization, receipt,
protected-UI, persistence, cancellation, resume, and production-Chromium proofs
live beside their implementations, in
`tests/e2e/product-capability.spec.ts`, and in
`tests/e2e/product-adapter.spec.ts`, `tests/e2e/product-adoption.spec.ts`, and
`scripts/product-sdk-package.test.ts`. Run `bun run check:all` and
`bun run product:package` before distributing a product integration. Adapter
evidence is recorded in
[`docs/verification/2026-08-03-product-adapter-verification.md`](verification/2026-08-03-product-adapter-verification.md);
SDK evidence is recorded in the dated verification report beside it.
