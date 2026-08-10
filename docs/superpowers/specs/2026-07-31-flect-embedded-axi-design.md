# Flect embedded AXI design

Date: 2026-07-31

## Status

Robin approved the product direction in conversation. This written design is
awaiting final review before implementation planning and code changes.

This design supersedes the separately shipped `flectctl` and `flect-mcp`
packaging decisions in
[`2026-07-31-flect-observable-control-design.md`](2026-07-31-flect-observable-control-design.md).
It preserves that design's single-controller, loopback-authentication,
attribution, revocation, reactive-state, and bounded-evidence decisions.

## Outcome

Flect has one public command surface named `flect`.

- The native Flect executable launches the app or serves agent-ergonomic
  commands according to its invocation context.
- App Agent and Shaper receive the same command language as a reserved command
  in their role-owned browser `just-bash` workspaces.
- Browser-hosted Flect remains fully functional without a native binary.
- JSON/SSE and MCP remain compatibility adapters over the same command and
  state authority.
- The packaged app no longer ships public `flectctl` or `flect-mcp`
  executables.
- The existing private `flect-runtime` helper remains because it hosts Pi,
  Bun, Effect RPC, and the local control broker. It is an application engine,
  not a second public command product.

The command experience follows the Agent eXperience Interface principles at
<https://axi.md/>. Structured stdout uses the official TOON implementation and
the current published TOON specification at
<https://toonformat.dev/reference/spec>.

## Product decisions

### One visible product, not a companion utility

Users and outside agents should learn `flect`, not a companion executable.
The installed application is already the natural owner of its control
language, documentation, version, lifecycle, and compatibility contract.

On macOS:

- launching Flect through Finder opens the graphical application;
- invoking `flect` from an interactive terminal with no arguments prints the
  live AXI home view;
- `flect app` explicitly opens or focuses the graphical application; and
- all other supported arguments enter the embedded command program.

The graphical app offers an explicit **Install command-line integration**
control. It creates or repairs a user-owned `flect` link to the executable
inside the installed application bundle, preferring `~/.local/bin` and showing
the exact target before mutation. It never copies a second executable, never
requests administrator access, and has a matching removal action. The full
bundle path remains usable when the user does not want PATH integration.

The terminal/Finder distinction is a host concern. Rust may select the mode
and start the private runtime, but it must not parse domain commands, duplicate
Effect schemas, render TOON, or implement workspace behavior.

### The CLI is primarily for agents

Human readability remains useful, but token cost, deterministic discovery,
non-interactive operation, and self-correction take priority. The default
output is compact TOON rather than prose or a decorative table.

The command interface follows these AXI rules:

1. stdout contains structured TOON data, errors, and contextual suggestions;
2. stderr contains only optional debug diagnostics and progress;
3. list views expose only the fields needed to choose a next action;
4. large fields are bounded with their total size and a `--full` escape hatch;
5. cheap aggregates are returned with the data that needs them;
6. empty results are explicit successful answers;
7. mutations are idempotent state changes rather than ambiguous toggles;
8. missing or unknown input fails before any mutation;
9. exit code `0` means success or an already-satisfied no-op, `1` means an
   operational failure, and `2` means invalid usage;
10. no command opens an interactive prompt;
11. no-argument views show current live state rather than a manual;
12. contextual `help[]` suggestions expose likely next commands; and
13. every command supports concise, command-local `--help` output.

`--json` remains an explicit compatibility output for programs that require
JSON. It is not the agent-facing default.

### Same language, authority derived from the caller

The public language is shared, but authority is not. A command source is a
trusted input supplied by the adapter, never a user-controlled flag.

Sources are:

- `user`: a protected visible Flect control;
- `control`: an authenticated, user-enabled outside client; and
- `agent`: an App Agent or Shaper session identified by its role, session,
  turn, and tool call.

The role-owned sandbox captures the `agent` source when it creates the virtual
command. Environment variables such as `FLECT_ROLE`, command arguments,
workspace files, extensions, and model output cannot select or alter it.

