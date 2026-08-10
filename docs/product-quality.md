# Flect product-quality contract

This document is the canonical definition of the outcomes that matter to Flect
users and the evidence required to prove them. It defines the destination. It
does not claim that the current release implements every outcome.

Current observations belong in dated reports under `docs/verification/`.
Executable work belongs in GitHub issues, and live priority and status belong
in the dedicated Flect organization project.

## Constituencies

- **User:** a person using a Flect application or personal workspace.
- **Maker:** a person shaping, importing, testing, or maintaining an interface.
- **Extension author:** a person publishing a component, capsule, workflow, or
  role-scoped extension.
- **Product team:** an organization adopting Flect for a product or service.

## Maturity

A dated evaluation assigns every criterion exactly one state:

- `unimplemented`: no observable implementation exists;
- `partial`: some behavior exists but the complete promise does not;
- `implemented`: behavior exists but required proof is missing or stale;
- `proven`: all required evidence is current and passes;
- `regressed`: a previously proven outcome currently fails.

Source inspection, documentation, compilation, screenshots without behavioral
checks, or an agent assertion cannot establish `proven` alone.

## Proof classes

- **Contract:** Effect unit or integration tests through exported contracts and
  typed boundaries.
- **Browser:** real Chromium behavior against a production browser build.
- **Native:** packaged supported-host behavior through public UI and AXI
  surfaces.
- **Security:** adversarial capability, sandbox, credential, or recovery tests.
- **Accessibility:** automated checks plus keyboard and assistive-technology
  walkthroughs where automation is insufficient.
- **Experience:** bounded dogfooding or usability evidence for behavior that
  depends on human comprehension, perceived latency, or visual quality.
- **Release:** clean-install, update, artifact, checksum, compatibility, and
  reproducibility evidence.
- **Adoption:** an integration fixture or real adopter using only public
  contracts.

Evidence names the date, revision, host, exact command or workflow, result, and
applicable limitations. Sensitive values remain redacted.

## Release interpretation

- **Every release:** every behavior currently advertised by that release must
  be proven. Security, credential isolation, deterministic recovery, data
  ownership, and honest boundaries are non-waivable.
- **Public beta:** additionally requires the protected Shape–Use–recover loop,
  trustworthy installation, responsive operation, and explicit compatibility
  boundaries.
- **Stable:** additionally requires every advertised portability, extension,
  adoption, collaboration, and supported-host promise to be proven.

An outcome identifier remains stable when its wording improves. Retire an
identifier instead of silently reusing it for a different promise.

## FQ-01 Installation and first run

**Constituencies:** User, Maker, Product team
**Gate:** Every advertised host; complete pillar for public beta
**Primary proof:** Browser, Native, Release, Experience

- **FQ-01.1:** Native installation is trustworthy and simple.
- **FQ-01.2:** Browser Flect works without requiring a desktop application.
- **FQ-01.3:** Provider authentication can be completed inside Flect without a
  terminal prerequisite.
- **FQ-01.4:** Existing approved Pi authentication is detected without copying
  credentials into Flect state.
- **FQ-01.5:** Users can determine where models, workspaces, and credentials
  live.
- **FQ-01.6:** Updating and uninstalling have documented, predictable behavior.
- **FQ-01.7:** A blank installation is immediately useful without an existing
  product backend.

## FQ-02 Immediate comprehension

**Constituencies:** User, Maker
**Gate:** Public beta
**Primary proof:** Browser, Accessibility, Experience

- **FQ-02.1:** A first-time user can understand what Flect is and begin a
  meaningful task without reading external documentation.
- **FQ-02.2:** Canvas, composer, candidate preview, and accepted interface are
  distinguishable.
- **FQ-02.3:** The active **Use** or **Shape** target is visible before send.
- **FQ-02.4:** The user knows whether an action changes a candidate or uses the
  accepted product.
- **FQ-02.5:** Model, workspace, capability, and permission state are
  discoverable without dominating the work surface.
