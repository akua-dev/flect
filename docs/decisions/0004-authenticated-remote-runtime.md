# ADR 0004: Authenticated remote runtime contract

- Status: proposed for independent security review
- Date: 2026-08-10
- Decision owners: Flect maintainers and security reviewers

## Context

A normal browser or future mobile host cannot safely inherit the packaged
desktop application's Pi process, native capabilities, or credentials. The
existing loopback development runtime is explicitly local, origin-bound, and
not suitable for network exposure. TLS alone would authenticate a server name,
not the exact Flect runtime, browser device, user, grant, session, or message.

Remote execution therefore needs a new trust boundary. This ADR defines that
boundary before any non-loopback listener or remote capability adapter exists.

## Decision

The first implementation will be **user-hosted**: a runtime owned by the same
person and installed on a device they control. The protocol remains
provider-neutral so a later audited peer-hosted or product-hosted transport can
implement the same contract, but those deployment models are not implicitly
trusted and require separate policy and review.

The browser/mobile client renders cached accepted interfaces without a remote
connection. Agent turns and privileged operations are unavailable until a
specific device is explicitly paired and an authenticated session is active.
Pi and product credentials remain on the runtime. Pairing and transport never
copy them to browser storage.

## Authorities and assets

Authorities:

- the protected local user surface approves pairing, capability decisions,
  revocation, and lost-device recovery;
- the client device owns a non-exportable device signing key;
- the runtime owns a non-exportable runtime signing key and credential store;
- the Flect capability broker authorizes every projected operation independently
  of transport authentication; and
- products retain their own authorization and may still deny an approved user
  operation.

Protected assets include Pi/provider credentials, product credentials, private
conversation content, source workspaces, capsule bytes, capability decisions,
operation input/output, audit metadata, device/runtime keys, pairing codes,
resumption tickets, and revocation state.

## Adversaries

The design assumes hostile networks, malicious sites, stolen bearer material,
replayed/reordered frames, compromised or lost client devices, a compromised
runtime, malicious capsules, confused-deputy requests between products/users,
and operators able to observe infrastructure metadata. It does not claim to
protect secrets already present on a fully compromised endpoint. Recovery must
nevertheless stop that endpoint from receiving new authority.

## Pairing and key lifecycle

1. The runtime displays a short-lived, single-use pairing invitation through a
   local protected surface. The invitation names the runtime, expiry, and an
   out-of-band comparison code; it contains no credential.
2. Client and runtime exchange ephemeral X25519 keys and prove their persistent
   Ed25519 device/runtime keys over a mutually authenticated transcript.
3. The user compares the code and confirms on the protected runtime surface.
   Neither a capsule nor a remote message can confirm itself.
4. Both sides store only the peer public key, a random pairing identifier,
   creation time, key epoch, and revocation state. Browser keys must be
   non-exportable WebCrypto keys where supported; weaker storage is an explicit
   unsupported-host result, not a silent downgrade.
5. Routine rotation advances the key epoch with a transcript signed by the old
   and new keys. Recovery rotation uses a locally protected recovery key and
   revokes every earlier device epoch.

Invitations expire after five minutes, are consumed once, and are rate limited.
Pairing endpoints expose no runtime discovery over the public internet;
discovery is an explicit user-entered address, reviewed deep link, or local
proximity mechanism.

## Session protocol

Transport uses TLS 1.3 plus mutual application authentication. After TLS, both
sides sign a channel-binding transcript containing protocol version, pairing
ID, device ID, runtime ID, key epoch, both fresh nonces, and the TLS exporter.
A successful transcript creates a random session ID and derives directional
AEAD keys.

Every encrypted frame contains the session ID, key epoch, strictly increasing
64-bit sequence, operation ID, message type, ciphertext length, and ciphertext.
The header is authenticated additional data. A receiver rejects an old epoch,
wrong session, duplicate or lower sequence, gap beyond the bounded reorder
window, oversized frame, unknown message, or expired session before decoding
product data. Accepted sequence state is persisted atomically with any durable
effect so reconnect cannot replay a completed operation.

