# Flect capsule format implementation plan

**Goal:** Ship the deterministic, bounded `.flect` artifact contract required by issue #2, without rendering, executing, granting, or building capsule contents.

## Contract

- Define strict Effect Schemas for format version 1, entrypoints, assets,
  capabilities, compatibility, provenance, and reserved signatures.
- Treat every archive payload as immutable and SHA-256 addressed.
- Reject unknown fields, unsafe paths, duplicates, unsupported versions,
  credentials/grants/mutable host-state fields, excess files, and excess bytes.
- Reserve migrations as explicit version-to-version decoders; version 1 is the
  only accepted version in this slice.

## Codec

- Encode deterministic uncompressed POSIX tar with `flect.json` first and all
  remaining paths in bytewise lexical order.
- Normalize archive metadata and JSON serialization so identical inputs are
  byte-identical.
- Decode through one bounded parser shared by browser and desktop contracts.
- Verify every payload hash before returning a decoded capsule.

## Proof

- Contract tests for strictness, hostile paths, duplicate entries, invalid
  hashes, unsupported versions, sensitive fields, file and byte bounds.
- Golden determinism, encode/decode, and malformed archive tests.
- Browser and desktop loading adapters consume the same fixture and return the
  same manifest identity.
- Update the public format specification, verification evidence, and issue #2.
