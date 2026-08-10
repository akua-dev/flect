# Flect Native Update and Uninstall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected, signed native update workflow and an ownership-safe
uninstall preparation workflow while preserving browser independence and user
data.

**Architecture:** Closed Effect schemas and a `NativeUpdate` service define the
portable contract. The installed Tauri main window supplies the only live
adapter through narrow Rust commands backed by Tauri's official updater; the
browser supplies an explicit unavailable layer. Diagnostics renders protected
review/install/pre-uninstall controls, while the release pipeline produces and
verifies the signed updater archive and static GitHub Release manifest.

**Tech Stack:** Effect 4, TypeScript, React, Tauri 2.11.5,
`tauri-plugin-updater` 2.10.1, Rust, Bun, Vitest, Playwright.

## Global constraints

- Only the compiled main Flect window receives native update authority.
- App Agent, Preview App Agent, Shaper, embedded Bash, capsules, extensions,
  product adapters, and imported source receive no update command.
- Production update transport is HTTPS-only and targets Apple Silicon macOS
  12 or newer.
- `FLECT_UPDATE_PUBLIC_KEY` supplies public verification material at release
  build time; `TAURI_SIGNING_PRIVATE_KEY` remains outside Git and logs.
- Public packaging fails closed when Apple trust evidence, updater trust
  evidence, or exact artifact evidence is absent.
- Update installation is always user-confirmed; browser Flect remains fully
  usable and reports native update as unavailable.
- Uninstall preparation removes only content still classified as Flect-owned;
  user data and foreign links/configuration remain untouched by default.
- Use Effect `Schema.TaggedErrorClass`, `Context.Service`, `Layer`, and
  structural `_tag` matching. Do not use error `instanceof`, `any`, or unsafe
  casts.
- Keep release automation in Bun/TypeScript. Add no repository shell scripts,
  updater daemon, controller, or shadow state.
- Do not commit, push, publish, or create credentials while executing this plan
  unless the current task explicitly authorizes that external mutation.

---

## File map

- `shared/native-update.ts`: versioned schemas for update snapshots, candidates,
  progress, commands, and tagged failures.
- `src/lib/native-update.ts`: `NativeUpdate` service, deterministic operation
  guard, and browser-unavailable layer.
- `src/lib/tauri-transport.ts`: narrow main-window host adapter that decodes
  every native response.
- `src/hooks/use-native-update.ts`: React projection of the Effect service.
- `src/components/diagnostics-panel.tsx`: protected update review and uninstall
  preparation UI.
- `src-tauri/src/native_update.rs`: Tauri updater adapter, fixed endpoint,
  main-window guard, bounded response projection, and install/relaunch flow.
- `src-tauri/src/lib.rs`: plugin/state/command registration only.
- `src-tauri/tauri.release.conf.json`: public-only updater artifact setting.
- `scripts/release-update.ts`: static manifest generation and exact updater
  artifact validation.
- `scripts/native-update-fixture-dogfood.ts`: task-scoped signed update,
  relaunch, durable-state preservation, and corrupt-signature proof.
- `scripts/package-release.ts`: compose updater evidence into the release gate.
- `tests/e2e/native-update.spec.ts`: production-browser protected-shell behavior
  with a typed fake native adapter.
- `docs/updates-and-uninstall.md`: current user workflow and ownership map.
- `docs/verification/2026-08-03-native-update-uninstall-verification.md`: dated
  evidence and honest credential-bound residuals.

### Task 1: Closed update contract and stale-operation guard

**Files:**

- Create: `shared/native-update.ts`
- Create: `src/lib/native-update.ts`
- Create: `src/lib/native-update.test.ts`
- Modify: `tsconfig.app.json`

**Interfaces:**

- Produces `NativeUpdateSnapshot`, `NativeUpdateCandidate`,
  `NativeUpdateProgress`, `NativeUpdateError`, `NativeUpdate`,
  `NativeUpdateShape`, `NativeUpdateUnavailableLive`, and
  `makeGuardedNativeUpdateLayer`.
- `NativeUpdateShape` exposes `status`, `check`, `install`, and `relaunch` as
  Effect values/functions. `install` consumes the exact opaque candidate token
  returned by `check`.