Resumption uses a single-use, short-lived ticket bound to pairing ID, both key
epochs, last accepted client/server sequence, workspace digest, and capability
projection digest. The runtime rotates the ticket before accepting new work.
Failure falls back to a fresh mutually authenticated session, never to bearer
authentication.

Interruption is an idempotent typed message for one operation ID. Disconnect
triggers an interruption deadline; after it expires, the runtime cancels the
Effect scope and records only bounded redacted outcome metadata. Reconnect may
observe the outcome but cannot cause the operation to execute twice.

## Capability and user boundaries

Transport authentication grants no product or native capability. The runtime
reconstructs capsule/product identity, workspace, exact revision/digest, user,
and paired device from protected state and asks the normal broker for the
current projection. Requests carry named operation IDs and schema-validated
inputs, never URLs, shell commands, credentials, or arbitrary native calls.

Remote confirmation is a signed request/decision exchange displayed by a
protected Flect surface. The decision binds user, device, runtime, capsule,
workspace, request digest, operation/resource/data scope, expiry, and rate.
Sensitive policy may require confirmation on the credential-owning runtime
even when the browser user is authenticated. Multi-user runtimes isolate keys,
credentials, workspaces, decisions, logs, quotas, and process scopes by an
immutable server-derived user ID.

Revocation is checked at session admission and before every reserved operation.
It closes sessions, interrupts active scopes, invalidates tickets, advances the
revocation generation, and prevents reconnect. Lost-device recovery uses a
different trusted device or local runtime console, revokes the pairing, rotates
affected epochs, and shows which operations completed before revocation.

## Offline behavior

The client may retain only integrity-checked accepted capsule assets, a bounded
public history projection, unsent prompt drafts, and explicit offline status.
It does not cache credentials, grants as authority, remote operation outputs
marked sensitive, or model/provider session material. Cached UI is interactive
only for local behavior; remote actions fail closed with one actionable
reconnect surface and never queue silently. A draft may be sent exactly once
after an authenticated reconnect with current revision confirmation.

## Deployment and operations

The user-hosted runtime binds only the explicitly configured TLS endpoint,
runs without root, stores keys in the platform credential facility, separates
users/workspaces, caps sessions and bytes, and applies pairing/authentication
rate limits. Logs contain stable redacted event codes, durations, byte counts,
key epochs, and hashed correlation IDs—never prompts, source, credentials,
tokens, pairing secrets, signatures, or response bodies. Retention is bounded
and user-controlled. Abuse controls include connection quotas, exponential
backoff, frame/decompression limits, operation deadlines, and an emergency
local revoke-all action.

Backups exclude live session keys and credentials by default. Restoring a
runtime creates a new runtime identity unless an explicitly protected identity
backup is restored; all clients must then pair again. Compromise response
revokes all pairings, rotates runtime identity and credentials, terminates
sessions, preserves a redacted completion ledger, and warns affected users
through an independent channel.

## Protocol fixtures and review gate

`shared/remote-runtime-protocol-fixture.ts` is deliberately a pure state-machine
fixture, not production cryptography or transport. Its tests pin the required
ordering behavior for pairing, reconnect, replay rejection, interruption,
revocation, and lost-device recovery.

No non-loopback listener, discovery service, remote credential adapter, or
mobile capability projection may be merged until an independent security
review approves this ADR, cryptographic choices, concrete wire schema, key
storage on each supported platform, and an implementation-specific threat
model. Review findings update this ADR rather than being waived by the fixture.

## Consequences

The architecture preserves offline interface usefulness and keeps credentials
at the runtime, but remote agent readiness requires explicit pairing and may be
unavailable on hosts without protected key storage. User-hosting limits the
first deployment's operator trust and multi-tenant complexity. Provider-neutral
contracts leave room for later deployments without treating them as approved.
