# Flect Portable Extension Lifecycle Design

**Status:** Approved by the existing Flect product-quality contract, trust
model, and Robin's explicit direction to build portable role extensions and
continue without routine approval pauses.

## Outcome

A `.flect` capsule can carry inspectable, offline App Agent and Shaper
extension packages. A user can review, test, enable, disable, pin, fork,
update, resolve, and remove them without granting ambient authority or mixing
the App Agent, Preview App Agent, Shaper, or Guardian trust domains.

This design implements GitHub issue #26 and owns the focused design details for
`FQ-03.8`, `FQ-04.5`, `FQ-10.1` through `FQ-10.8`, `FQ-11.5` through
`FQ-11.8`, `FQ-17.4`, and extension provenance under `FQ-23.*`. The stable
outcomes remain canonical in `docs/product-quality.md`.

## Selected architecture

Portable packages do not load as ordinary same-process Pi extensions.
Ordinary external Pi extensions remain an explicitly trusted host-code path.
Portable packages run in Flect's bounded QuickJS worker realm and can return
only schema-validated inert intents. Each invocation gets a fresh worker and a
role-specific public input projection.

Pi retains separate `SessionManager`, `SettingsManager`, and `ResourceLoader`
instances for accepted App Agent, candidate Preview App Agent, and Shaper.
Guardian loads no community package. An approved role discovers portable
operations lazily through its reserved, role-bound browser command:

```text
flect extensions list
flect extensions describe <extension-id>
flect extensions call <extension-id> --input <json>
```

This gives agents useful Bash-driven discovery without adding a catalog of
model-visible tools to every turn. The command source identifies the calling
role and candidate/accepted binding, so the controller can select only the
matching package view. A package cannot choose or spoof its role.

## Capsule contract

`flect.json` gains an optional bounded `extensions` array. Every declaration
contains:

- a stable identifier, display name, semantic version, description, and bundle
  path;
- one or both target roles (`app`, `shaper`), never Guardian;
- compatible Flect, portable Extension API, and host platforms;
- requested Flect capabilities, each marked required or optional;
- bounded public instructions, command metadata, and operation metadata;
- resource ceilings no larger than the host maxima;
- publisher, source, revision, bundle hash, and optional source-map hash.

The bundle and source-map paths must name verified capsule files and their
declared hashes must match. Grants, decisions, credentials, conversations,
local paths, and mutable lifecycle state are unrepresentable. Capsule decoding
is inert and strict; it does not run extension code.

The existing version-1 capsule contract remains source compatible because the
new field is optional. Export writes the canonical declaration and exact
verified bytes. A future incompatible shape requires an explicit capsule
migration rather than permissive decoding.

## Lifecycle state

Flect owns one schema-validated workspace extension record per capsule,
package, role, and accepted/candidate binding. It records:

- exact capsule digest, package version, bundle digest, provenance revision,
  and compatibility result;
- lifecycle state: `available`, `enabled`, `disabled`, `failed`, `conflict`, or
  `incompatible`;
- an explicit requested/granted capability intersection;
- pin and local-fork metadata;
- bounded failure reason and counters, never raw exceptions or source paths.

The record is protected host state, separate from capsule bytes and Git source.
Candidate state cannot alter accepted state. Keeping a candidate promotes its
tested compatible records; rejecting it discards candidate records. Removing a
package revokes its role activation before deleting its local catalog entry.

Updates compare stable IDs. Pins block replacement. Local forks are never
overwritten; a divergent upstream version becomes `conflict` until the user
chooses the fork or upstream package. An update cannot preserve an old grant if
the package digest, role set, or requested capability set widens. Compatible
reductions may retain the exact intersection. Signatures and publisher labels
never grant authority.

## Review and activation

Capsule review lists each package's provenance, version, target roles, public
contributions, compatibility, resource ceilings, and requested capabilities.
No package executes before the user enables a target role. Required extension
capabilities block that role's activation, not inspection of the capsule.