Outside control keeps its existing full user-equivalent authority after the
user enables it. It still cannot enable its own grant. Internal agents receive
only the smallest capability set needed by their role.

### App Agent authority

App Agent may:

- view the compact workspace and current accepted interface;
- inspect its own conversation, operation, and tool activity;
- list actions exposed by the accepted interface;
- inspect the declaration and current availability of an action; and
- invoke an action for which the product capability broker has an active
  grant.

App Agent may not:

- enter Edit mode or submit a Shaper instruction;
- create, validate as authoritative, accept, reject, or roll back revisions;
- change model selection, favorites, or extension policy;
- enable or disable outside control;
- enter or leave safe mode;
- modify the protected rail; or
- prompt, cancel, impersonate, or otherwise control another role.

### Shaper authority

Shaper may:

- view the compact workspace, active interface, proposal, and bounded revision
  history;
- inspect its own conversation, operation, build, preview, and tool activity;
- obtain the closed interface schema and component manifest;
- validate a candidate interface document from its own disposable workspace;
- submit a validated candidate as the current preview proposal; and
- run the already-approved browser build and preview capabilities.

Shaper may not:

- accept, reject, or roll back its proposal;
- mutate accepted or last-known-good state directly;
- modify the revision journal;
- enter or leave safe mode;
- change models, extensions, outside-control grants, or protected rail state;
- invoke product actions as App Agent; or
- prompt, cancel, impersonate, or otherwise control another role.

The Guardian remains tool-free. It receives no Bash or `flect` command.

### The CLI replaces broad Pi tool schemas where it is the better interface

Shaper should normally complete a proposal with commands such as:

```sh
flect interface inspect
flect interface schema
flect interface validate ./interface.json
flect interface propose ./interface.json
```

The candidate file is read only from Shaper's own disposable virtual
filesystem. The shell adapter decodes it at the boundary and passes a strict
typed document to the controller. The controller never receives or resolves a
sandbox path.

Once this path is verified, the dedicated Pi `propose_interface` tool can be
removed. This reduces always-loaded tool schema while preserving the same
Effect Schema validation and ShapingKernel authority. It must not be removed
before the virtual command path passes the real Shaper integration tests.

App Agent should use `flect action ...` for product interaction rather than a
growing set of product-specific Pi tools. Product capability adapters remain
typed, inspectable, approved, and revocable behind the command.

## Approaches considered

### 1. Keep separately packaged control executables

Rejected.

This is close to the current working tree and is inexpensive initially, but it
creates a second visible product name, complicates releases, and encourages
the native, browser, and agent surfaces to drift.

### 2. Reimplement commands in Rust and in browser TypeScript

Rejected.

Rust is an appropriate native host adapter, but a second parser, schema,
authorization policy, error model, and formatter would violate the single
Effect command authority. Browser-only behavior would also become a separate
implementation.

### 3. One Effect AXI program with source-specific gateways

Selected.

One TypeScript command program parses arguments, validates strict input,
dispatches typed operations, projects bounded results, formats TOON or JSON,
and assigns exit codes. Thin native, sandbox, HTTP/SSE, and MCP adapters provide
transport and trusted caller identity only.

## Target topology

```text
                              Flect AXI program
                 parse -> authorize -> execute -> project -> TOON
                                      |
             +------------------------+-----------------------+
             |                        |                       |
             v                        v                       v
      native `flect`          reserved sandbox          HTTP/SSE and
      public executable       `flect` command           `flect mcp`
             |                        |                       |
             v                        v                       v
     private flect-runtime    AgentCommandBus         local broker client
             |                        |                       |
             +------------------------+-----------------------+
                                      |
                                      v
                           FlectWorkspaceController
                         one typed command/state authority
                                      |
                  +-------------------+-------------------+
                  |                   |                   |
                  v                   v                   v
           AgentWorkspace       ShapingKernel      OperationJournal
           App / Shaper Pi      revision state     bounded evidence
                                      |
                                      v
                         SubscriptionRef / event Stream
                                      |
                                      v
                               reactive React UI
```