- [x] **Step 1: Write schema and state-machine RED tests**

  Add tests that decode only these states and reject excess properties:

  ```ts
  export const NativeUpdateSnapshot = Schema.Union(
    Schema.Struct({
      version: Schema.Literal(1),
      state: Schema.Literal("unavailable"),
      installedVersion: Schema.String,
      reason: Schema.Literal("browser", "development", "misconfigured"),
    }),
    Schema.Struct({
      version: Schema.Literal(1),
      state: Schema.Literal("current"),
      installedVersion: Schema.String,
      checkedAtMillis: Schema.Number,
    }),
    Schema.Struct({
      version: Schema.Literal(1),
      state: Schema.Literal("available"),
      installedVersion: Schema.String,
      candidate: NativeUpdateCandidate,
    }),
    Schema.Struct({
      version: Schema.Literal(1),
      state: Schema.Literal("downloading", "installing", "ready-to-relaunch"),
      installedVersion: Schema.String,
      candidate: NativeUpdateCandidate,
      progress: NativeUpdateProgress,
    }),
  );
  ```

  Prove the guarded layer rejects an install token after a newer check and that
  the browser layer returns `unavailable/browser` without a network request.

- [x] **Step 2: Run RED**

  Run:

  ```text
  bunx vitest run src/lib/native-update.test.ts
  ```

  Expected: failure because `shared/native-update.ts` and
  `src/lib/native-update.ts` do not exist.

- [x] **Step 3: Implement the exact Effect contract**

  Define:

  ```ts
  export class NativeUpdateError extends Schema.TaggedErrorClass<NativeUpdateError>()(
    "NativeUpdateError",
    {
      reason: Schema.Literals(
        "unavailable",
        "offline",
        "invalid-manifest",
        "incompatible",
        "invalid-signature",
        "stale",
        "install-failed",
      ),
      message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)),
    },
  ) {}

  export interface NativeUpdateShape {
    readonly status: Effect.Effect<NativeUpdateSnapshot, NativeUpdateError>;
    readonly check: Effect.Effect<NativeUpdateSnapshot, NativeUpdateError>;
    readonly install: (
      token: string,
    ) => Effect.Effect<NativeUpdateSnapshot, NativeUpdateError>;
    readonly relaunch: Effect.Effect<void, NativeUpdateError>;
  }

  export class NativeUpdate extends Context.Service<
    NativeUpdate,
    NativeUpdateShape
  >()("flect/NativeUpdate") {}
  ```

  Keep the last accepted token in an Effect `Ref`; `check` replaces it and
  `install` compares structurally before calling the adapter. Map all defects to
  the fixed `install-failed` public message.

- [x] **Step 4: Run GREEN and static checks**

  Run:

  ```text
  bunx vitest run src/lib/native-update.test.ts
  bun run typecheck
  bunx biome check shared/native-update.ts src/lib/native-update.ts src/lib/native-update.test.ts
  ```

  Expected: all pass with no fixes.

- [x] **Step 5: Review checkpoint**

  Inspect `git diff --check` and confirm this task exposes no endpoint, private
  key, updater plugin API, React state, or filesystem mutation.

### Task 2: Native updater host adapter and explicit browser fallback

**Files:**

- Create: `src-tauri/src/native_update.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/main.json`
- Modify: `src/lib/tauri-transport.ts`
- Modify: `src/lib/tauri-transport.test.ts`
- Modify: `src/lib/runtime.ts`

**Interfaces:**

- Consumes the Task 1 schemas and `TauriNativeHost`.
- Produces host commands `native_update_status`, `native_update_check`,
  `native_update_install`, and `native_update_relaunch` plus
  `makeTauriNativeUpdateLayer()`.

- [x] **Step 1: Add RED transport and Rust boundary tests**

  TypeScript tests must prove only the four fixed command names are accepted,
  every response is decoded with `NativeUpdateSnapshot`, and malformed output
  becomes `NativeUpdateError { reason: "unavailable" }`.

  Rust tests must prove:

  ```rust
  assert!(update_request_allowed("main", "https://github.com/akua-dev/flect/releases/latest/download/latest.json"));
  assert!(!update_request_allowed("capsule", "https://github.com/akua-dev/flect/releases/latest/download/latest.json"));
  assert!(!update_request_allowed("main", "http://127.0.0.1:3000/latest.json"));
  assert!(!update_request_allowed("main", "https://example.com/latest.json"));
  ```

  Also prove `public_update_key(None)` yields the typed development-unavailable
  snapshot without logging or echoing environment content.

- [x] **Step 2: Run RED**

  Run:

  ```text
  bunx vitest run src/lib/tauri-transport.test.ts
  cargo test --manifest-path src-tauri/Cargo.toml native_update
  ```

  Expected: failures for missing adapter, commands, and module.