Candidate packages can be invoked only by Preview App Agent for the App role
or by Shaper for the Shaper role. A successful bounded test marks that exact
candidate package digest tested. Keep is blocked for an enabled required
package that has not passed its candidate test. Declined or disabled packages
leave the protected base role usable.

The protected shell exposes enable, disable, pin, fork, update resolution,
remove, test, and failure-recovery actions. Shaped capsule UI cannot make those
decisions.

## Runtime isolation and capability flow

The controller resolves an extension call in this order:

1. authenticate the controller/agent command source;
2. select accepted or candidate binding from protected workbench state;
3. require the caller's role in the package declaration and lifecycle record;
4. require the package to be enabled, compatible, and not failed;
5. intersect declared requests with current role-specific grants;
6. project bounded public input for that role and binding;
7. execute the verified bundle in a fresh QuickJS worker with the declared
   ceilings capped by host maxima;
8. decode inert intents strictly and apply them through the capability broker;
9. record bounded correlated success or failure evidence.

The realm has no DOM, network, storage, OPFS handle, shell, host process, Bun,
Pi object, provider credential, product credential, module loader, dynamic
evaluation, or arbitrary host function. Cross-role conversation events, tool
calls, prompts, product results, and workspace files are absent from its input.

Flood, deadline, stack, memory, input, output, and intent limits fail closed.
Cancellation terminates and releases the worker. Repeated failures disable only
the offending package role and restart that role on its protected baseline.
Accepted interface, capsule, Git, conversation continuity, and last-known-good
state remain intact.

## Error and recovery model

Expected failures are typed Effect errors with stable public reason codes.
Public UI, CLI, events, and operation evidence identify the package, role,
binding, stage, and recovery action, but never include raw thrown values,
source text, stack traces, credentials, or local paths.

Startup failure means the optional package set is omitted and the affected Pi
role starts from its built-in baseline. Runtime failure terminates the package
worker, records the exact bounded failure, and offers **Disable extension** and
**Fix in Shape**. Guardian is not required for deterministic fallback and never
loads the package; its advisory repair path may receive only the bounded public
failure projection.

## Components

- `shared/extensions.ts` owns package, lifecycle, command, review, and failure
  schemas plus pure compatibility/update/grant rules.
- `shared/capsule.ts` embeds declarations and verifies referenced payloads.
- `src/extensions/extension-catalog.ts` owns persisted accepted/candidate
  lifecycle state behind an Effect service and Layer.
- `src/extensions/portable-extension-host.ts` resolves role calls and supervises
  the existing worker sandbox and capability broker.
- `shared/control.ts` and `FlectWorkspaceController` own semantic extension
  commands and reactive public projections.
- the embedded AXI surface exposes lazy `extensions` list/describe/call
  operations through the same controller.
- protected React review and management UI renders controller state only.

## Proof strategy

Contract tests cover strict manifests, missing or mismatched bundles, role
isolation, grant non-expansion, pins, forks, update conflicts, removal,
migration failure, resource ceilings, and bounded public errors. Effect service
tests use test Layers and verify acquisition/release and candidate/accepted
separation.

Real browser tests install App, Shaper, and dual-role packages, inspect and
enable them, invoke them through visible UI and role Bash, test the candidate
before Keep, update/pin/fork/disable/remove them, and prove reactive state.
Adversarial fixtures attempt cross-role reads, prompt/tool injection, grant
expansion, browser storage, network, credentials, startup failure, floods,
loops, memory exhaustion, and oversized output. Packaged macOS repeats the
essential Shape–Use and broken-package recovery flow against the exact release
bundle.

Evidence belongs in a dated `docs/verification/` report and issue #26. The
issue stays open until the implementation is delivered in Git; a dirty local
worktree is proof of behavior, not proof of delivery.

## Non-goals

- Community packages in Guardian.
- Treating publisher identity or a signature as permission.
- Same-process loading of portable package code.
- Ambient network, filesystem, shell, credential, or native authority.
- A complete model-visible tool catalog on every turn.
- Claiming worker isolation is an operating-system sandbox.
