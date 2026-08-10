# Observable control verification

Date: 2026-07-31

## Verdict

Verified locally. Flect now has one schema-defined Effect workspace
controller for visible UI actions and explicitly authorized outside-agent
actions. Edit/Shaper proposals, Run/App Agent turns, tool activity,
diagnostics, revision decisions, safe mode, model and rail changes, and local
control all update the same reactive snapshot and bounded operation journal.

The browser, Tauri app, bundled CLI, authenticated JSON/SSE API, and bundled
MCP adapter use the same command authority. Local control remains off by
default, can only be enabled in Flect's protected UI, and was left revoked
after verification.

## Implementation evidence

- `shared/control.ts` owns the closed, versioned command, snapshot, event,
  receipt, error, operation, activity, and client schemas.
- `src/lib/workspace-controller.ts` is the sole semantic command authority.
- `src/lib/agent-workspace.ts` owns independent App Agent and Shaper
  lifecycles; Guardian remains separately protected in the Pi runtime.
- `server/pi-proposal-tool.ts` defines the exact proposal tool and validation
  diagnostics. Invalid proposals receive one bounded corrective retry without
  discarding the Shaper session.
- `src/lib/operation-journal.ts` retains at most 500 records and 2 MiB,
  correlates commands, operations, sessions, tools, revisions, and outside
  client identifiers, and redacts credential-shaped text at ingestion.
- `server/control-broker.ts` binds an ephemeral server only to `127.0.0.1`,
  rotates a 256-bit bearer grant, uses a bounded pending-command limit,
  serializes its short state-mutation critical sections, and ends revoked
  command polls through an explicit revocation sentinel.
- `src/lib/workspace-control-bridge.ts` serializes broker reconciliation,
  makes revocation an acknowledgement barrier, and prevents event or long-poll
  races during shutdown.
- `cli/flectctl.ts`, `cli/flect-client.ts`, and `cli/flect-mcp.ts` expose the
  same closed command union and live event stream without exposing the bearer.
- `src/hooks/use-sticky-follow.ts` preserves the reader's position outside the
  48 px follow zone and exposes an accessible jump-to-latest action.

The detailed contracts and security model are documented in
`docs/local-control.md`, `ARCHITECTURE.md`, and `docs/trust-model.md`.

## Fresh automated gate

`bun run check:all` completed with exit status 0 after the final code changes:

- Effect checkout:
  `cccd029ae0124a33254b4094f1bc9c06cd43324e`
- Rifty dependency and license verification: passed
- Biome: 188 files checked, no findings
- TypeScript project build: passed
- Vitest: 68 files passed, 1 intentionally skipped; 378 tests passed, 1
  intentionally skipped
- Playwright: 13 production-Chromium scenarios passed
- Rust: 8 tests passed
- browser production build: passed
- three arm64 sidecars compiled: `flect-runtime`, `flectctl`, and `flect-mcp`
- Tauri release build and `Flect.app` bundling: passed

The Chromium scenarios cover the pinned browser execution substrate, Bun
command emulation, Shaper proposal and preview, Run/Edit history separation,
visible Bash and proposal activity, full sanitized Markdown, sticky follow,
revision rejection and rollback, model and rail interactions, responsive
geometry, safe mode, reduced motion, and a complete `flectctl`-to-live-UI
workflow with a clean console and network log.

`bun run test:pi-smoke` also completed with exit status 0 using a private
Guardian/Shaper pair and the exact proposal tool.

`bun run release:verify` passed all three packaging tests. The built
application then passed:

```text
codesign --verify --deep --strict
```

All four installed executables were arm64 Mach-O files, and SHA-256 hashes for
the installed copies exactly matched the verified bundle copies.

## Installed macOS smoke

The verified bundle was installed at `/Applications/Flect.app`. The original
installed copy and the superseded pre-concurrency smoke build were moved
recoverably to:

- `~/.Trash/Flect.app.pre-observable-control-2026-07-31`
- `~/.Trash/Flect.app.before-broker-serialization-2026-07-31`

Native smoke evidence:

- the Flect window opened and reported `Pi ready`;
- both `/Applications/Flect.app/Contents/MacOS/flect` and its private
  `flect-runtime` child remained running;
- local control was enabled through the visible **Diagnostics** panel, not by
  an outside client;
- `~/Library/Application Support/Flect` was mode `0700` and `control.json`
  was mode `0600`;
- the bundled `flectctl` inspected workspace `workspace-local-default`;
- 32 bundled CLI processes submitted commands concurrently, all 32 exited
  successfully, and the live journal recorded all 32 completed operations;
- bundled CLI commands collapsed and expanded the agent rail, entered and
  restored safe mode, and changed Edit/Run mode;
- macOS accessibility state observed **Open Flect agent** after collapse and
  **Custom interface state is bypassed.** after entering safe mode;
- the bundled MCP executable negotiated successfully, exposed exactly
  `flect_inspect`, `flect_command`, `flect_wait`, and `flect_logs`, and
  returned the live workspace without an error;
- `flect_wait` subscribed over SSE at sequence 131, a separate bundled CLI
  process entered safe mode, and the wait returned `advanced: true` in
  `safe-mode` at sequence 136;
- the operation journal contained correlated accepted/succeeded records with
  outside `clientId`, `commandId`, and `operationId` values; and
- bundled `flectctl disable` removed the descriptor, subsequent inspection
  exited with the documented unavailable status `3`, and the native UI
  returned to **Enable local control**.

Flect was left open with local control disabled.

## Delivery boundary

Verification was performed on branch `codex/flect-self-contained-shaper` at
base commit `32d20f5dcb82af6cd53db9188bb029dd0d4012e4` with the implementation
changes intentionally uncommitted. No commit, push, merge, publication, or
release occurred.

The local app is ad-hoc signed. Notarization was intentionally skipped because
Apple release credentials were not present; that is a distribution step, not
a local correctness failure.