- [x] **Step 3: Add current pinned dependencies**

  Add exact desktop dependency:

  ```toml
  [target."cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))".dependencies]
  tauri-plugin-updater = "=2.10.1"
  ```

  Register the plugin only when `option_env!("FLECT_UPDATE_PUBLIC_KEY")`
  contains a non-empty public key. Configure the fixed HTTPS GitHub Release
  endpoint in Rust; do not read an endpoint from shaped UI or persisted state.

- [x] **Step 4: Implement bounded commands**

  Keep updater candidate handles in managed Rust state keyed by an opaque
  random token. Serialize only version, notes capped at 4 KiB, optional content
  length, target, and token. `native_update_install` consumes the token exactly
  once. The command verifies `webview_window.label() == "main"`; invalid labels,
  missing keys, bad signatures, and plugin errors return fixed public strings.

  Add only these updater permissions to the `main` capability:

  ```json
  "permissions": [
    "core:default",
    "updater:allow-check",
    "updater:allow-download-and-install"
  ]
  ```

  If programmatic Rust use does not require guest permissions, leave the
  capability at `core:default` and assert that fact in the Rust test; never add
  a wildcard updater permission.

- [x] **Step 5: Implement and wire the Effect adapter**

  Extend `TauriNativeHostShape["invoke"]` with the four literal command names.
  `makeTauriNativeUpdateLayer()` must decode every result and map only by `_tag`:

  ```ts
  const call = (command: NativeUpdateHostCommand, args?: object) =>
    host.invoke(command, args).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(NativeUpdateSnapshot)),
      Effect.mapError(() =>
        NativeUpdateError.make({
          reason: "unavailable",
          message: "Native update state is unavailable.",
        }),
      ),
    );
  ```

  Desktop runtime provides this layer; browser runtime provides
  `NativeUpdateUnavailableLive`.

- [x] **Step 6: Run GREEN**

  Run:

  ```text
  bunx vitest run src/lib/native-update.test.ts src/lib/tauri-transport.test.ts
  cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
  cargo test --manifest-path src-tauri/Cargo.toml native_update
  bun run typecheck
  ```

  Expected: all pass and the development bundle still builds with no update key.

### Task 3: Protected Diagnostics update experience

**Files:**

- Create: `src/hooks/use-native-update.ts`
- Create: `src/hooks/use-native-update.test.tsx`
- Modify: `src/components/diagnostics-panel.tsx`
- Modify: `src/components/diagnostics-panel.test.tsx`
- Modify: `src/components/agent-rail.tsx`
- Modify: `src/app.tsx`
- Modify: `src/styles.css`
- Create: `tests/e2e/native-update.spec.ts`

**Interfaces:**

- Consumes `NativeUpdate` and its closed snapshots.
- Produces `NativeUpdateView` with `refresh`, `check`, `install`, and `relaunch`
  actions for `DiagnosticsPanel`.

- [x] **Step 1: Write RED hook and component tests**

  Prove the UI states and exact actions:

  - browser/development: installed version plus “Updates are available in a
    signed desktop release”; no install button;
  - current: last checked state and **Check for updates**;
  - available: version, bounded notes, target, size, **Install update**;
  - downloading/installing: determinate progress where length exists and no
    duplicate action;
  - ready: **Restart Flect**;
  - failure: fixed alert and retry, with no raw URL, signature, or key content.

  Confirm installation through:

  ```ts
  expect(globalThis.confirm).toHaveBeenCalledWith(
    "Install Flect 0.2.1 and restart when it is ready? Your work and settings stay in place.",
  );
  ```

- [x] **Step 2: Run RED**

  Run:

  ```text
  bunx vitest run src/hooks/use-native-update.test.tsx src/components/diagnostics-panel.test.tsx
  ```

  Expected: missing hook/view props and update section.

- [x] **Step 3: Implement the hook and protected section**

  The hook runs effects through `nativeUpdateRuntime`, serializes mutations,
  refreshes after every transition, and projects only fixed user-safe error
  copy. Add the update section after Workspace storage and before Local agent
  control. Use a real `<progress>` element with an accessible label.

  Do not add an interface schema node, control command, AXI command, product
  operation, portable extension, or embedded Bash route for update authority.

- [x] **Step 4: Add browser E2E**

  Cover every typed update state in hook/component tests. In production
  Chromium, prove the browser-unavailable boundary, absence of update authority,
  axe, 320 px and 200% text reflow, forced colors, and reduced motion.