## Effect service design

### `FlectAxiProgram`

`FlectAxiProgram` is the reusable command-language boundary. It consumes an
argument vector and an invocation context and returns an Effect result with
structured output and a closed exit code.

Its responsibilities are:

- strict command and flag parsing;
- command-local help;
- conversion into schema-defined command requests;
- delegation to a `FlectCommandGateway`;
- AXI projection and truncation;
- TOON encoding at the final stdout boundary;
- optional JSON encoding; and
- translation of typed failures into stable public errors.

Internal logic remains schema-defined values. TOON is not used as the
application's state or transport representation.

### `FlectCommandGateway`

`FlectCommandGateway` is a `Context.Service` exposing the semantic operations
needed by the command program: current home state, inspection, bounded logs,
event subscription, and typed command execution.

There are two implementations:

- `BrokerFlectCommandGatewayLive` uses the authenticated loopback client for
  a native outside caller; and
- `AgentFlectCommandGatewayLive` submits source-bound requests to the
  in-process `AgentCommandBus`.

The command parser and formatter do not know which gateway is present.

### `AgentCommandBus`

`AgentCommandBus` is a browser-local `Context.Service` built from a bounded
Effect `Queue`. Each request contains:

- the non-forgeable agent source captured by the role-owned shell;
- one strict internal command value; and
- an Effect `Deferred` for its exact terminal result.

A scoped bridge fiber consumes the queue and dispatches through
`FlectWorkspaceController`. Closing the application scope shuts down the queue
and fails pending requests with a typed unavailable error.

The layer graph remains acyclic:

```text
AgentCommandBus
      -> role-owned SandboxedShell
      -> AgentWorkspace
      -> FlectWorkspaceController
      -> AgentCommandBridge consumer
```

The bridge, controller, parser, policy, and formatter use named `Effect.fn`
operations. Queue capacity, response deadlines, output bounds, and
interruption are explicit. Expected policy, parse, conflict, timeout, and
unavailable conditions remain typed failures rather than defects.

### Re-entrant agent commands

An internal command may occur during a controller operation that is already
awaiting the same agent turn. The controller must therefore allow a tightly
bounded set of re-entrant role commands without holding a global command lock
across the complete Pi turn.

The existing short command-claim critical section remains serialized.
Long-running work does not hold that permit. Internal role policy prevents
recursive prompt submission, cross-role cancellation, mode changes, and other
commands that could form cycles.

Shaper proposal submission and App action invocation create attributed child
operations linked to the parent turn and tool call. The outer turn completes
only after its in-flight child command has reached a terminal result.

### Command source and authorization

`FlectCommandSource` gains an `AgentCommandSource` schema with bounded stable
identifiers and an `app | shaper` role. Authorization remains inside
`FlectWorkspaceController`; hiding commands from help is useful UX but is not
the security boundary.

Every adapter supplies its source out of band:

- React supplies `user`;
- the broker supplies the authenticated `control` client;
- each sandbox closure supplies its captured `agent` identity.

Raw commands cannot include or override their source.

## Command language

The exact command catalog may be refined during test-driven implementation,
but its noun-first structure is:

```text
flect
flect app
flect status
flect inspect [--full] [--fields <fields>]
flect logs [--role <role>] [--operation <id>] [--limit <n>] [--full]
flect watch [--after <sequence>]
flect mode set <edit|run>
flect prompt <text>|--stdin
flect shape <instruction>|--stdin
flect action list
flect action inspect <node-id>
flect action invoke <node-id>
flect interface inspect [--full]
flect interface schema [--full]
flect interface validate <path>
flect interface propose <path>
flect proposal accept|reject
flect revision list
flect revision rollback [<revision-id>]
flect model list
flect model select <provider/id|auto>
flect model favorite add|remove <provider/id>
flect extensions enable|disable <app|shaper>
flect safe enter|restore
flect rail collapse|expand
flect rail width <pixels>
flect control status|disable
flect setup status
flect setup shell install|remove
flect setup agent install|remove <codex|claude|opencode>
flect mcp
```

