# Flect observable control design

Date: 2026-07-31

## Status

Implemented in the working tree through Robin's delegated design authority;
final repository and native-app verification remains pending.

### Implementation amendments

The following deliberately smaller version-one choices supersede conflicting
examples later in this design:

- external command requests wait for their exact terminal receipt; there is no
  `--no-wait` mode in version one;
- the public loopback API uses `/v1/status`, `/v1/instances`,
  `/v1/workspaces/:id`, and its `/events`, `/logs`, and `/commands` children;
- `flectctl watch [after-sequence]` is the event subscription; filtering and
  export remain client-side over the closed event/log values;
- MCP is a separate bundled `flect-mcp` stdio executable and source
  `bun run flect:mcp`, not a `flectctl mcp` subcommand;
- Diagnostics is one protected disclosure with control state, immediate
  enable/revoke, connected-client count, and the latest 20 operation records;
  richer filtering is available to authorized CLI/API/MCP readers rather than
  adding a second dense UI in this slice; and
- the broker may deliver multiple commands in scoped fibers so cancellation
  can reach an active turn, while the controller remains the serialized
  transition authority.

This design covers one connected correction:

- make Edit/Shaper reliably produce valid interface proposals;
- make agent and tool activity understandable while it happens;
- stop chat scrolling from taking control away from the user;
- retain actionable local diagnostic evidence; and
- let a paired outside agent operate the same live Flect workspace through a
  supported CLI and API.

The implementation must preserve the existing uncommitted T3 Code UX and
Markdown work. It must not commit, push, merge, publish, or release without
separate authorization.

## Evidence and problem statement

The installed `v0.2.0` application was reproduced with the instruction
`make a demo ui and show me`. The private runtime accepted `Shape` and returned
an Effect RPC exit, so the failure was not a missing runtime, provider login,
or transport.

An isolated turn using the same authenticated `openai-codex/gpt-5.3-codex-spark`
model produced syntactically valid JSON but not a valid `InterfaceDocument`.
The response:

- omitted the required `style` field from text nodes;
- invented unsupported button actions such as `run-demo`;
- gave `agent-panel` unsupported `children`; and
- omitted the panel's required `title`.

The current Shaper prompt lists node type names but does not give the model the
closed field and action schema. Flect then maps JSON extraction, JSON parsing,
document validation, provider, transport, and persistence failures to the same
generic message and closes the role session.

Tool activity is also intentionally lossy today. Every Bash request becomes
the sentence `Shaper used its sandbox.` after execution. The timeline does not
show the command, tool call lifecycle, result, duration, output, preview URL,
or reason for failure.

The browser does not contain an explicit conversation-follow policy. Native
scroll anchoring and streaming updates can keep moving the viewport even after
the user tries to inspect earlier content.

Finally, the current browser HTTP API owns Pi sessions only. The revision
journal, workspace phase, role selection, message state, shell execution, and
user decisions remain in the client. Calling the existing API cannot perform
the same operation as a user or make the open UI react.

## Product decisions

### Full local user-equivalent authority

When the user explicitly enables external control, a local paired client may
perform every semantic action available through the protected Flect shell.
This includes submitting App Agent and Shaper requests, invoking validated
interface actions, changing role and model, cancelling, accepting, rejecting,
rolling back, entering safe mode, and restoring the interface.

That authority is:

- local-only;
- disabled by default;
- authenticated with an ephemeral rotating capability token;
- attributable to a named client;
- visible in the same live workspace and operation journal;
- revocable without restarting Flect; and
- incapable of bypassing validation, capability grants, Pi role separation,
  revision transitions, or deterministic recovery.

This version does not expose remote control, LAN binding, cloud relay,
background unattended authority, or an unauthenticated fixed port.

### The open workspace remains authoritative

The first control implementation requires a connected Flect workspace. The
outside client does not edit browser storage, impersonate DOM input, or create
a shadow revision store.

The protected Effect workspace controller is the single command and state
authority. React and outside clients are adapters to it. A CLI may launch the
desktop app or open the browser workspace, but commands fail clearly when no
workspace is connected.

This preserves browser ownership and avoids a premature migration of the
revision journal into a daemon. Headless workspace ownership can be designed
later against the same public command and event contracts.

## Approaches considered

### 1. UI-authoritative Effect controller with a local broker

Selected.