- **FQ-02.6:** Ordinary use does not require understanding an IDE, agent
  harness, runtime, or infrastructure terminology.

## FQ-03 Conversational shaping

**Constituencies:** User, Maker
**Gate:** Public beta
**Primary proof:** Contract, Browser, Experience

- **FQ-03.1:** A user can create a useful interface from a blank workspace by
  describing the desired outcome.
- **FQ-03.2:** A user can make a precise change without unrelated interface
  changes.
- **FQ-03.3:** Questions are answered without being mistaken for edit
  instructions.
- **FQ-03.4:** Shaper can explain its intended or completed change in user
  language.
- **FQ-03.5:** Follow-up instructions retain the correct candidate, revision,
  and conversation context.
- **FQ-03.6:** Images, files, examples, and supported source projects can supply
  shaping context without bypassing validation.
- **FQ-03.7:** Direct manipulation and conversational changes converge on the
  same revision model.
- **FQ-03.8:** Explicitly approved Shaper extensions may extend authoring
  behavior without extending their own authority.

## FQ-04 Fast Shape–Use testing

**Constituencies:** User, Maker, Extension author
**Gate:** Public beta
**Primary proof:** Contract, Browser, Experience, Performance evidence

- **FQ-04.1:** Shape provides a live candidate product preview.
- **FQ-04.2:** Preview App Agent and Shaper remain warm during an editing
  session.
- **FQ-04.3:** Switching **Use ↔ Shape** is immediate and does not require
  repeated authorization within the active editing session.
- **FQ-04.4:** Each target preserves its draft, conversation position, and
  relevant context.
- **FQ-04.5:** Candidate product extensions can be exercised before acceptance.
- **FQ-04.6:** A request such as “fix what just happened” can attach the bounded
  failure, operation trace, candidate revision, and relevant UI state to
  Shaper.
- **FQ-04.7:** Automatic target selection is visible and instantly
  overridable.
- **FQ-04.8:** An incorrect target prediction cannot accept, publish, or perform
  an irreversible action.

## FQ-05 Product usage

**Constituencies:** User, Product team
**Gate:** Every advertised product capability; complete pillar for public beta
**Primary proof:** Contract, Browser, Adoption, Security

- **FQ-05.1:** The accepted interface remains useful without invoking a model.
- **FQ-05.2:** App Agent understands only the product capabilities and bounded
  public context exposed to it.
- **FQ-05.3:** App Agent can answer questions and perform approved product
  actions through typed capabilities.
- **FQ-05.4:** Tool execution, status, and results appear coherently in the
  product experience.
- **FQ-05.5:** A product adopting Flect does not need to ship a separate
  assistant surface.
- **FQ-05.6:** Users may select model access they control where product policy
  permits.
- **FQ-05.7:** Product authentication and authorization remain authoritative
  regardless of model or interface customization.

## FQ-06 Preview, acceptance, and recovery

**Constituencies:** All
**Gate:** Every release
**Primary proof:** Contract, Browser, Native, Security

- **FQ-06.1:** Every unaccepted interface change is visibly a candidate.
- **FQ-06.2:** Users can inspect the meaningful change before acceptance.
- **FQ-06.3:** Keep and Reject are deterministic protected actions.
- **FQ-06.4:** History, comparison, undo, and rollback preserve attribution and
  accepted-state integrity.
- **FQ-06.5:** Accepted revisions record sufficient attribution for explanation
  and recovery.
- **FQ-06.6:** Last-known-good recovery works without a model provider.
- **FQ-06.7:** Shaped UI and extensions cannot remove or replace safe mode.
- **FQ-06.8:** Broken extensions can be disabled through the protected shell.
- **FQ-06.9:** A crash during shaping cannot destroy or silently replace the
  accepted product.

## FQ-07 Git-backed ownership

**Constituencies:** Maker, Extension author, Product team
**Gate:** Stable when Git-backed authoring is advertised
**Primary proof:** Contract, Browser, Native, Release