The top-level and noun home views show only commands available to the caller.
Attempting a known but unauthorized command still returns a structured policy
error so hidden help is not confused with enforcement.

State-setting mutations replace toggles. Repeating an already-satisfied
request returns a no-op result with exit code `0`. Command identifiers retain
the controller's bounded deduplication semantics.

Long-running commands wait for their own terminal event by default and return
the useful resulting state in the same response. Agents should not need a
separate `inspect` after `shape`, `propose`, `accept`, or `invoke` merely to
learn whether the action succeeded and what changed.

## AXI output contract

### Home view

Native example:

```text
bin: /Applications/Flect.app/Contents/MacOS/flect
description: Inspect and operate the live Flect workspace
workspace:
  id: workspace-local-default
  mode: edit
  phase: preview
  sequence: 42
agents[2]{role,state,model}:
  app,idle,openai/gpt-5.4
  shaper,idle,openai/gpt-5.4
proposal:
  revision: revision-8
  status: previewed
help[3]:
  Run `flect proposal accept` to keep the preview
  Run `flect proposal reject` to discard the preview
  Run `flect logs --limit 20` to inspect recent activity
```

The browser sandbox identifies itself honestly as embedded rather than
inventing a filesystem executable path:

```text
bin: flect
runtime: browser-embedded
description: Inspect and operate this role's Flect workspace
```

### Errors

Errors are stable structured values on stdout:

```text
error:
  code: unauthorized
  message: App Agent cannot change interface revisions.
help[1]:
  Run `flect action list` to see actions available to App Agent
```

Unknown flags and missing arguments include the relevant concise reference and
exit with code `2`. Raw dependency errors, stack traces, bearer values, model
credentials, and unbounded command output never enter stdout.

### Truncation and fields

Collections report visible and total counts. Detail fields use a bounded
preview, a total character count, and `--full` only where the caller is
authorized to receive the complete value. `--fields` accepts a closed field
set per command and rejects invented fields.

Output limits apply before TOON encoding and again to the encoded byte stream.
The virtual command also remains subject to the existing `just-bash` output
limit.

## Native packaging and process model

The Tauri Rust entrypoint selects one of three modes before constructing a
WebView:

1. graphical application mode;
2. AXI command mode; or
3. MCP stdio mode.

For command and MCP modes, Rust locates the sibling private `flect-runtime`,
starts it in the appropriate private mode, inherits stdin/stdout/stderr, and
propagates its exit status. It performs no domain parsing and receives no
credential-bearing arguments.

`server/sidecar.ts` becomes a multi-mode private runtime entrypoint:

- application mode launches the existing Effect RPC server and control broker;
- AXI mode launches `FlectAxiProgram` with the broker gateway; and
- MCP mode launches the MCP adapter with the same gateway.

Release packaging contains the normal Tauri `flect` executable and the private
`flect-runtime` helper. `flectctl` and `flect-mcp` are removed from Tauri
`externalBin`, release validation, archive contents, checksums, documentation,
and smoke commands.

The optional shell integration is a link to that same Tauri executable, not a
copied wrapper or companion binary. The protected UI and `flect setup shell`
use one typed native host capability for inspect, install, repair, and remove.
The capability accepts no arbitrary link source or destination. Browser hosts
do not provide it.

Repository development may retain source modules named for their
responsibility, but package scripts use `bun run flect -- ...` and
`bun run flect:mcp` only if needed for unbundled development. No release emits
those modules as additional public executables.

## Browser sandbox integration

`SandboxedShell` registers `flect` with the same reserved-command strategy as
the current `bun` command:

- the visible command name is rewritten in the parsed Bash AST to a randomized
  hidden custom-command name;
- aliases, functions, workspace files, `PATH`, and environment changes cannot
  replace the reserved implementation;
- command substitution, pipes, redirection, and normal Bash composition remain
  available inside the sandbox; and
- no host process, system executable, localhost call, credential, or native
  filesystem access is introduced.