All user and external actions enter one typed controller inside the connected
workspace. A lifecycle-bound broker in the local runtime authenticates outside
clients and forwards commands to that controller. The workspace publishes
state, results, and events back through the broker.

This approach gives browser and desktop the same behavior, makes external
actions immediately visible, preserves the existing revision authority, and
tests the real application rather than a parallel backend.

### 2. Move the entire workspace kernel into the Bun runtime

Rejected for this slice.

A runtime-owned journal would make headless control natural, but it requires
migrating interface storage, workspace preferences, shell execution, and
browser-only capabilities before the current reliability and observability
defects can be fixed. It also changes the verified recovery architecture more
than the requested outcome requires.

### 3. Drive the WebView or browser through CDP and accessibility automation

Rejected as a product interface.

Browser automation remains useful for end-to-end verification, but selectors,
coordinates, and synthesized input are not a stable public capability. They do
not provide typed state, reliable error handling, idempotency, attribution, or
portable browser/native semantics.

## Target topology

```text
                user controls              outside agent
                     |                           |
                     |                           +-- flectctl
                     |                           +-- JSON HTTP/SSE
                     |                           +-- MCP stdio adapter
                     |                                  |
                     v                                  v
              React adapters                  authenticated local broker
                     |                                  |
                     +---------------+------------------+
                                     |
                                     v
                          FlectWorkspaceController
                          Effect command/state authority
                                     |
              +----------------------+----------------------+
              |                      |                      |
              v                      v                      v
       AgentWorkspace          ShapingKernel        ShellPreferences
       App / Shaper Pi         revision journal     protected layout
              |                      |
              v                      v
       browser sandbox         validated renderer

              every command/result/state transition
                                     |
                                     v
                         bounded OperationJournal
                                     |
                      +--------------+--------------+
                      |                             |
                      v                             v
                Flect activity UI             logs/watch API
```

The local broker routes commands and subscriptions. It does not become a
second workspace authority and cannot mutate a revision by itself.

## One command and state machine

### `FlectWorkspaceController`

`FlectWorkspaceController` is a `Context.Service` provided by one named Layer at
the browser runtime composition edge. It depends on the existing typed
services rather than replacing them.

It exposes:

```ts
interface FlectWorkspaceControllerShape {
  readonly snapshot: Effect.Effect<FlectWorkspaceSnapshot>
  readonly changes: Stream.Stream<FlectWorkspaceSnapshot>
  readonly events: Stream.Stream<FlectWorkspaceEvent>
  readonly dispatch: (
    envelope: FlectCommandEnvelope
  ) => Effect.Effect<FlectCommandReceipt, FlectCommandError>
}
```

Long-running commands return an accepted receipt with an operation identifier.
Progress and terminal results appear through the event stream. `flectctl`
waits for a terminal event by default and can opt out with `--no-wait`.

The controller owns shared application behavior currently split between
`App`, `useAgentSession`, and shell callbacks:

- role/model/session lifecycle;
- App Agent and Shaper turns;
- browser sandbox requests and results;
- proposal, preview, accept, reject, rollback, and safe-mode transitions;
- selected protected shell mode and persisted shell preferences;
- validated interface action dispatch;
- external-control enablement and connected-client metadata; and
- operation/event attribution.

React may continue to own text selection, an unsent composer draft, open
disclosures, focus, hover, and scroll position. It must not own a second
revision, agent, command, or external-control state machine.

### Command envelope

Every command crosses an Effect Schema boundary:

```ts
{
  version: 1,
  commandId: string,
  workspaceId: string,
  source: {
    kind: "user" | "control",
    clientId?: string,
    clientName?: string
  },
  expectedSequence?: number,
  command: FlectCommand
}
```

`commandId` is idempotent within a bounded recent-command window.
`expectedSequence` provides optional optimistic concurrency for decisions such
as accepting a proposal. A stale command receives a typed conflict and the
current sequence; it is never silently applied.

### Command surface

The version-one union contains:

- `inspect`
- `set-mode`
- `set-rail-collapsed`
- `set-rail-width`
- `refresh-runtime`
- `select-model`
- `toggle-model-favorite`
- `toggle-external-extensions`
- `submit-app-prompt`
- `submit-shaper-instruction`
- `cancel-role`
- `invoke-interface-action`
- `accept-proposal`
- `reject-proposal`
- `rollback-revision`
- `enter-safe-mode`
- `restore-safe-mode`
- `enable-control`
- `disable-control`