- **FQ-07.1:** A canonical Flect workspace is a real Git repository.
- **FQ-07.2:** Browser and desktop hosts provide Git behavior without requiring
  system Git.
- **FQ-07.3:** Shaper uses ordinary Git concepts rather than proprietary shadow
  history.
- **FQ-07.4:** Candidate changes are isolated from the accepted revision.
- **FQ-07.5:** Users can inspect, export, and continue the repository outside
  Flect.
- **FQ-07.6:** Conflicts and interrupted operations have understandable,
  recoverable states.
- **FQ-07.7:** Protected Flect metadata does not take ownership of or corrupt
  the user's repository.

## FQ-08 Import and export

**Constituencies:** Maker, Product team
**Gate:** Stable for every advertised framework
**Primary proof:** Browser, Native, Release, Adoption

- **FQ-08.1:** Advertised React, Vue, Svelte, HTML, and CSS project classes have
  versioned import compatibility.
- **FQ-08.2:** Unsupported dependencies are reported before destructive work.
- **FQ-08.3:** Supported assets, routing, styling, and state survive import.
- **FQ-08.4:** Imported source remains recognizable and maintainable.
- **FQ-08.5:** Users can export ordinary source and Git history.
- **FQ-08.6:** Exported projects are not locked to a proprietary Flect service.
- **FQ-08.7:** Failed import leaves the source project and accepted workspace
  recoverable.

## FQ-09 Portable `.flect` applications

**Constituencies:** User, Maker, Extension author, Product team
**Gate:** Stable when capsules are advertised
**Primary proof:** Contract, Browser, Native, Release, Security

- **FQ-09.1:** Capsules install without a proprietary hosted service.
- **FQ-09.2:** Installed capsules run without their original build tool or
  package registry.
- **FQ-09.3:** Capsule contents, provenance, permissions, and compatibility are
  inspectable before activation.
- **FQ-09.4:** A capsule can carry UI, public agent instructions, and
  role-scoped extensions under one versioned contract.
- **FQ-09.5:** Users can fork and personalize an installed capsule.
- **FQ-09.6:** Upstream updates do not silently overwrite personal changes.
- **FQ-09.7:** Browser and supported desktop hosts agree on the portable
  capsule contract.

## FQ-10 Extensions

**Constituencies:** User, Maker, Extension author, Product team
**Gate:** Every release that loads extensions
**Primary proof:** Contract, Security, Browser, Native, Release

- **FQ-10.1:** Extensions are explicitly enabled per workspace and target role.
- **FQ-10.2:** App Agent and Shaper extensions remain isolated from each
  other's private session and authority.
- **FQ-10.3:** Permissions are understandable before activation.
- **FQ-10.4:** Extensions cannot access provider credentials or unrelated
  product data.
- **FQ-10.5:** Users can inspect, disable, update, pin, fork, and remove
  extensions.
- **FQ-10.6:** A failed extension cannot prevent protected startup or recovery.
- **FQ-10.7:** Components and extensions can be shared without becoming trusted
  merely because of publisher or signature.
- **FQ-10.8:** Compatibility and migration failures explain a safe recovery
  path.

## FQ-11 Sandbox and capabilities

**Constituencies:** All
**Gate:** Every release
**Primary proof:** Contract, Security, Browser, Native

- **FQ-11.1:** Generated UI and logic cannot escape their declared execution
  realm through supported interfaces.
- **FQ-11.2:** Agent Bash is useful inside its role sandbox without exposing a
  host shell or native process authority.
- **FQ-11.3:** Browser workspaces use a durable browser-native filesystem where
  canonical persistence is required.
- **FQ-11.4:** Filesystem, network, SQL, product, model, and native effects cross
  explicit typed capabilities.
- **FQ-11.5:** Capabilities are least-privilege, inspectable, attributable, and
  revocable.
- **FQ-11.6:** Capsules, shaped UI, and extensions cannot grant themselves
  authority.
- **FQ-11.7:** Credentials never enter prompts, Git, screenshots, logs, or
  extension-visible state.
