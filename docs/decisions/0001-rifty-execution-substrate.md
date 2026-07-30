# Decision 0001: Adopt Rifty leaf packages for browser execution

- Status: Accepted
- Date: 2026-07-30
- Scope: internal execution-substrate adoption gate

## Decision

Flect adopts these exact published packages:

- `@riftydev/npm-client@0.2.0`
- `@riftydev/runtime-js@0.2.0`
- `@riftydev/runtime-wasi@0.2.0`
- `@riftydev/vfs@0.2.0`

They enter Flect only through Effect services, strict Schema contracts, named
Layers, scoped Worker acquisition, typed redacted failures, and outer
deadlines. React does not import a Rifty package.

The evaluated repository snapshot is Rifty commit
`207e0ee9f108d6457e2448c956b84c2758e62671`. The published package versions,
repository identity, and MIT license are verified from installed manifests;
their registry integrity hashes remain pinned in `bun.lock`.

Flect does not adopt `@riftydev/sdk`, `@riftydev/shell`, `@riftydev/git`, the
Rifty application UI, or its realm-global sandbox lifecycle.

## Verified slice

The build-gated internal diagnostic can:

- execute fixed JavaScript in a disposable Rifty Worker;
- execute a fixed WASI Preview 1 module in a disposable Worker;
- install one deterministic, integrity-checked package into a fresh
  `MemoryVfs`; and
- build and run these exact production artifacts in Chromium.

The ordinary product build excludes the diagnostic component and its Rifty
Workers. No current UI, Pi session, extension, capsule, model input, URL
parameter, canonical storage, credential, or network response can supply code,
Wasm bytes, package names, or registry URLs to this capability.

Rifty's evaluated REPL writes a non-undefined evaluation result to stdout and
returns `value: undefined` through its host protocol. Flect's diagnostic tests
the observable stdout behavior rather than claiming a return-value contract
Rifty does not provide.

## Trust boundary

Rifty provides cooperative browser-local execution, not hostile-code
containment. Workers, cross-origin isolation, and `SharedArrayBuffer` are
compatibility and lifecycle mechanisms.

This accepted slice does not establish the future untrusted-authoring boundary.
That boundary still requires a separate sandbox origin, restrictive CSP,
capability and package brokers, disposable proposal mirrors, canonical
workspace isolation, validated file deltas, acceptance builds, and Guardian
recovery.

## Deferred

The following remain separate implementation and review gates:

- separate-origin authoring and its package/network broker;
- canonical OPFS and embedded wasm-git/libgit2 worktrees;
- `just-bash` and the Bun-compatible reserved command;
- service-worker development preview;
- package acquisition from a live registry;
- portable Wasm command packages;
- user, model, capsule, or extension access to browser execution; and
- any public product UI.

## Evidence

The acceptance evidence is:

```text
bun run check:rifty
bunx vitest run scripts/verify-rifty-dependencies.test.ts
bunx vitest run shared/browser-execution.test.ts
bunx vitest run src/execution/rifty-js-runtime.test.ts
bunx vitest run src/execution/rifty-wasi-runtime.test.ts
bunx vitest run src/execution/rifty-package-mirror.test.ts
bunx playwright test tests/e2e/browser-execution.spec.ts
VITE_FLECT_EXECUTION_DIAGNOSTIC=0 bun run build
```

Observed on 2026-07-30:

- 14 focused Effect/Vitest tests passed;
- the production diagnostic emitted the Rifty JavaScript and WASI Workers;
- Chromium executed JavaScript, WASI, and the package fixture successfully;
- scoped release checks passed;
- the ordinary product build excluded execution-diagnostic artifacts; and
- Biome and TypeScript passed.

The complete research inventory, selected foundations, adjacent projects,
alternatives, standards, exact commits, and rejection rationale remain in the
[self-contained Shaper design](../superpowers/specs/2026-07-30-flect-self-contained-shaper-design.md#retained-research-references).

## Follow-up

[ADR 0002](0002-browser-bun-command.md) records the separately reviewed
product integration that later added Shaper access through the typed
browser-shell transport, live package acquisition, and isolated previews. The
diagnostic-only constraints above describe this adoption gate, not the current
product boundary.