`enable-control` is accepted only when `source.kind` is `user`. An outside
client cannot grant or expand its own authority; it may inspect control status
or revoke the currently enabled grant.

`invoke-interface-action` accepts a node identifier, not an arbitrary action
string. The controller resolves that identifier against the current validated
document and routes only its closed action through the existing protected
capability.

No command grants itself a product, native, network, filesystem, credential,
or extension capability.

### Observable snapshot

The schema-encoded control snapshot contains only state a paired user-
equivalent client may inspect:

- workspace identifier, sequence, phase, and active mode;
- current validated interface document;
- active, last-known-good, and proposal revision summaries;
- runtime and role statuses;
- non-secret model summaries and current selection;
- App and Shaper timelines;
- active and recently completed tool activities;
- protected shell preferences;
- external extension opt-in state;
- currently connected control clients; and
- the latest operation-log sequence.

It excludes Pi/provider credentials, raw provider payloads, private Pi session
objects, bearer tokens, browser storage handles, native process handles, and
unvalidated model output.

## Reliable Edit and schema-driven proposals

### `propose_interface` tool

Shaper receives a Flect-owned `propose_interface` tool in addition to its
existing sandboxed Bash tool.

The tool:

- uses an exact recursive TypeBox parameter schema matching the closed
  `InterfaceDocument` fields, node variants, action literals, and limits;
- is decoded again through the canonical Effect `InterfaceDocument` schema;
- stores one validated proposal in a prompt-scoped bridge;
- returns a short typed success result;
- uses `terminate: true`; and
- is described as the required final action for every shaping turn.

Provider-side tool schema validation improves generation reliability but does
not become a trust boundary. Effect validation remains authoritative.

The Shaper may use Bash and explicitly enabled external extensions before its
final proposal. Those tools cannot activate or persist the resulting document.

### Prompt contract

The Shaper system prompt and per-turn instruction state:

- use Bash only when it helps inspect or build disposable source;
- call `propose_interface` exactly once as the final action;
- use only fields and actions accepted by the tool schema;
- preserve stable node identifiers when possible; and
- never claim that a proposal has been accepted.

Flect no longer extracts a JSON substring from free-form assistant text as the
normal shaping path.

### One bounded recovery attempt

If the turn ends without one validated proposal, Flect issues one short
role-local correction explaining that the required proposal tool was not
successfully called. It does not repeat the original prompt or expose raw
validation input.

If the second attempt also lacks a valid proposal, the operation ends with a
typed `ShapeProposalFailed`. There is no unbounded model loop.

An invalid proposal is non-fatal to the role session. The user may retry with
the same Shaper context. Provider, transport, or corrupted-session failures may
still close and recreate the pair under the existing lifecycle rules.

### Actionable validation

Internal validation produces a bounded list of controlled issues:

```ts
{
  path: "root.children[2].action",
  code: "invalid_literal",
  message: "Use one of Flect's supported interface actions."
}
```

Issue codes are closed and messages are authored by Flect. At most 20 issues
cross the runtime boundary. Paths and messages are length-bounded.

The UI shows a concise explanation and a **Details** action. The activity log
and paired debug clients can inspect issue paths and codes. Raw model output,
provider errors, credentials, and arbitrary schema formatter strings are not
stored or exposed.

## Tool and activity experience

### Typed conversation items

Role timelines use a discriminated union rather than flattening every event
into a text message:

- `chat-message`
- `tool-activity`
- `operation-activity`

A tool activity contains:

- tool call identifier;
- role and operation identifier;
- Flect-authored label and tool name;
- bounded command or action summary where applicable;
- `queued`, `running`, `succeeded`, `failed`, or `cancelled` state;
- start and completion timestamps;
- duration;
- bounded exit code, stdout, stderr, and preview URL fields where applicable;
  and
- whether details are available.

Pi's `tool_execution_start`, `tool_execution_update`, and
`tool_execution_end` events update the same timeline item in place. Bash's
browser `shell_request` and result are correlated with the Pi tool call rather
than creating unrelated messages.

### Activity card

The timeline renders one quiet, inline instrument:

- spinner, check, failure, or cancel icon;
- `Bash`, `Interface proposal`, or extension-provided label;
- the first command line or concise action summary;
- elapsed or completed duration;
- an accessible disclosure for bounded output and validation details; and
- a direct preview link when the sandbox returned one.

It uses Flect's existing tonal surfaces and structural line. It does not become
a terminal-themed panel, bright progress dashboard, or permanent developer
console.

External commands add attributable operation items such as
`Codex requested Edit` or `Codex kept revision revision-4`. Attribution is
subdued but always available to assistive technology and diagnostics.

## Conversation following

Each role owns independent ephemeral scroll state.

- The viewport follows new content only while it is within 48 CSS pixels of
  the bottom.
- A wheel, pointer, touch, Page Up, or keyboard scroll that moves away from the
  bottom suspends following immediately.
- Reaching the bottom manually re-arms following.
- Streaming updates never override a suspended state.
- Switching roles restores that role's prior scroll offset and follow state.
- Browser scroll anchoring is disabled inside the conversation viewport so it
  cannot bypass the policy.
- When unseen items arrive, a protected **Jump to latest** control appears
  above the composer with a bounded unseen count and current activity state.
- Activating it moves to the bottom, clears the count, and re-arms following.
- Reduced-motion users receive an immediate scroll; other users receive one
  short smooth scroll only for that explicit action.

Focus does not move when messages, tool calls, logs, or external commands
arrive.

## Operation journal and diagnostics

### `OperationJournal`

`OperationJournal` is a `Context.Service` backed by Effect concurrency
primitives and provided once at the workspace runtime edge.

It exposes:

- `append`
- `snapshot`
- `changes`
- `entriesForOperation`

Entries are typed and contain:

- monotonic sequence;
- operation and correlation identifiers;
- timestamp and duration where terminal;
- source attribution;
- role;
- lifecycle phase;
- event kind;
- safe structured details; and
- severity.

The journal covers commands, agent lifecycle, tool lifecycle, proposal
validation, transport state, revision transitions, cancellation, recovery, and
control-client connections.

It is bounded to the newest 500 entries and 2 MiB of schema-encoded detail,
whichever limit is reached first. It is in-memory in this version and is not
written into the revision journal, browser local storage, Pi sessions, Git, or
application logs.

Expected workflows use Effect spans and structured log annotations in
addition to the user-facing journal. The journal is not a replacement for
Effect logging; it is the safe observable product contract.

### Redaction

The journal never accepts:

- provider tokens or authentication headers;
- pairing/control tokens;
- raw provider request or response objects;
- raw Shaper output;
- environment variables;
- filesystem handles;
- arbitrary process errors; or
- unlimited command output.

Sandbox commands and results are local user content. They may appear only in
the authenticated live timeline and in-memory journal, are truncated before
encoding, and are never included in ordinary server stderr or exported
automatically.

### Diagnostics UI

A protected Activity button in the agent header opens a keyboard-accessible
panel containing:

- current and recent operations;
- filters for role, tools, revisions, control clients, and failures;
- correlation identifiers with copy support;
- exact safe validation issue paths;
- connected outside clients and immediate revoke controls; and
- a bounded JSON export initiated explicitly by the user.

Failure banners link to the relevant operation rather than duplicating its
details.

## Local control broker

### Lifecycle

The browser Bun runtime and packaged Bun sidecar host the same
`FlectControlBroker` service.

External control is disabled by default. Enabling it:

1. creates a cryptographically random 256-bit bearer token;
2. starts or activates a random loopback listener;
3. writes one versioned discovery descriptor in the platform's user-only
   Flect state directory with directory mode `0700` and file mode `0600`;
4. registers the connected UI workspace; and
5. publishes a visible `control-enabled` event.

The descriptor contains only the protocol version, loopback URL, bearer token,
process identifier, broker instance identifier, and registered workspace
identifiers. It is the local capability grant and is never exposed through a
model-facing response.

Disabling control:

1. rejects new requests;
2. interrupts active subscriptions and pending external commands;
3. removes the descriptor;
4. rotates and forgets the token; and
5. publishes a visible `control-disabled` event.

Application exit performs the same cleanup through Effect scopes and
finalizers. Stale descriptors are rejected by process and instance checks and
removed during the next successful launch.

The token is never returned by inspection, logs, events, screenshots, error
messages, or model context.

### Browser workspace channel