- **FQ-11.8:** CPU, memory, storage, output, and execution limits prevent
  unbounded resource use.
- **FQ-11.9:** Security claims distinguish browser or worker isolation from an
  operating-system sandbox.

## FQ-12 Models and authentication

**Constituencies:** User, Maker, Product team
**Gate:** Public beta
**Primary proof:** Contract, Browser, Native, Security, Experience

- **FQ-12.1:** Provider login and recovery are available inside Flect.
- **FQ-12.2:** Users can discover and select authenticated compatible models.
- **FQ-12.3:** Missing, expired, or unsupported authentication produces a clear
  recovery action.
- **FQ-12.4:** Switching models preserves valid conversation and revision
  state.
- **FQ-12.5:** Reasoning effort and other exposed controls use understandable
  product language.
- **FQ-12.6:** Provider credentials remain outside shaped applications and
  role extensions.
- **FQ-12.7:** Products may provide inference but are not required to do so.
- **FQ-12.8:** Deterministic recovery remains available without any model.

## FQ-13 Agent transparency

**Constituencies:** User, Maker
**Gate:** Public beta
**Primary proof:** Browser, Accessibility, Experience

- **FQ-13.1:** The active agent and its authority are visible before send.
- **FQ-13.2:** Tool calls are distinguishable from assistant prose.
- **FQ-13.3:** Queued, running, completed, failed, and cancelled states are
  explicit.
- **FQ-13.4:** Duration and bounded useful output are inspectable.
- **FQ-13.5:** Errors name the failed operation and a safe next action.
- **FQ-13.6:** Ordinary use is not overwhelmed by infrastructure activity.
- **FQ-13.7:** Markdown, code, tables, disclosures, and links render safely and
  legibly.
- **FQ-13.8:** Streaming and activity updates do not steal scroll position or
  focus.

## FQ-14 External agent control

**Constituencies:** Maker, Extension author, Product team
**Gate:** Every release advertising outside control
**Primary proof:** Contract, Browser, Native, Security

- **FQ-14.1:** Public AXI commands can inspect and operate the same live
  workspace as the UI.
- **FQ-14.2:** Embedded role Bash exposes the applicable AXI language without
  a separate model-visible tool catalog.
- **FQ-14.3:** JSON, SSE, MCP, native, and browser adapters converge on the same
  reactive state and Effect controller.
- **FQ-14.4:** Authorized external actions appear immediately in the visible
  interface.
- **FQ-14.5:** External agents can inspect bounded evidence, cancel work, and
  debug through public surfaces.
- **FQ-14.6:** External control cannot bypass validation, permissions,
  acceptance, or recovery.
- **FQ-14.7:** Outside control is disabled by default and immediately
  revocable.
- **FQ-14.8:** Browser Flect offers a portable in-app equivalent without
  requiring an additional installed binary.

## FQ-15 Performance and responsiveness

**Constituencies:** User, Maker
**Gate:** Public beta
**Primary proof:** Browser, Native, Experience, measured performance evidence

- **FQ-15.1:** Supported-host startup meets a documented interactive budget.
- **FQ-15.2:** Warm **Use ↔ Shape** targeting meets a documented switch
  budget.
- **FQ-15.3:** Typing remains responsive while agents, builds, and previews
  run.
- **FQ-15.4:** Streaming remains visually smooth under representative output.
- **FQ-15.5:** Long conversations and bounded tool output remain responsive.
- **FQ-15.6:** Preview rebuilds avoid unnecessary full-workspace work.
- **FQ-15.7:** Background agents and extension hosts remain within explicit
  resource budgets.
- **FQ-15.8:** Cancellation gives prompt feedback and terminates owned work.
- **FQ-15.9:** Repeated long-running sessions do not exhibit unbounded memory
  growth.

## FQ-16 Reliability

**Constituencies:** All
**Gate:** Public beta
**Primary proof:** Contract, Browser, Native, Security

