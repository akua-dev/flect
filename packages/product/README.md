# @flect/product

Effect-first contracts and trusted-host adapters for products that adopt Flect
as a user-personalizable interface shell.

The package is browser-portable ESM with no React, Tauri, Node-runtime, or Flect
application dependency. Its public surface is limited to:

- strict versioned capsule, extension, capability, transport, integration, and
  adoption Effect Schemas;
- `defineProductIntegration` for validating one product definition and its
  recommended `.flect` experience;
- deterministic compatibility, migration, update, fork, and detach evaluation;
- policy-fixed HTTP and GraphQL Layers; and
- bounded, ordered, cancellable event Layers.

Flect keeps the decision store, grants, protected permission UI, workspace Git,
safe mode, recovery, and capsule activation private. A product cannot approve
itself, replace a personal fork, or receive a general proxy.

## Install

The SDK is currently a `0.1.0` developer-preview workspace package. From this
repository, build and verify a standalone tarball:

```bash
bun install --frozen-lockfile
bun run product:package
npm install ./dist-product-sdk/flect-product-0.1.0.tgz effect@4.0.0-beta.102
```

The packaging command builds declarations, creates an allowlisted tarball,
installs it into a clean temporary consumer, typechecks that consumer, and runs
its smallest offline product. It does not publish to npm.

Once a registry release exists, the intended install is:

```bash
bun add @flect/product@0.1.0 effect@4.0.0-beta.102
```

## Smallest integration

An adopter supplies a recommended capsule plus named closures. The product
never receives a grant method:

```ts
import {
  AuthorizedProductOperation,
  defineProductIntegration,
  ProductCapabilityManifest,
} from "@flect/product";
import { Effect } from "effect";

const capability = ProductCapabilityManifest.make({
  version: 1,
  id: "product.example.status",
  name: "Read status",
  description: "Read one offline status.",
  operationIds: ["example.status"],
  resourceIds: ["example.workspace"],
  dataClassIds: ["example.status"],
  confirmationPolicies: ["session"],
});

export const makeExampleProduct = (
  capsule: Uint8Array,
  archiveSha256: string,
) =>
  defineProductIntegration({
    metadata: {
      version: 1,
      descriptor: {
        version: 1,
        id: "dev.example.product",
        name: "Example product",
        description: "The smallest offline Flect product.",
        integrationVersion: "1.0.0",
        revision: "v1",
        productApiVersion: 1,
        connection: "offline",
        authenticationOwner: "none",
        compatibility: {
          flect: ">=0.2.0 <1.0.0",
          platforms: ["browser"],
        },
        inference: { allowedOwners: ["user"], defaultOwner: "user" },
      },
      experience: {
        version: 1,
        capsuleId: "dev.example.product",
        capsuleVersion: "1.0.0",
        archiveSha256,
        provenanceRevision: "v1",
        appExtensionIds: [],
        shaperExtensionIds: [],
      },
      capabilities: [capability],
      migrations: [],
    },
    operations: [
      {
        id: "example.status",
        capabilityId: capability.id,
        authorize: () =>
          Effect.succeed(
            AuthorizedProductOperation.make({
              version: 1,
              capabilityId: capability.id,
              operationId: "example.status",
              resourceIds: ["example.workspace"],
              dataClassIds: ["example.status"],
            }),
          ),
        execute: () => Effect.succeed({ status: "ready" }),
      },
    ],
    events: [],
    selectedInferenceOwner: "user",
    loadRecommendedExperience: Effect.succeed(capsule),
  });
```

Create deterministic capsule bytes with `encodeCapsule`, and calculate the
descriptor digest with `hashCapsuleArchive`. `defineProductIntegration`
strictly validates cross-references, selected inference ownership, migrations,
and the archive digest before returning a branded integration.

## Choose a connection model

| Model | Authentication | Intended use |
| --- | --- | --- |
| `offline` | `none` | Local data and deterministic product logic; no transport |
| `browser-direct` | `product` | Same-origin session or explicitly CORS-compatible fixed API |
| `brokered` | `host` | Named callback whose closure privately owns credentials |

Browser-direct adapters omit ambient credentials, reject redirects, and allow
only registered HTTPS origins, paths, methods, headers, documents, and bounds.
A broker callback receives a fixed operation ID and decoded bounded input, not
an arbitrary URL or method. Keep long-lived credentials inside the callback's
closure; never put them in metadata, capsules, instructions, model context,
results, diagnostics, or logs.

User approval and product authorization are independent gates. Flect reserves
the user's exact capability decision first, then runs product authorization,
validates the returned resource/data projection, and only then calls the
transport. Product denial always wins.

Inference ownership is presentation and cost policy, not authority. Switching
between a user-paid model and product-provided inference cannot alter an
endpoint, document, capability, credential source, or authorization result.

## Reference products

The repository contains four executable public-boundary examples:

- [`offline-board.ts`](../../examples/product-sdk/offline-board.ts) — mutable
  local state, App Agent guidance, and an optional Shaper extension;
- [`browser-projects.ts`](../../examples/product-sdk/browser-projects.ts) — one
  fixed GraphQL query and a bounded ordered event subscription; and
- [`brokered-incidents.ts`](../../examples/product-sdk/brokered-incidents.ts) —
  fixed read/acknowledge operations through an authenticated named callback;
- [`private-sharing.ts`](../../examples/product-sdk/private-sharing.ts) — a
  closure-private source adapter whose archive still enters ordinary quarantine
  and inactive review.

Their adopter files import the SDK, Effect, and local example utilities—never
Flect application internals. The Flect-owned test harness attaches them to the
private broker and proves grants, denial precedence, cancellation, inference
invariance, secret sanitization, personal forks, and detach recovery.

## Updates, forks, and detach

Persist `createProductConnectionRecord(integration)` separately from
`ProductUserState`. On discovery or reconnect, run `evaluateProductAdoption`
with current host facts. The ordered diagnostics distinguish product update,
capability review, extension review, required/blocked migration, offline,
incompatible host, and preserved personal work.

`detachProduct` removes only the product connection from the returned snapshot.
It preserves the user's fork revision, exported snapshot digest, and decision
references so the protected host can offer export or revocation. It never
deletes a workspace, Git ref, capsule, or export.

## Export paths

- `@flect/product` — complete supported surface;
- `@flect/product/contracts` — schemas, public errors, and integration/adoption
  contracts; and
- `@flect/product/host` — HTTP, GraphQL, and event services/Layers.

This package is a pre-1.0 developer-preview contract. See the repository
[product-adoption guide](../../docs/product-capabilities.md),
[trust model](../../docs/trust-model.md), and reference tests before
distributing an integration. Native credential brokerage, registry publication,
signing, and stable 1.0 compatibility are not claimed yet.