In browser development, the same-origin UI establishes an authenticated
workspace channel to the Bun runtime. Privileged enable/register routes require
an approved browser origin; requests without `Origin` cannot impersonate the
UI.

The broker forwards an external command to that channel and waits for the
controller's typed receipt. State and events published by the UI satisfy
external inspection and subscriptions.

### Packaged desktop channel

The packaged sidecar hosts the loopback broker but keeps the UI connection on
the existing private Effect RPC stdio transport.

The shared RPC group gains:

- a streaming control-command subscription;
- command receipt/result completion;
- workspace state/event publication;
- control enable/disable; and
- client connection metadata.

Rust remains an opaque framed proxy and does not parse commands, state, bearer
tokens, prompts, or logs.

### Failure behavior

- no connected UI -> `workspace_unavailable`;
- disabled control -> connection refused or `control_disabled`;
- invalid/expired token -> `unauthorized`;
- stale sequence -> `state_conflict`;
- duplicate command ID -> original receipt/result;
- unsupported command version -> `unsupported_version`;
- command exceeds bounds -> `invalid_command`;
- UI disconnect during an operation -> typed interrupted terminal event;
- broker failure -> normal in-app user operation remains available.

External control cannot become a dependency of recovery, user clicks, Pi
provider access, or accepted interface rendering.

## Public JSON API

The authenticated loopback API is versioned under `/control/v1`.

Core routes:

- `GET /instances/current`
- `GET /workspaces`
- `GET /workspaces/:id/state`
- `GET /workspaces/:id/events` as SSE with `Last-Event-ID`
- `GET /workspaces/:id/logs`
- `POST /workspaces/:id/commands`
- `GET /operations/:id`
- `GET /operations/:id/events` as SSE
- `POST /control/revoke`
- `GET /schema`

All request, response, command, state, event, log, and error bodies derive from
shared Effect Schemas and reject excess properties.

The API sets `cache-control: no-store`, does not enable credentialed CORS, and
accepts bearer authentication only over loopback.

## CLI

The repository and application ship `flectctl`.

Developer use:

```bash
bun run flectctl -- inspect
```

Packaged use:

```bash
/Applications/Flect.app/Contents/MacOS/flectctl inspect
```

An explicit `flectctl install-shell` command may create or update a symlink in
the user's `~/.local/bin`; installation never mutates shell startup files or a
system directory automatically.

Primary commands:

```text
flectctl launch
flectctl instances
flectctl inspect [--json]
flectctl watch [--json]
flectctl logs [--follow] [--operation <id>] [--json]
flectctl mode <edit|run>
flectctl prompt <text>
flectctl shape <instruction>
flectctl invoke <node-id>
flectctl cancel <app|shaper>
flectctl models
flectctl model <provider/model>
flectctl model favorite <provider/model>
flectctl extensions <app|shaper> toggle
flectctl accept [--sequence <n>]
flectctl reject [--sequence <n>]
flectctl rollback [--sequence <n>]
flectctl safe-mode
flectctl restore
flectctl rail <open|closed|width>
flectctl control <disable|status>
flectctl command --json <encoded-command>
flectctl mcp
```

Enabling outside control is intentionally UI-only. `flectctl launch` opens
Flect so the user can enable the grant; no outside client can bootstrap its
own control authority.

Human output is concise. `--json` writes only schema-encoded values to stdout.
Diagnostics go to stderr. Exit codes distinguish success, invalid use,
unavailable workspace, authentication, conflict, operation failure, and
interruption.

Arguments containing prompts are supported for human use, but
`--stdin` is the documented agent-safe path so prompts and capability tokens do
not enter process listings.

## MCP adapter

`flectctl mcp` serves MCP over stdio without creating a second authority or
tool for every Flect action.

It exposes four bounded tools:

- `flect_inspect`
- `flect_command`
- `flect_wait`
- `flect_logs`

`flect_command` accepts the same closed `FlectCommand` union used by the API.
This keeps agent context small while preserving the full command surface.

The MCP adapter reads the protected discovery descriptor, never exposes its
token to the model, and returns only schema-encoded state, receipts, events,
and safe diagnostics.

## Reactive attribution

An outside command changes the same `SubscriptionRef` state observed by React.
There is no refresh requirement.

Examples:

- `flectctl mode edit` selects Edit and opens the protected rail;
- `flectctl shape ...` appends an attributed user instruction, streams tool
  cards, and renders the preview;