- **FQ-16.1:** Refreshing or restarting preserves accepted work.
- **FQ-16.2:** Applicable drafts, conversation state, and candidate state
  recover consistently.
- **FQ-16.3:** Network interruption does not corrupt revision or conversation
  state.
- **FQ-16.4:** Stale candidates cannot overwrite newer accepted work.
- **FQ-16.5:** Concurrent operations are rejected, serialized, or reconciled
  explicitly.
- **FQ-16.6:** Runtime and shell version incompatibility is detected before
  unsafe operation.
- **FQ-16.7:** Browser-storage exhaustion has a deterministic recovery path.
- **FQ-16.8:** Partial updates and process crashes repair forward or return to
  last-known-good state.

## FQ-17 Privacy and data ownership

**Constituencies:** All
**Gate:** Every release
**Primary proof:** Contract, Security, Release

- **FQ-17.1:** Workspaces and personal customizations belong to the user.
- **FQ-17.2:** Users can determine what remains local, is synchronized, or is
  sent to a selected model.
- **FQ-17.3:** Telemetry is absent or explicitly disclosed and controlled.
- **FQ-17.4:** Product connections cannot take ownership of personal
  customizations.
- **FQ-17.5:** User data can be exported and deleted through documented paths.
- **FQ-17.6:** Credentials remain in the approved credential owner.
- **FQ-17.7:** Diagnostics and operation evidence are bounded and redacted.
- **FQ-17.8:** Local-only and offline-capable workflows remain possible where
  their declared capabilities permit.

## FQ-18 Accessibility

**Constituencies:** User, Maker
**Gate:** Every user-visible release
**Primary proof:** Accessibility, Browser, Native

- **FQ-18.1:** The complete protected shell is keyboard operable.
- **FQ-18.2:** Focus is visible, ordered, and restored across sheets, menus,
  role changes, and recovery.
- **FQ-18.3:** Assistive technology receives meaningful agent, tool, validation,
  and status changes.
- **FQ-18.4:** Color is never the only state signal.
- **FQ-18.5:** Text, placeholders, icons, and controls meet WCAG 2.2 AA contrast
  requirements.
- **FQ-18.6:** Reduced-motion preferences preserve complete behavior.
- **FQ-18.7:** Zoom, text scaling, narrow layouts, and reflow remain usable.
- **FQ-18.8:** Touch targets meet the applicable supported-platform guidance.
- **FQ-18.9:** Safe mode remains accessible when shaped UI is inaccessible.

## FQ-19 Visual and interaction quality

**Constituencies:** User, Maker, Product team
**Gate:** Public beta
**Primary proof:** Browser, Native, Accessibility, Experience

- **FQ-19.1:** The protected shell feels calm, professional, coherent, and
  first-party on each supported host.
- **FQ-19.2:** The user's work remains more prominent than agent and runtime
  infrastructure.
- **FQ-19.3:** Controls use familiar product affordances and complete
  interaction states.
- **FQ-19.4:** Information density is space-efficient without becoming cramped.
- **FQ-19.5:** Motion communicates state and does not delay work.
- **FQ-19.6:** Responsive layouts never duplicate, hide, or trap access to the
  protected composer and recovery controls.
- **FQ-19.7:** Supported light and dark appearances are deliberate rather than
  mechanically inverted.
- **FQ-19.8:** Product interfaces may establish their own design language
  without weakening the protected shell.
- **FQ-19.9:** Customization of Flect's own composer and rail has a deterministic
  protected fallback.

## FQ-20 Cross-platform behavior

**Constituencies:** User, Maker, Product team
**Gate:** Every advertised host
**Primary proof:** Browser, Native, Release, Adoption

- **FQ-20.1:** The browser is a first-class Flect host rather than a reduced
  remote viewer.
- **FQ-20.2:** macOS uses native host behavior where it materially improves the
  experience.
- **FQ-20.3:** Shared product behavior comes from one typed application core.
- **FQ-20.4:** Swift, Kotlin, Rust, or another native adapter enters through
  narrow reviewed capabilities.
