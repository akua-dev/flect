# Flect repository development boundary

This file governs changes to the Flect repository. It grants no authority to
commit, push, publish, deploy, or mutate external systems.

Before changing Flect:

- Read `VISION.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, and the closest
  `AGENTS.md` covering the files in scope.
- Read `.agents/skills/effect-ts/SKILL.md` and the relevant references it
  routes to before changing application architecture or Effect code.
- Run `bun run prepare` if `.repos/effect` is missing, then use that pinned
  checkout as the primary Effect API reference.
- Inspect the worktree and preserve unrelated or unfinished work.
- Keep changes inside the smallest component that owns the behavior.
- Use the approved design and implementation plan under
  `docs/superpowers/` for the initial MVP.

Repository-wide constraints:

- Model application behavior with Effect. Boundary data uses Effect Schema;
  capabilities use `Context.Service`; implementations use named `Layer`
  values; asynchronous workflows return `Effect`; streaming uses `Stream`;
  and expected failures stay typed in the error channel.
- Use `Scope` and `Effect.acquireRelease` for resource lifetime, fibers and
  interruption for cancellation, `Queue` for stream bridges, and
  `Ref`/`SubscriptionRef` for shared or observable state. Use Effect
  configuration, scheduling, retry, timeout, logging, and observability
  facilities instead of parallel ad hoc mechanisms.
- Name non-trivial workflows with `Effect.fn`, keep defects distinct from
  expected typed failures, and provide dependencies through Layers in tests.
  Use Effect test services such as `TestClock` when behavior depends on time.
- Compose Layers once at the runtime edge. React components may own rendering
  state, but data access and business workflows must enter through an Effect
  runtime rather than Promise-shaped application services.
- Use Effect as the default architecture for UI shaping. Interface documents,
  component manifests, layout and action definitions, patches, revisions,
  shaping events, validation failures, and recovery requests use Effect
  Schema at their trust boundaries. Component discovery, proposal,
  validation, preview, persistence, migration, rollback, and repair enter
  through `Context.Service` capabilities with named Layers. Live shaping and
  agent events use `Stream`, and long-lived interface state uses Effect
  concurrency primitives where shared state is required.
- React renders validated interface state and may own ephemeral interaction
  state. It must not become a parallel application architecture. Pi, React,
  Tauri, Rust, Swift, extensions, and product integrations may request UI
  changes only through the same Effect UI-shaping capabilities; none may write
  interface state directly.
- Use `@effect/vitest` for Effect behavior and test Layers for dependencies.
  Prefer Effect platform modules for HTTP, Bun, browser, configuration,
  resources, cancellation, and observability when the capability exists.
- Keep all Effect packages on exactly the version pinned in `package.json`.
  Do not add unused Effect modules merely to claim coverage.
- Do not use `any`, unsafe type assertions, synchronous throwing decoders, raw
  JSON trust, or ad hoc Promise wrappers where Effect has a typed boundary.
- Keep Pi behind the local runtime boundary. Browser code must not import Pi,
  call model providers directly, or read provider credentials.
- Pi owns model/provider authentication. Do not add another credential file,
  copy secrets into Flect state, or expose them through APIs, logs, fixtures,
  screenshots, prompts, or generated artifacts.
- Bind local services to loopback. A change that exposes the runtime to a
  network requires a separately reviewed authentication and threat model.
- Keep the built-in recovery shell and safe-mode entry point independent from
  user-modifiable interface documents and extensions.
- Keep a compiled agent composer available when a customized interface omits
  its own prompt node; user-shaped documents must not remove every route back
  to the protected shell.
- Fail closed to the built-in recovery shell when customized interface state is
  invalid or unsupported.
- Keep the Guardian, App Agent, and Shaper Pi trust domains separate. The
  Guardian uses immutable bundled instructions and required recovery
  capabilities only; it must never load user extensions or user-modifiable
  prompts. App Agent cannot shape revisions or modify recovery. The Shaper may
  receive explicitly approved UI-shaping capabilities, but it cannot modify
  the Guardian, safe mode, recovery code, or revision journal.
- A shared Pi `ModelRuntime` may resolve models and provider authentication,
  but Guardian, App Agent, and Shaper sessions use separate
  `SessionManager`, `SettingsManager`, and `ResourceLoader` instances. An
  Effect supervisor owns their acquisition, communication, interruption, and
  disposal. Deterministic validation and rollback must remain available when
  any agent or every model provider is unavailable.
- Treat Guardian output as bounded advisory text only. Guardian operations use
  closed typed reasons and cannot mutate revisions, perform rollback, grant
  capabilities, or replace deterministic recovery.
- Key client session handles by model selection, close them on replacement,
  refresh, fatal failure, and unmount, preserve them for typed busy conflicts,
  and keep the server-side session registry bounded with disposal on eviction.
- Pi tools are denied by default. Adding a tool or product capability requires
  an explicit, inspectable, revocable capability design.
- The current interactive-role exception is Flect's custom `bash` tool. App
  Agent and Shaper calls must cross the typed Flect transport to their
  role-owned browser `SandboxedShell`; never substitute Pi's native Bash, a
  host shell, a native process, or a system Bun executable.
- Inside App/Shaper execution, Bun is available only as the reserved `bun`
  command registered by `SandboxedShell`. Keep command routing, package
  mutation, module execution, preview, cancellation, and results behind their
  Effect services and schemas. Host Bun remains a repository-development tool.
- Keep browser-shell workspaces disposable and separate from canonical
  OPFS/Git, credentials, accepted interface state, and protected recovery.
  Compression, direct-network, JavaScript-evaluation, Python, SQLite, native
  addon, lifecycle-script, and host-process paths remain disabled.
- Execute optional extension logic only through the reviewed QuickJS worker
  sandbox and recovery design. It may return schema-validated inert intents;
  it must not receive native, shell, filesystem, network, credential, Pi,
  Tauri, DOM, storage, module, or arbitrary host-function authority.
- Keep runtime automation in TypeScript. Prefer native browser, Bun, Pi, and
  provider interfaces over repository-owned wrappers or shadow state.
- Keep platform behavior behind Effect services and Layers. The browser,
  Tauri host, and macOS Swift code are adapters to shared application
  capabilities, not alternate homes for product workflows or interface state.
- Test observable behavior through exported contracts, HTTP requests, and the
  rendered interface. Do not assert that source files contain selected text.
- Treat documentation as guidance, not proof that a boundary or lifecycle is
  implemented. Verify the code and fail closed where behavior is unproven.
- Never discard changes, rewrite history, commit, push, merge, publish, or
  mutate external systems unless the current task explicitly authorizes it.

When a rule is specific to one subtree, move it to that subtree's `AGENTS.md`
instead of expanding this file.

## Documentation ownership

Keep each kind of information in one canonical place and link to it elsewhere:

- `VISION.md` owns the long-term product destination, promised capabilities,
  and intentional non-capabilities.
- `PRODUCT.md` owns users, positioning, personality, and product principles.
- `DESIGN.md` owns the visible design system and interface tokens.
- `ARCHITECTURE.md` describes only verified behavior and boundaries that exist
  in the current implementation. Planned behavior must not be written there as
  though it were shipped.
- `docs/trust-model.md` explains the public capability, isolation, permission,
  and recovery model. Permanent contributor safety constraints remain in the
  closest `AGENTS.md`.
- reviewed future designs belong in `docs/superpowers/specs/`; durable
  technical decisions and their tradeoffs belong in `docs/decisions/`.
- GitHub issues own executable work and acceptance criteria. The dedicated
  public Flect organization project owns operating priority and status.
- `README.md` is a concise entry point. It summarizes current behavior and the
  destination, then links to the owning documents instead of duplicating them.

When information changes, update its owner and any affected links. Do not
maintain parallel capability lists, roadmaps, or implementation claims across
multiple documents.

## Design context

Read `PRODUCT.md` for Flect's users, positioning, personality, and product
principles. Read `DESIGN.md` before changing the visible shell; its tokens are
normative. The working interface uses the product register: familiar
affordances, restrained color, accessible state, and consistency over
decorative novelty.
