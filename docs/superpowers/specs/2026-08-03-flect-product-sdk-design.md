# Flect product-adoption SDK design

**Date:** 2026-08-03
**Issue:** [#28](https://github.com/akua-dev/flect/issues/28)
**Status:** Approved for inline PR implementation by the standing instruction to
continue without approval pauses

## Outcome

A product team can adopt Flect incrementally through a separately versioned
`@flect/product` package without importing Flect application internals. The
smallest adopter defines one offline named operation and a recommended
interface. More capable adopters add browser-direct HTTP or GraphQL, bounded
events, an authenticated broker callback, optional Shaper guidance, and
inference ownership without changing Flect's protected authority model.

The package is built and packed locally in this PR. External npm publication is
not performed because this worktree does not authorize registry mutation.
Read-only npm registry checks on 2026-08-03 returned 404 for
`@flect/product`, `@flect/product-sdk`, and
`@akua-dev/flect-product`; that shows no visible package, not ownership of an
npm scope.

## Decision

Use one workspace package, `packages/product`, as the source of truth for
public product contracts and transport adapters.

The rejected alternatives are:

1. **Root-package exports.** The root application is private and would couple
   adopters to Flect UI, storage, and runtime internals.
2. **A package that re-exports files outside its directory.** It works in the
   monorepo but produces a broken tarball and unreviewable transitive API.
3. **A separate repository now.** It would add release coordination before the
   public boundary has been proven by real consumers.

The package uses normal ESM, generated declarations, explicit subpath exports,
Effect 4 beta as an exact peer dependency, and no React or Tauri dependency.
The Flect application consumes the same package through a workspace dependency.

## Public package boundary

### Modules

- `@flect/product` exports the complete supported surface.
- `@flect/product/contracts` exports serializable schemas and public errors.
- `@flect/product/host` exports narrow trusted-host services and adapter
  constructors.
- No deep import is supported. The package export map prevents access to
  implementation files.

### Contract ownership

The package becomes the sole source of truth for existing product adapter,
capability, HTTP, GraphQL, and event schemas. Existing Flect import paths become
temporary compatibility re-exports, so the repository does not fork schemas.
Transport services that contain no protected Flect state also move into the
package. The decision store, capability broker, protected permission UI,
operation journal, workspace storage, capsule activation, and safe mode remain
private to Flect.

### Package artifacts

`bun run build` inside the package emits ESM and declarations to `dist/`.
`npm pack` contains only the license, README, package manifest, and built
public files. A clean temporary consumer installs the tarball, imports only
documented exports, compiles with TypeScript, and runs an Effect program. A
tarball consumer must not resolve the repository, `shared/`, or `src/`.

## Serializable adoption contract

All values that cross persistence, distribution, compatibility, or diagnostic
boundaries use strict named Effect Schemas.

### Product identity and compatibility

`ProductDescriptor` contains:

- contract version 1;
- stable dotted product ID;
- display name and bounded description;
- semantic integration version;
- product revision;
- product API version;
- connection kind: `offline`, `browser-direct`, or `brokered`;
- authentication owner: `none`, `product`, or `host`;
- supported Flect range and supported host platforms; and
- inference policy.

`ProductInferencePolicy` lists allowed owners (`user` and/or `product`) and
one default owner. Validation rejects an absent default, duplicates, an offline
product with non-`none` authentication, and a brokered product with
`none` authentication.

### Recommended experience

`ProductExperienceDescriptor` identifies one recommended capsule by ID,
semantic version, SHA-256 archive digest, compatibility, provenance revision,
and optional App/Shaper extension IDs. Archive bytes are supplied through a
trusted Effect callback and verified against the descriptor before Flect can
review them. Bytes, source files, extension code, credentials, and private
transport configuration are not embedded in the serializable product
descriptor.

### Product integration

A `ProductIntegration` combines validated public metadata with trusted
closures:

- capability manifests;
- unary operation definitions;
- event definitions;
- a scoped Effect that loads the recommended capsule bytes;
- optional product authorization;
- optional compatibility migrations; and
- the selected inference owner.

Unary and event definitions are the public interfaces already consumed by
Flect's registries. They return bounded public JSON and exact authorized
resource/data projections. The product integration never receives a method to
grant, accept, replace safe mode, read Pi state, or mutate user workspaces.

`defineProductIntegration` strictly validates metadata once, verifies unique
and cross-referenced capability/operation IDs, verifies the selected inference
owner, hashes the recommended archive, and returns a branded integration.
Private callback defects are normalized to a fixed
`ProductIntegrationFailure`; they do not enter diagnostics.

## Authority, authentication, and inference

User approval and product authorization remain two independent gates:

```text
named request
  -> Flect protected reservation
  -> product authorization
  -> exact scope validation
  -> trusted adapter
  -> bounded public result
```

The package does not expose a grant API. Product denial wins before transport.
Model provider, reasoning setting, and selected inference owner cannot alter a
capability manifest, decision binding, product authorization result, endpoint,
document, broker callback, or credential source.

Authentication rules by connection kind:

- **offline:** no credential and no transport;
- **browser-direct:** product-owned same-origin session or a CORS-compatible
  endpoint; no embedded long-lived bearer and no ambient credential default;
- **brokered:** an explicitly supplied named broker callback owns authentication
  and product authorization. It receives a fixed operation ID and decoded
  bounded input, not an arbitrary URL or method.

Native host capability availability is represented as compatibility data.
Unsupported native authentication degrades to an explicit diagnostic; it never
falls back to exposing a secret in browser JavaScript.

## User ownership, updates, and detach

Product metadata and user state are separate values. `ProductUserState`
contains only user-owned references:

- local fork workspace/ref;
- exported snapshot digest;
- user capability-decision IDs; and
- selected inference owner where policy permits.

A product integration cannot write this value. Flect owns persistence and
protected mutation.

`evaluateProductAdoption` compares a validated integration, host facts, an
optional prior product record, and user state. It returns a stable ordered list
of `ProductAdoptionDiagnostic` values with severity, reason, public message,
and recovery action. It covers:

- ready;
- offline product connection;
- product update;
- preserved user fork;
- capability review;
- extension review;
- incompatible Flect or host;
- unsupported authentication host;
- migration required or blocked; and
- detached product with preserved export/fork.

Product revision, recommended capsule version/digest, capability-set digest,
and extension-set digest are stored independently. A changed product cannot
silently reuse an old review.

`detachProduct` clears only the product connection record. It returns the same
user fork, exported snapshot, and grant identifiers for protected review or
revocation. It does not delete a workspace, capsule, Git ref, or export.

## Three reference adopters

Each adopter source file imports only `@flect/product`; Flect-owned harnesses
may import internal broker/runtime code to host it.

1. **Offline board**
   - no network or authentication;
   - deterministic list/add operations backed by an Effect service;
   - user-controlled inference by default;
   - recommended capsule and optional Shaper guide.
2. **Browser-direct projects**
   - fixed GraphQL query and bounded ordered event subscription;
   - CORS-compatible injected fetch in tests;
   - product-owned session policy, no embedded credential;
   - recommended capsule and optional Shaper guide.
3. **Brokered incidents**
   - fixed named read and acknowledge operations through an injected broker
     callback;
   - host-owned private credential inside the callback closure;
   - product-controlled inference by default while allowing user inference;
   - recommended capsule and optional Shaper guide.

Each fixture proves product denial before transport, bounded public results,
recommended experience review, local fork preservation, and detach without
corruption. The broker fixture additionally proves the secret never occurs in
capsule bytes, model-visible instructions, diagnostics, operation output, or
captured logs.

## Deterministic adoption UX

A production-build diagnostic route renders the three product cards using the
real SDK evaluator and protected Flect components. It shows connection,
authentication owner, inference choices, recommended version, and ordered
diagnostics without rendering private callback state.

Chromium exercises:

- smallest offline adoption;
- browser-direct ready and offline states;
- brokered authentication unavailable and ready states;
- product update while a personal fork remains;
- capability and extension changes requiring separate review;
- incompatible host and blocked migration;
- detach preserving fork/export references; and
- no credential in DOM, console, request capture, or screenshot.

This route is test-only behind the existing capability-diagnostic build flag.
The stock distribution does not register a product integration by default.

## Versioning and migration

Package version begins at `0.1.0`. Contract versions remain explicit integer
fields. During Effect 4 beta and Flect 0.x, the package uses exact peer versions.
A stable release may widen them only after compatibility proof.

Migrations are declarative edges between integration versions. They describe
whether the recommended experience can update automatically, requires review,
or is blocked. They never execute arbitrary code, mutate user workspaces, or
change grants. Missing or ambiguous migration paths fail closed with one public
diagnostic.

## Proof strategy

Contract proof:

- strict schema rejection, cross-reference validation, digest verification;
- inference invariance and product-denial precedence;
- deterministic adoption diagnostics and detach preservation;
- bounded adapter failures with no private text;
- all three public-only reference imports.

Adoption/release proof:

- package build and `npm pack`;
- install into a clean temporary consumer;
- compile and run the smallest offline product using only package docs;
- inspect tarball contents and dependency graph;
- exact package artifact digest and size.

Browser/security proof:

- production Chromium UX for every required adoption state;
- secret absence from DOM, console, network bodies, capsule, instructions,
  diagnostic JSON, and logs;
- offline accepted interface remains available;
- incompatible or unsupported host state fails closed.

Native proof:

- the same packed SDK artifact is consumed by the app build;
- packaged macOS shows the adoption diagnostic through AX or, if the stock
  route remains test-only, native contract tests prove the shared schema and
  the report states the UI boundary exactly.

## Non-goals

- Publishing to npm from this PR worktree.
- Replacing a product backend, database, authorization, or business logic.
- An unrestricted proxy or arbitrary URL adapter.
- Giving product code control of Flect grants, safe mode, acceptance, user Git,
  or recovery.
- Database adapters, remote runtime pairing, native keychain implementation, or
  collaboration workflows.
- Freezing a 1.0 API before the three adopters and clean consumer pass.