- **FQ-20.5:** Unsupported platform capabilities degrade explicitly.
- **FQ-20.6:** Every advertised Windows, Linux, mobile, and desktop host has a
  current compatibility contract.
- **FQ-20.7:** Workspaces and capsules remain portable across compatible hosts.

## FQ-21 Product-team adoption

**Constituencies:** Product team, User, Extension author
**Gate:** Stable when product adoption is advertised
**Primary proof:** Adoption, Contract, Security, Release

- **FQ-21.1:** Products expose approved APIs and capabilities without replacing
  the Flect shell.
- **FQ-21.2:** A team can ship an excellent recommended default experience.
- **FQ-21.3:** Users can personalize locally without changing the product for
  other users.
- **FQ-21.4:** Product policy remains authoritative over available
  capabilities.
- **FQ-21.5:** Product branding cannot obscure or weaken protected recovery.
- **FQ-21.6:** Products can adopt Flect incrementally through public contracts.
- **FQ-21.7:** Teams can test, version, distribute, and update their Flect
  experience.
- **FQ-21.8:** Stable compatibility and migration contracts protect adopters
  across Flect upgrades.

## FQ-22 Open-source and ecosystem trust

**Constituencies:** All
**Gate:** Every public release
**Primary proof:** Release, Contract, Adoption

- **FQ-22.1:** The protected core remains small enough to inspect and maintain.
- **FQ-22.2:** Published builds are reproducible from the released source and
  declared toolchain.
- **FQ-22.3:** Releases are signed or checksummed, attributable, and documented.
- **FQ-22.4:** Capsule, extension, capability, and host contracts are versioned.
- **FQ-22.5:** Breaking changes provide explicit migrations or compatibility
  failures.
- **FQ-22.6:** Documentation distinguishes current observable behavior from
  future design.
- **FQ-22.7:** Fundamental local and browser workflows require no proprietary
  Flect service.
- **FQ-22.8:** Licensing and governance permit understandable community and
  commercial adoption.

## FQ-23 Sharing and collaboration

**Constituencies:** User, Maker, Extension author, Product team
**Gate:** Stable when sharing is advertised
**Primary proof:** Contract, Security, Release, Adoption

- **FQ-23.1:** Experiences, components, themes, workflows, and extensions can be
  shared independently where their contracts permit.
- **FQ-23.2:** Recipients can inspect provenance, compatibility, and requested
  authority before activation.
- **FQ-23.3:** Personal changes survive compatible upstream updates.
- **FQ-23.4:** Teams can review proposed interface and capability changes like
  code.
- **FQ-23.5:** Forking preserves attribution without creating authority.
- **FQ-23.6:** Private sharing does not require public publication.
- **FQ-23.7:** Untrusted shared artifacts open in a safe inspectable state before
  approval.

## FQ-24 Honest boundaries

**Constituencies:** All
**Gate:** Every release
**Primary proof:** Contract, Browser, Native, Release, Experience

- **FQ-24.1:** Flect clearly reports which source, dependency, and execution
  classes it cannot run.
- **FQ-24.2:** Browser compatibility problems are reported before destructive
  build or import work.
- **FQ-24.3:** CORS, backend, authorization, and product-data limitations are
  explained in user language.
- **FQ-24.4:** Web UI is not falsely represented as a native platform control.
- **FQ-24.5:** Flect does not claim to replace a product backend, database,
  business logic, or authorization model.
- **FQ-24.6:** Unsupported packages and capabilities fail with actionable
  alternatives where available.
- **FQ-24.7:** Isolation claims name their actual browser, worker, process, or OS
  boundary.
- **FQ-24.8:** Marketing, release notes, screenshots, and documentation do not
  advertise behavior absent from the shipped release.

## Ultimate user outcome

A Flect user can install it, understand it, shape something useful, test it
immediately, trust what it does, recover from mistakes, own and export the
result, and use it anywhere Flect claims to support—without becoming dependent
on Flect or surrendering control of their data.