Each role receives a distinct gateway bound to its role and current Pi session
context. The disposable shell filesystem remains separate from accepted OPFS
and Git state. Explicit `interface validate` and `interface propose` file
arguments can read only through that role's virtual filesystem and its normal
path confinement.

## MCP and HTTP/SSE compatibility

AXI is the preferred agent interface. MCP remains useful for hosts that cannot
or should not execute shell commands.

`flect mcp` serves the current compact stdio protocol through the public
`flect` executable. MCP and JSON/SSE continue to use the authenticated outside
control source, so they require a running workspace and an explicit user grant.
They do not gain the browser sandbox's in-process role authority.

The MCP tool catalog stays compact and schema-generated. It must not grow one
tool per CLI subcommand. The AXI program and MCP adapter share commands and
public result projections rather than calling each other through text.

## Ambient agent integration

Inside Flect, App Agent and Shaper receive a compact role-specific home view in
their initial context and are told that `flect` is available through Bash.
Live details stay discoverable through the command rather than being repeated
in every prompt.

Native Flect exposes explicit, idempotent `setup agent install` commands for
Codex, Claude Code, and OpenCode. A setup command may install or repair a
directory-scoped session integration only after that explicit invocation. It
must:

- verify the current public executable path;
- use the PATH-resolved `flect` name only when it resolves to this executable;
- otherwise use its absolute path;
- avoid duplicate hooks or plugins;
- repair stale executable paths;
- print the exact change or no-op result;
- support a corresponding removal path; and
- be tested against temporary configuration roots rather than the developer's
  real agent configuration.

Flect also ships an installable Agent Skill generated from the same static
guidance used by the AXI home view. Generation has a drift check. The skill
contains no live state, credentials, or native-only assumption.

Browser-only distributions may offer the generated Skill as a download, but
they cannot silently install host hooks or claim to expose an OS executable.
The exact supported hook or plugin formats must be re-verified against each
agent host's current authoritative documentation during implementation rather
than copied from stale examples.

## Security and failure behavior

- External commands still require a loopback broker grant created only by the
  protected UI.
- Internal commands do not use that bearer and cannot read it.
- Agent authorization is enforced by controller policy, not help visibility.
- Shaper file reads stay inside its disposable virtual filesystem.
- Command output and errors are bounded and redacted before formatting.
- Queue saturation, deadline expiry, closed runtime, policy denial, stale
  sequence, and controller rejection are distinct typed failures.
- A failed virtual command cannot stop the shell worker or corrupt the accepted
  interface.
- A broken AXI formatter cannot replace the compiled recovery shell.
- Safe mode and deterministic rollback remain available without Pi, the CLI,
  MCP, or a model provider.
- Extension loading cannot add commands, broaden role policy, replace the
  reserved command, or mutate the command parser in this slice.

## Migration

Implementation proceeds without a compatibility period for the separate
binary names because no public release contract has yet established them.

1. Add the shared AXI program, output schemas, and broker gateway while current
   CLI tests remain as behavioral characterization.
2. Replace toggle-shaped public mutations with explicit set semantics in the
   shared command contract.
3. Add `AgentCommandSource`, role policy, `AgentCommandBus`, and its scoped
   controller bridge.
4. Add the reserved sandbox `flect` command and verify App/Shaper authority.
5. Move Shaper proposal completion to `flect interface propose`, retaining the
   old Pi tool until parity tests pass.
6. Add native dispatch through the public Tauri executable.
7. Move MCP behind `flect mcp`.
8. Remove compiled `flectctl` and `flect-mcp` binaries and update packaging.
9. Add opt-in agent setup and generated Skill support.
10. Update implemented architecture, trust, contributor, control, README, and
    release documentation only after their claims pass verification.

## Test strategy

All behavior changes start with failing observable tests.

### Unit and Effect integration

- strict parsing for every command and command-local flag set;
- unknown flags, missing values, removed names, and renamed-name hints;
- stable TOON projections, JSON compatibility, truncation, totals, empty
  states, suggestions, stdout/stderr separation, and exit codes;