- [x] **Step 5: Run GREEN and responsive/accessibility checks**

  Run:

  ```text
  bunx vitest run src/hooks/use-native-update.test.tsx src/components/diagnostics-panel.test.tsx
  bunx playwright test tests/e2e/native-update.spec.ts --project=chromium
  bun run typecheck
  bunx biome check src/hooks/use-native-update.ts src/hooks/use-native-update.test.tsx src/components/diagnostics-panel.tsx src/components/diagnostics-panel.test.tsx src/components/agent-rail.tsx src/app.tsx src/styles.css tests/e2e/native-update.spec.ts
  ```

  Expected: all pass at default, 320 px, 200% text, reduced motion, and forced
  colors with zero console errors.

### Task 4: Ownership-safe uninstall preparation

**Files:**

- Create: `shared/uninstall.ts`
- Create: `src/lib/uninstall.ts`
- Create: `src/lib/uninstall.test.ts`
- Modify: `src/hooks/use-native-setup.ts`
- Modify: `src/hooks/use-native-setup.test.tsx`
- Modify: `src/components/diagnostics-panel.tsx`
- Modify: `src/components/diagnostics-panel.test.tsx`
- Modify: `src/lib/tauri-transport.ts`
- Modify: `src/lib/runtime.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/axi/command.ts`
- Modify: `src/axi/program.ts`
- Modify: `src/axi/program.test.ts`

**Interfaces:**

- Produces `UninstallPlan`, `UninstallOwnedItem`, `UninstallRetainedItem`, and
  `prepareOwnedIntegrations`.
- Adds read-only `flect setup uninstall inspect` and mutating
  `flect setup uninstall prepare`; neither removes the app or user data.

- [x] **Step 1: Write RED ownership tests**

  Prove the plan always contains:

  ```ts
  {
    version: 1,
    application: { path: "/Applications/Flect.app", action: "move-to-trash" },
    ownedIntegrations: [...],
    retained: [
      { kind: "workspace-data", reason: "User work is retained by default." },
      { kind: "provider-authentication", reason: "Authentication remains with its provider owner." },
      { kind: "exports", reason: "Files outside Flect are never removed." },
    ],
  }
  ```

  Fixture cases must cover installed, stale, absent, and conflict states for the
  shell link and every agent integration. Prepare removes installed/stale
  owned items, leaves absent items alone, preserves conflicts byte-for-byte,
  and returns a typed partial result if one owned removal fails.

- [x] **Step 2: Run RED**

  Run:

  ```text
  bunx vitest run src/lib/uninstall.test.ts src/hooks/use-native-setup.test.tsx src/axi/program.test.ts
  ```

  Expected: missing schemas, service, hook action, and AXI command.

- [x] **Step 3: Implement the Effect plan and mutation**

  Use existing `ShellLink` and `AgentIntegration` services. Never accept a path
  argument. Derive the fixed app path from `FLECT_PUBLIC_EXECUTABLE`, and reject
  any executable not ending in `/Flect.app/Contents/MacOS/flect`.

  `prepareOwnedIntegrations` removes only states `installed` and `stale` through
  their existing ownership-checked service methods. It returns conflict items
  unchanged and never invokes recursive filesystem removal.

- [x] **Step 4: Add protected UI and AXI projection**

  Diagnostics shows **Prepare to uninstall** only in the desktop app. The
  confirmation is exact:

  ```text
  Prepare Flect for removal? This disables Local control and removes only Flect-owned command and agent integrations. Your work and settings stay in place.
  ```

  After success, show the fixed instruction to move `/Applications/Flect.app`
  to Trash. AXI emits the same bounded plan in TOON/JSON and follows AXI
  metadata/help conventions.

- [x] **Step 5: Run GREEN and destructive-boundary scan**

  Run:

  ```text
  bunx vitest run src/lib/uninstall.test.ts src/hooks/use-native-setup.test.tsx src/components/diagnostics-panel.test.tsx src/axi/program.test.ts
  rg -n 'rm -rf|remove\(.*recursive|HOME|~/' shared/uninstall.ts src/lib/uninstall.ts
  bun run typecheck
  bunx biome check shared/uninstall.ts src/lib/uninstall.ts src/lib/uninstall.test.ts src/hooks/use-native-setup.ts src/hooks/use-native-setup.test.tsx src/components/diagnostics-panel.tsx src/components/diagnostics-panel.test.tsx src/axi/command.ts src/axi/program.ts src/axi/program.test.ts
  ```

  Expected: tests pass; the scan finds no recursive delete and only explanatory
  fixed-path copy where applicable.

