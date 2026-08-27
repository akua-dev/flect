# Flect command and local control

Flect has one public command surface: `flect`. The installed macOS executable
opens the graphical app when launched by Finder and runs the agent-first
command program when invoked from a terminal. App Agent and Shaper receive the
same language as a reserved command inside their browser-portable Bash
sandboxes. MCP and JSON/SSE are adapters over that same Effect command and
workspace-controller authority.

## Start here

From a source checkout:

```bash
bun run flect --
bun run flect -- inspect
```

From an installed app:

```bash
/Applications/Flect.app/Contents/MacOS/flect
/Applications/Flect.app/Contents/MacOS/flect inspect
```

The no-argument result is content-first discovery for the live workspace, not
a static manual. Use `flect --help` for the command reference and a command's
trailing `--help` for local help. `flect app` opens or focuses the graphical
application.

Diagnostics can install the fixed user link `~/.local/bin/flect`, or the same
opt-in operation can be requested through the full bundle path:

```bash
/Applications/Flect.app/Contents/MacOS/flect setup shell install
flect setup shell remove
```

Flect never accepts an arbitrary link target, overwrites a regular file or
foreign symlink, copies a second executable, or requests administrator access.
It repairs only a stale link that points into another Flect app bundle.

## Output contract

Successful results and expected failures use stdout. Stderr is reserved for
optional progress and debug diagnostics. The default format is bounded TOON:

```bash
flect inspect
flect --json inspect
flect --full logs --limit 20
```

Global `--json` and `--full` flags precede the command. Without `--full`, long
strings are truncated with their original size and a recovery hint. The total
encoded result is capped. Exit `0` means success or an already-satisfied
idempotent operation, exit `1` means an operational or authorization failure,
and exit `2` means invalid usage. Errors remain structured and carry stable
codes such as `unauthorized`, `conflict`, `rejected`, `unavailable`, and
`unsupported`.

Commands are non-interactive and set-shaped: `target use`,
`trusted-extensions enable`, and `rail width` state the intended result rather
than toggling hidden state.
`mode set` remains a compatibility alias for older automation.
Use `--stdin` for native `prompt` or `shape` text that should not appear in
process arguments.

## Command reference