- idempotent state-setting behavior and controller deduplication;
- source decoding, source attribution, and the complete role policy matrix;
- queue capacity, exact `Deferred` completion, timeout, interruption, and
  scoped shutdown using Effect test services where time is involved;
- re-entrant Shaper proposal and App action child operations; and
- broker and in-process gateway parity for the same authorized command.

Tests use `@effect/vitest` and test Layers. They assert exported behavior, not
implementation-source strings.

### Browser integration

Real Chromium tests prove that:

- `flect` with no arguments returns role-specific live state inside both role
  sandboxes;
- a Shaper can inspect, validate, and propose a candidate through Bash;
- the preview appears reactively in the same open UI;
- the Shaper cannot accept its own proposal or enter safe mode;
- App Agent can list and invoke a permitted action;
- App Agent cannot shape or modify revision state;
- neither role can spoof authority through environment variables, files,
  aliases, functions, or command arguments;
- TOON output composes with supported Bash pipes and redirection; and
- cancellation, queue closure, and command failures stay visible and bounded.

### Native and release integration

- Rust tests cover graphical, AXI, and MCP mode selection without constructing
  a WebView for command modes.
- A release-mode app bundle is built and launched.
- The public `flect` executable shows its AXI home view, inspects state, submits
  a shaping instruction, waits for completion, and reports the resulting
  proposal after control is enabled.
- `flect mcp` completes a real stdio initialize/list/call exchange.
- The bundle and packaged release contain `flect` and private
  `flect-runtime`, but no `flectctl` or `flect-mcp` executable.
- Tests confirm that no bearer, credentials, or raw dependency errors appear
  in stdout, logs, screenshots, or artifacts.

### Dogfood completion

Completion requires installing the newly built Flect application, opening it,
and using both the public native command and the embedded browser command to
operate the same visible workspace. Automated verification must pass before
that manual installed-app proof is reported.

## Documentation ownership

- This design owns the approved future behavior until implementation.
- `ARCHITECTURE.md` changes only after the corresponding behavior is verified.
- `docs/local-control.md` becomes the implemented `flect`, MCP, JSON/SSE, and
  setup reference.
- `docs/trust-model.md` owns the public role and command authority explanation.
- `CONTRIBUTING.md` owns development and verification commands.
- `AGENTS.md` receives concise durable rules requiring Effect and AXI for the
  command surface and pointing to the owning documents; it must not duplicate
  this workflow.
- `README.md` receives only the concise installation and first-use path with
  links to the full references.
- GitHub issues and the Flect GitHub Project own execution status after the
  design and plan are accepted.

## Acceptance criteria

- There is one public native executable named `flect`.
- No separately shipped `flectctl` or `flect-mcp` binary remains.
- Native, browser-sandbox, HTTP/SSE, and MCP adapters share one Effect command
  schema, authorization authority, state controller, and public projections.
- Default command output follows all ten AXI principles and valid TOON syntax.
- App Agent and Shaper can use the reserved `flect` command without host or
  network escape and cannot exceed their documented role authority.
- Guardian remains tool-free.
- Shaper proposals and App actions can be driven through Bash and become
  visible reactively in the same UI.
- Outside control remains disabled by default, explicit, local,
  authenticated, attributable, and immediately revocable.
- The generated agent Skill and optional session integrations cannot drift
  from the command's static guidance.
- Unit, Effect integration, real-browser, Rust, packaged-app, MCP, and release
  artifact verification pass.
- The built application is installed, opened, and dogfooded successfully.

## References

- [AXI principles](https://axi.md/)
- [AXI source and build guidance](https://github.com/kunchenguid/axi)
- [TOON specification](https://toonformat.dev/reference/spec)
- [TOON TypeScript API](https://toonformat.dev/reference/api)
- [Flect observable control design](2026-07-31-flect-observable-control-design.md)
- [Flect role-aware shell design](2026-07-31-flect-role-aware-shell-design.md)
- [Flect self-contained Shaper design](2026-07-30-flect-self-contained-shaper-design.md)