### Task 5: Signed updater artifact and release evidence gate

**Files:**

- Create: `src-tauri/tauri.release.conf.json`
- Create: `scripts/release-update.ts`
- Create: `scripts/release-update.test.ts`
- Modify: `scripts/package-release.ts`
- Modify: `scripts/package-release.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**

- Produces `validateUpdaterEvidence`, `writeStaticUpdateManifest`, and the
  release outputs `Flect.app.tar.gz`, `Flect.app.tar.gz.sig`, and `latest.json`.
- Extends the schema-versioned release manifest with a public-key digest and
  updater artifact digests; never records key content.

- [x] **Step 1: Write RED release tests**

  Add fixture tests that reject public evidence for each independent absence:
  update public key, update private-key environment presence, updater archive,
  signature, fixed HTTPS artifact URL, static manifest target
  `darwin-aarch64`, or signature mismatch. Prove development mode remains
  buildable and explicitly records updater unavailable.

  Prove `latest.json` has only:

  ```ts
  {
    version: "0.2.0",
    notes: string,
    platforms: {
      "darwin-aarch64": { url: string, signature: string },
    },
  }
  ```

  and that neither private key content nor environment variable values appear
  in stdout, stderr, the checksum, or either evidence manifest.

- [x] **Step 2: Run RED**

  Run:

  ```text
  bunx vitest run scripts/release-update.test.ts scripts/package-release.test.ts
  ```

  Expected: missing module and updater evidence fields.

- [x] **Step 3: Implement public-only updater packaging**

  Add this release-only configuration:

  ```json
  {
    "bundle": {
      "createUpdaterArtifacts": true
    }
  }
  ```

  Public desktop build adds `--config src-tauri/tauri.release.conf.json` and
  fails before build if `FLECT_UPDATE_PUBLIC_KEY` or
  `TAURI_SIGNING_PRIVATE_KEY` is absent. Development build does not create or
  claim updater artifacts.

  Read `.sig` as bounded UTF-8, compute SHA-256 of the public key and updater
  archive, and write stable-key-order JSON with no timestamp. Validate the
  updater archive contains only one `Flect.app` with the exact public/private
  executable inventory.

- [x] **Step 4: Compose the release manifest and checks**

  Change `reproducibilityVerified` from a hard-coded boolean to verified
  independent-build input produced by Task 6. Public mode requires it; local
  development retains the explicit blocker. Add updater outputs to
  `validateReleaseLayout`, DMG mount verification, checksum verification, and
  artifact hashes.

- [x] **Step 5: Run GREEN**

  Run:

  ```text
  bunx vitest run scripts/release-update.test.ts scripts/package-release.test.ts
  bun run typecheck
  bunx biome check scripts/release-update.ts scripts/release-update.test.ts scripts/package-release.ts scripts/package-release.test.ts
  ```

  Expected: all tests pass; public fixture evidence is accepted only when every
  updater and Apple trust field passes.

### Task 6: Independent unsigned-content reproducibility decision

**Files:**

- Create: `scripts/compare-release-builds.ts`
- Create: `scripts/compare-release-builds.test.ts`
- Modify: `scripts/package-release.ts`
- Modify: `docs/superpowers/specs/2026-08-01-flect-distribution-design.md`
- Modify: `docs/verification/2026-08-01-distribution-verification.md`

**Interfaces:**

- Produces `ReleaseBuildComparison` with exact tree digests, changed paths,
  bounded binary offsets, and a structural `verified` result.

- [x] **Step 1: Write RED comparison tests**

  Fixtures prove identical unsigned trees pass, signature-envelope-only changes
  normalize away, and any executable byte change fails with the exact changed
  file and no masked offsets. A known Tauri Isolation UUID variance fixture must
  fail rather than be normalized.

- [x] **Step 2: Run RED**

  Run:

  ```text
  bunx vitest run scripts/compare-release-builds.test.ts
  ```

  Expected: missing comparison module.

- [x] **Step 3: Implement exact comparison**

  Reuse the sorted entry-kind/mode/symlink/file-digest algorithm from
  `package-release.ts`, move it into the focused module, and compare two copied
  apps after removing only actual code signatures and `_CodeSignature`.

  Do not patch, zero, hash-ignore, or replace Tauri's generated Isolation UUID.
  Current upstream uses UUIDv4 at codegen; until upstream exposes a reviewed
  deterministic input, retain the security boundary and fail public
  reproducibility closed.

- [x] **Step 4: Run two clean release builds in isolated target directories**

  Use explicit task-scoped target directories and the same source, lockfiles,
  toolchain, environment allowlist, and release flags. Compare their unsigned
  apps with the new command and capture the exact result in the dated report.

  Expected with current pinned Tauri: the comparison reports the public
  executable mismatch caused by Isolation codegen and sets `verified: false`.
  If a newer pinned Tauri no longer varies, rerun all security and native gates
  before setting `verified: true`; do not infer success from version metadata.

- [x] **Step 5: Run focused gates**

  Run:

  ```text
  bunx vitest run scripts/compare-release-builds.test.ts scripts/package-release.test.ts
  bun run typecheck
  git diff --check
  ```

  Expected: tests pass and public packaging still rejects unverified content.

### Task 7: Full browser/native dogfood, documentation, and evidence

**Files:**

- Create: `docs/updates-and-uninstall.md`
- Create: `docs/verification/2026-08-03-native-update-uninstall-verification.md`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/trust-model.md`
- Modify: `docs/product-quality.md` only if criterion wording, not current
  status, genuinely needs correction
