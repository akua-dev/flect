# Flect in-product Pi authentication implementation plan

> **Execution:** Follow the repository Effect, TDD, security, accessibility,
> browser, native, and verification guidance. Preserve unrelated work. Do not
> commit, push, publish, or release without current explicit authority.

**Goal:** Let browser and packaged-macOS users authenticate Pi providers and
reach a model turn entirely inside Flect while credentials remain owned by the
private runtime.

**Design:**
`docs/superpowers/specs/2026-08-01-flect-pi-authentication-design.md`

**Quality criteria:** `FQ-01.3`–`FQ-01.5`, `FQ-12.1`–`FQ-12.6`.

### Task 1: Public non-secret authentication contracts

**Files:** `shared/contracts.ts`, `shared/contracts.test.ts`, `shared/rpc.ts`

- [x] Write strict schema tests for provider summaries, auth methods, reasoning
      levels, login events, safe selection replies, and closed errors.
- [x] Reject unknown fields, oversized copy/options/URLs, non-HTTPS external
      links, identifiers outside the closed syntax, and secret-shaped fields.
- [x] Extend model/session summaries with only supported reasoning metadata.
- [x] Add private-runtime RPCs for status, login stream, safe reply, cancel,
      refresh, and logout; keep auth mutations out of workspace commands.

### Task 2: Effect authentication coordinator over Pi

**Files:** `server/pi-runtime.ts`, new focused server service/tests,
`server/runtime.ts`

- [x] Introduce a testable Pi auth adapter around the one shared
      `ModelRuntime`.
- [ ] Write failing Effect tests for projection, existing-auth discovery,
      start, duplicate, select, per-prompt abort, whole-login cancel, timeout,
      completion, denied/malformed failure, refresh, and logout.
- [x] Implement scoped login fibers, bounded queues, deferred prompts,
      `AbortController` integration, and Flect-authored errors.
- [x] Prove model/role session invalidation is minimal and visible history is
      preserved when model or reasoning selection changes.

### Task 3: One-use protected credential host

**Files:** new `server/credential-prompt-host.ts` and tests

- [x] Write adversarial tests for loopback-only binding, unguessable one-use
      path, expiry, replay, method/type/length/origin validation, cancellation,
      and fixed non-reflective responses.
- [x] Prove CSP, cache, referrer, content-type, and permissions headers.
- [x] Keep secret/manual/text values in Effect `Redacted`, pass them only to
      the correlated waiter, and wipe them after use.
- [ ] Scan every public encoding, log capture, browser artifact, persistence
      surface, and error path using unique secret canaries.

### Task 4: Browser and private-RPC transports

**Files:** `server/app.ts`, `server/app.test.ts`, `server/rpc-handlers.ts`,
`server/rpc-handlers.test.ts`, `src/lib/api.ts`, `src/lib/tauri-transport.ts`,
focused tests

- [x] Add same-origin JSON/SSE browser routes and private Effect RPC handlers
      for the same client capability.
- [x] Decode every request and response with Effect Schema and normalize all
      runtime failures.
- [ ] Prove disconnect/interruption cancels no unrelated login and leaves
      explicit reconnect/cancel behavior.
- [x] Ensure auth events never enter control broker state or operation records.

### Task 5: Provider-aware model and reasoning UI

**Files:** new auth hook/components, `src/components/model-menu.tsx`,
`src/components/composer.tsx`, `src/components/agent-rail.tsx`, `src/app.tsx`,
`src/styles.css`, focused component tests

- [x] Add Choose provider, connected/needs-attention status, method selection,
      progress, open/copy link, safe select prompt, cancel, refresh, and sign
      out through the protected shell.
- [x] Open sensitive entry only in the separate one-use runtime page; ordinary
      React must never render an input for credentials or callback codes.
- [x] Add model-supported reasoning controls to the existing concise composer
      menu and preserve favorites/search/keyboard/focus behavior.
- [ ] Cover setup-required, expired, cancelled, denied, unsupported, compact,
      keyboard, screen-reader, contrast, and reduced-motion states.

### Task 6: Browser, native, and security proof

**Files:** production E2E fixtures/tests, packaged-host harness, README and
owning architecture/trust docs, dated verification report

- [ ] Add a deterministic provider fixture whose returned credential canary is
      observable only inside the fake Pi adapter and never public state.
- [ ] Run the first-run Chromium path through successful turn plus cancel,
      malformed, unavailable, logout, and no-provider recovery.
- [ ] Repeat the success path in the packaged macOS app through public UI and
      verify the one-use credential host directly.
- [x] Run `bun run check:all`, live private Pi smoke, credential scans, native
      build/open, verification-before-completion, and no-mistakes.
- [ ] Write a new immutable verification report and keep issue `#19` open for
      any missing required proof.