| Command | Result |
| --- | --- |
| `flect` | Bounded live discovery and relevant next commands. |
| `flect app` | Open or focus the graphical application. |
| `flect status` | Inspect local-control connectivity. |
| `flect inspect [--fields <list>]` | Read validated workspace state. |
| `flect logs [--limit <n>] [--role <app\|shaper>] [--operation <id>]` | Read bounded correlated evidence. |
| `flect watch [--after <sequence>]` | Wait for one newer workspace event. |
| `flect target <use\|shape>` | Select the visible protected workbench target. |
| `flect mode set <edit\|run>` | Compatibility alias for Shape or Use. |
| `flect prompt <text>\|--stdin` | Ask App Agent to use the accepted product. |
| `flect shape <text>\|--stdin` | Ask Shaper to prepare a proposal. |
| `flect cancel <app\|shaper>` | Stop the selected running agent turn. |
| `flect action list` | List actions projected from the visible interface. |
| `flect action inspect <node-id>` | Inspect one projected action. |
| `flect action invoke <node-id>` | Invoke one currently available action. |
| `flect product invoke <operation-id> [--input <json>]` | Invoke one registered, granted product operation and return its bounded JSON result. |
| `flect permissions list` | Read the reactive, payload-free product permission lifecycle. |
| `flect permissions revoke <decision-id>` | Revoke one visible decision; there is deliberately no grant command. |
| `flect interface inspect` | Read the visible interface document. |
| `flect interface schema` | Read the closed interface vocabulary. |
| `flect interface validate <path>` | Validate a Shaper sandbox file. |
| `flect interface propose <path>` | Submit a validated Shaper sandbox file. |
| `flect app validate <sandbox-dir> [--name <text>]` | Package and check authored web app source in Shaper's sandbox. |
| `flect app propose <sandbox-dir> [--name <text>]` | Submit packaged authored web app source as the running canvas. |
| `flect proposal accept\|reject` | Resolve the current preview. |
| `flect revision list\|rollback` | Inspect or roll back revision state. |
| `flect repository status` | Inspect canonical Git refs, candidate isolation, dirtiness, and conflicts. |
| `flect share list\|inspect [<share-id>]` | Inspect inactive review and retained share state. |
| `flect share open-url\|open-git\|reject\|export` | Route supported source and export operations through the protected sharing lifecycle. |
| `flect share checkpoint <share-id> --at <commit> ...` | In Shaper's embedded Bash only, checkpoint bounded sandbox files onto that exact guarded user fork. |
| `flect share resolve <share-id> --base <commit> --upstream <commit> --fork <commit> ...` | In Shaper's embedded Bash only, resolve every reviewed conflict path against the exact guarded lineage. |
| `flect model list` | List Pi-backed models. |
| `flect model select <provider/id\|auto>` | Select a model explicitly. |
| `flect model favorite <add\|remove> <provider/id>` | Set a favorite explicitly. |
| `flect extensions list` | Discover portable packages visible to the authenticated role and accepted/candidate binding. |
| `flect extensions describe <extension-id>` | Inspect bounded lifecycle, role, grant, version, digest, and provenance state without bundle source. |
| `flect extensions call <extension-id> [--input <json>]` | Invoke one enabled portable package through its role-owned QuickJS worker and capability broker. |
| `flect trusted-extensions <enable\|disable> <app\|shaper>` | Set explicitly trusted outside Pi extension loading for one role. The older `extensions enable\|disable` spelling remains a compatibility alias. |
| `flect safe enter\|restore` | Enter recovery or restore last-known-good state. |
| `flect rail collapse\|expand\|width <340-520>` | Set protected rail presentation. |
| `flect control status\|disable` | Inspect or revoke paired outside control. |
| `flect context --host <codex\|claude\|opencode>` | Emit bounded ambient agent guidance. |
| `flect setup status` | Inspect the shell link and agent integrations. |
| `flect setup shell install\|remove` | Manage only `~/.local/bin/flect`. |
| `flect setup agent install\|remove <host>` | Manage one ownership-marked context integration. |
| `flect mcp` | Serve the compact MCP adapter over stdio. |

Help visibility is not authorization. The trusted adapter supplies the caller
identity; flags, environment variables, aliases, functions, PATH entries,
workspace files, and model text cannot select or impersonate a role.

Portable extension discovery is deferred: a model receives no complete package
or tool catalog on every turn. Inside App Agent or Shaper Bash, the embedded
command fixes the role and accepted/candidate binding from the authenticated
tool call. Native callers follow the visible workbench target and binding.
Calls fail closed unless exactly one enabled package record matches. Package
activation, grants, pins, forks, update resolution, and removal remain
protected controller decisions and are not exposed as agent grant commands.

| Caller | Intended authority |
| --- | --- |
| Outside `flect` | Broad control only after the user enables Local control. It cannot enable control or grant product capabilities; it may inspect and revoke a visible product decision. |
| App Agent | Inspect the accepted product and permission lifecycle, list/inspect/invoke its visible actions, invoke registered product operations, and read bounded evidence. It cannot grant or revoke. |
| Shaper | Inspect schema/state and permission lifecycle, validate its own sandbox file, submit a preview proposal, checkpoint bounded files onto an exact retained share fork, and submit an exact reviewed conflict resolution. It cannot accept that proposal or change permissions. |
| Guardian | No Bash and no `flect` command. |

## Browser-hosted Flect

Flect remains usable in a normal browser. App Agent and Shaper run `flect`
inside their role-owned `just-bash` workspace, so no native executable or host
shell is required. The reserved command is registered under a hidden identity
after parsing, which prevents shadowing by an alias, function, PATH change, or
workspace executable.

The browser command supports workspace inspection, logs, interface shaping,
and role-authorized actions through an in-process bounded command bus. It does
not install shell links or host integrations, read files outside the role's
disposable `/workspace`, expose the control bearer, or provide embedded event
watching. Its default output remains pipeable and redirectable:

```sh
flect action list | grep available
flect product invoke projects.list --input '{"limit":2}'
flect interface schema | head
flect inspect > /workspace/state.toon
```

## Enable and revoke outside control

Outside control is off by default. Open **Diagnostics** and choose **Enable
local control**. Only the protected Flect shell can create the grant. Enabling
it creates a fresh 256-bit bearer and atomically publishes an owner-private
descriptor (`0700` directory, `0600` file):

- macOS: `~/Library/Application Support/Flect/control.json`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/flect/control.json`
- tests or custom hosts: `FLECT_CONTROL_STATE_DIR`

Use **Disable local control** or `flect control disable` to revoke it. Flect
removes the descriptor, invalidates the bearer, closes subscriptions, fails
queued requests, and clears visible client state without a restart. Never copy
the descriptor or put its bearer in a prompt, argument, log, fixture, or
artifact. The public clients discover it privately and never print it.

Every mutation receives a unique command ID. The underlying JSON API also
supports `expectedSequence`; a stale optimistic request returns a typed
conflict instead of mutating newer state.

## MCP

The public executable selects MCP mode explicitly:

```bash
flect mcp
```

Configure an MCP client with
`/Applications/Flect.app/Contents/MacOS/flect` and the single argument `mcp`.
The stdio server exposes four compact tools:

- `flect_inspect` reads the current non-secret workspace snapshot;
- `flect_command` accepts the exact closed `FlectCommand` schema;
- `flect_wait` waits for a live event and returns fresh state; and
- `flect_logs` returns bounded, redacted operation evidence.

The small tool count is deliberate. The command tool carries one schema union
instead of permanently loading hundreds of narrow model tools.

## Optional coding-agent context

Flect can install an ambient discovery hook for Codex, Claude Code, or
OpenCode:

```bash
flect setup agent install codex
flect setup agent install claude
flect setup agent install opencode
flect setup status
```

Codex and Claude receive bounded output from `flect context --host ...` at
session start/resume/clear/compact. OpenCode receives the same context once per
session and again after compaction through a dependency-free local plugin.
Install and removal are explicit, idempotent, atomic, and ownership-marked;
unrelated hooks and settings are preserved. Invalid JSON or an occupied
OpenCode plugin path is reported as a conflict and is never overwritten.

## JSON and SSE adapter

The private descriptor points to an ephemeral server on `127.0.0.1` and a
random port. All public routes require its exact bearer:

```text
GET  /v1/status
GET  /v1/instances
GET  /v1/workspaces/:workspaceId
GET  /v1/workspaces/:workspaceId/logs
GET  /v1/workspaces/:workspaceId/events?after=:sequence
POST /v1/workspaces/:workspaceId/commands
```

SSE accepts `after` or `Last-Event-ID` and emits schema-decoded monotonic
events. Command bodies are capped at one MiB and decoded as strict
`FlectCommandEnvelope`s. Unknown fields or tags, wrong workspace IDs,
self-enablement, invalid bounds, and missing authorization fail closed.

Use the public `flect` or MCP surfaces instead of hand-written bearer-bearing
HTTP. The lower-level client module exists for these adapters, not as a public
product surface.

## Evidence and host boundary

Flect retains at most 500 operation records and two MiB of encoded evidence in
memory. Records correlate workspace, command, operation, role, session, tool,
revision, and named outside-client IDs. Secret-shaped text is redacted. This
evidence helps users and agents debug the same reactive state; it is not a
second revision store or durable audit database.

Browser development registers the Vite client with the origin-restricted Bun
runtime. The packaged WebView registers through private Effect RPC and Tauri
with the broker in `flect-runtime`. Both publish through the same controller.
A static page without its approved local runtime cannot expose outside
control. Flect does not bind to a LAN, pair remotely, run an unattended daemon,
or keep a grant after its owning runtime exits.

See [`ARCHITECTURE.md`](../ARCHITECTURE.md) for implemented topology and
[`docs/trust-model.md`](trust-model.md) for the authority model.