- Modify: `docs/superpowers/plans/2026-08-03-flect-native-update-uninstall.md`

**Interfaces:**

- Consumes all previous tasks.
- Produces dated observable evidence and a locally installed exact bundle; it
  does not claim Developer ID, notarization, Gatekeeper, stapling, or
  clean-machine success without those exact passes.

- [x] **Step 1: Run focused and full automated gates**

  Run:

  ```text
  bun run check
  bunx playwright test tests/e2e/native-update.spec.ts --project=chromium --repeat-each=3
  bunx playwright test --project=chromium
  cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
  cargo test --manifest-path src-tauri/Cargo.toml
  git diff --check
  ```

  Expected: every command passes; record exact counts and durations.

- [x] **Step 2: Build and verify ordinary development distribution**

  Run the normal Tauri build without updater or Apple release credentials.
  Verify deep/strict ad-hoc hardened-runtime signature, thin arm64 public and
  private executables, exact source/installed byte parity, and typed
  development-unavailable update state.

- [x] **Step 3: Fixture update-preservation dogfood**

  With a task-scoped temporary home and application root, stage an older signed
  fixture bundle plus durable workspace/settings/grant/extension canaries.
  Serve a signed fixture update over loopback only to the test adapter, install
  it, relaunch, and prove all canaries and accepted revision survive. Corrupt
  the signature and prove no bundle or state changes.

- [x] **Step 4: Uninstall ownership dogfood**

  Create one Flect-owned shell link, one owned agent integration, one foreign
  link, exported files, and user workspace canaries in task-scoped paths. Run
  inspect and prepare through the public command. Prove owned integrations are
  removed, foreign/user data bytes remain exact, and the app-removal instruction
  points only to the staged `Flect.app`.

- [x] **Step 5: Install the exact final bundle recoverably**

  Quit only exact current Flect processes, move the previous
  `/Applications/Flect.app` to a timestamped Trash backup, copy the verified
  source bundle, compare both executables byte-for-byte, verify code signing,
  open the app, and confirm exactly one main process, one private runtime, and
  one normal Flect window. Confirm Pi ready, Local control off, no descriptor,
  no update key, and no stuck automation process.

- [x] **Step 6: Document current truth**

  README links to `docs/updates-and-uninstall.md` and states development/public
  boundaries. Architecture owns the adapter boundary; trust-model owns authority
  and secret handling; the dated report owns current pass/fail evidence. Do not
  duplicate workflows into AGENTS.md or the canonical product-quality contract.

- [x] **Step 7: Update tracking without closing or shipping**

  Add a bounded evidence comment to issue #23 with exact tests, artifact facts,
  and credential/reproducibility residuals. Leave the issue open while any
  acceptance criterion lacks proof. Do not commit, push, release, close the
  issue, or publish updater artifacts in this task.

- [x] **Step 8: Final no-mistakes gate**

  Re-run source formatting, types, unit, full Chromium, Rust, ordinary app
  build, `codesign --verify --deep --strict`, exact bundle comparison, one-window
  inspection, descriptor absence, and `git diff --check`. Leave exactly one
  verified Flect window open.