- `flectctl accept` updates the revision journal and canvas through the same
  transition as the button;
- `flectctl invoke node-id` routes the node's validated action and records its
  source;
- revoking a client updates the Activity panel immediately.

The UI displays an outside-submission origin separately from conversational
role. It never relabels an external agent as the user or as Pi.

## Packaging

The native build compiles and bundles:

- the existing `flect-runtime` sidecar;
- the `flectctl` executable; and
- the shared control schemas.

The CLI does not bundle provider credentials, start another Pi runtime, or
read the private sidecar stdio stream. It communicates only through the enabled
authenticated control listener.

The browser source build uses the same CLI against the local Bun runtime.
A static browser deployment remains usable without external control when
connected to its approved Flect runtime.

## Testing

### Test-driven implementation

Every behavior change begins with an observable failing test.

Unit and integration coverage includes:

- exact proposal-tool schema and Effect revalidation;
- successful proposal capture and terminating tool behavior;
- missing-tool bounded retry;
- safe validation issue mapping;
- invalid proposal preserving the Shaper session;
- Pi tool lifecycle correlation;
- tool activity state transitions and truncation;
- operation-journal ordering, bounds, redaction, and interruption;
- command idempotency and optimistic concurrency;
- user and external actions producing the same state transition;
- per-role follow state and unseen counts;
- explicit jump-to-latest and reduced motion;
- broker authentication, enable, revoke, cleanup, and descriptor permissions;
- browser and private-RPC workspace channels;
- API schema and SSE replay;
- CLI output and exit codes;
- MCP initialization and all four tool contracts; and
- no credential-shaped data entering encodable events, state, logs, or
  artifacts.

### Real browser

Production Chromium tests:

1. open a workspace and enable deterministic test control;
2. use `flectctl` or the public JSON API—not Playwright DOM input—to inspect,
   select Edit, and submit a shape instruction;
3. observe the attributed instruction and live tool card in the browser;
4. observe a valid preview;
5. accept through the external command and observe Run mode;
6. submit an App Agent prompt externally and observe streamed Markdown;
7. scroll away during streaming and prove the viewport is not moved;
8. use Jump to latest and prove following resumes;
9. inspect logs and correlate the command, tools, and revision;
10. revoke control and prove the CLI is rejected while the UI still works.

Separate browser tests continue to operate the actual UI controls so the
human path is not replaced by API-only coverage.

### Native

The release-mode macOS app is installed and launched with its private sidecar.
Verification uses the packaged `flectctl` to:

- discover the enabled running instance;
- inspect state;
- drive Edit and Run;
- observe the native UI update;
- stream operation events;
- revoke control; and
- confirm that the app remains usable afterward.

The attached native logs must show private RPC lifecycle without prompts,
tokens, raw tool output, or provider payloads.

## Documentation ownership

- this specification owns the reviewed future design until implementation;
- `shared/control.ts` becomes the executable command/event source of truth;
- `ARCHITECTURE.md` changes only after behavior is verified;
- `docs/control-api.md` owns the public protocol and CLI/MCP reference;
- `docs/trust-model.md` owns the implemented external-control threat model;
- `DESIGN.md` owns Activity card, diagnostics panel, and scrolling rules;
- `CONTRIBUTING.md` owns the development verification workflow;
- `README.md` receives only a concise external-control quick start and links;
  and
- executable follow-up work belongs in the Flect GitHub project after current
  authorization permits external mutation.

## Completion evidence

The work is complete only when all of the following are true:

- the reproduced real-model Edit instruction produces a validated preview or
  an exact safe diagnostic without a generic collapse;
- App and Shaper tool use is visible with lifecycle and bounded results;
- user scroll intent is preserved in streaming and external-command flows;
- the operation journal correlates commands, tool calls, validation, and
  revision terminal state;
- one typed controller owns both UI and external operations;
- authenticated local CLI, JSON/SSE, and MCP adapters exercise the full command
  set;
- browser and packaged desktop display external actions immediately;
- revocation terminates outside authority without harming in-app recovery;
- the full credential-free gate and authenticated Pi smoke pass;
- real Chrome and the installed native application are inspected;
- the verified application is left open; and
- no unauthorized commit, push, merge, publication, deployment, or release has
  occurred.
