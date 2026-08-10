---
name: flect
description: Operate and inspect a running Flect interface through its bounded agent-first command surface. Use when an agent needs to inspect Flect state, read operation evidence, invoke visible actions, shape an interface, manage revisions or models, debug a Flect workspace, or configure explicit native Flect integrations.
---

# Flect

Use the public `flect` command. Treat it as the authoritative command surface for the running interface; do not drive React, storage, broker internals, or private runtime binaries directly.

## Start with discovery

1. Run `flect` with no arguments for content-first discovery and relevant next actions.
2. Run `flect inspect` only when more workspace detail is needed.
3. Run `flect action list` before invoking a product action.
4. Prefer default bounded TOON output. Add `--json` only for a consumer that requires JSON and `--full` only when complete authorized text is necessary.

## Respect authority

- App Agent uses the accepted product and its projected actions. It does not shape or accept revisions.
- Shaper changes interface candidates inside its disposable sandbox. Run `flect interface validate <path>` before `flect interface propose <path>`; proposal acceptance remains a user decision.
- Outside agents require the user's explicit local-control grant before live workspace operations become available.
- Help visibility is not authorization. Treat structured `unauthorized`, `conflict`, `rejected`, and `unavailable` results as definitive.

## Command map

| Command | Purpose | Intended caller |
| --- | --- | --- |
| `flect` | Show content-first live discovery and relevant next commands. | outside agent, App Agent, Shaper |
| `flect inspect [--fields <closed-list>]` | Inspect validated live workspace state. | outside agent, App Agent, Shaper |
| `flect logs [--limit <n>] [--role <app\|shaper>]` | Read bounded, correlated operation evidence. | outside agent, App Agent, Shaper |
| `flect watch [--after <sequence>]` | Wait for the next reactive workspace event. | outside agent, App Agent, Shaper |
| `flect target <use\|shape>` | Select the visible Use or Shape conversation explicitly. | outside agent, App Agent |
| `flect mode set <edit\|run>` | Compatibility alias for selecting Shape or Use. | outside agent, App Agent |
| `flect prompt <text>\|--stdin` | Ask App Agent to use the accepted product. | outside agent, App Agent |
| `flect shape <instruction>\|--stdin` | Ask Shaper to prepare a validated interface proposal. | outside agent, Shaper |
| `flect cancel <app\|shaper>` | Stop the selected running agent turn. | outside agent |
| `flect action list\|inspect\|invoke` | Discover and invoke actions projected by the visible interface. | outside agent, App Agent |
| `flect product invoke <operation-id> [--input <json>]` | Invoke a registered product operation without raw HTTP access. | outside agent, App Agent |
| `flect permissions list\|revoke <decision-id>` | Inspect product permission lifecycle or revoke a visible decision; grants remain protected UI decisions. | outside agent, App Agent, Shaper |
| `flect interface inspect\|schema\|validate\|propose` | Inspect or propose interface documents inside Shaper's sandbox. | Shaper |
| `flect proposal accept\|reject` | Resolve the current validated preview as a protected user decision. | outside agent, App Agent |
| `flect revision list\|rollback` | Inspect revision state or request deterministic rollback. | outside agent, App Agent |
| `flect repository status` | Inspect canonical Git refs, isolation, and conflict state. | outside agent, App Agent, Shaper |
| `flect share list\|inspect` | Inspect bounded inactive shared candidates and retained installations. | outside agent, App Agent, Shaper |
| `flect share open-url\|open-git\|reject\|export` | Route bounded shared-source actions through protected user review. | outside agent |
| `flect share checkpoint <share-id> --at <commit> --write <share-path> <sandbox-path> --message <text>` | Checkpoint bounded Shaper sandbox files onto an exact retained share fork. | Shaper |
| `flect share resolve <share-id> --base <commit> --upstream <commit> --fork <commit> --write <share-path> <sandbox-path> --message <text>` | Submit an exact bounded Shaper resolution for every reviewed shared conflict path. | Shaper |
| `flect model list\|select\|favorite` | Inspect and select Pi-backed models without exposing credentials. | outside agent, App Agent, Shaper |
| `flect extensions list\|describe\|call` | Discover and call enabled portable extensions for the current role and binding. | outside agent, App Agent, Shaper |
| `flect trusted-extensions enable\|disable <app\|shaper>` | Set opt-in loading for the selected Pi role's outside extensions. | outside agent, App Agent |
| `flect safe enter\|restore` | Enter compiled recovery or restore the last-known-good interface. | outside agent, App Agent |
| `flect rail collapse\|expand\|width <pixels>` | Set the protected agent rail presentation. | outside agent, App Agent |
| `flect control status\|disable` | Inspect or revoke explicitly granted outside control. | outside agent |
| `flect context --host <codex\|claude\|opencode>` | Emit bounded static guidance plus available live Flect context. | outside agent |
| `flect setup status` | Inspect the fixed shell link and opt-in agent integrations. | outside agent |
| `flect setup shell install\|remove` | Manage only ~/.local/bin/flect for the installed desktop app. | outside agent |
| `flect setup agent install\|remove <codex\|claude\|opencode>` | Manage one ownership-marked ambient context integration. | outside agent |
| `flect setup uninstall inspect\|prepare` | Inspect or remove only Flect-owned integrations before moving the app to Trash. | outside agent |
| `flect mcp` | Serve the compact MCP adapter over stdio. | outside agent |

## Keep the boundary safe

- Never request or print model credentials, the local-control capability, private runtime flags, or unbounded logs.
- Use explicit set-shaped commands instead of inventing toggles or raw payload escape hatches.
- Read the returned receipt and resulting workspace state before deciding whether another command is needed.
- Use `flect logs --limit 20` for bounded failure evidence and safe mode for deterministic recovery.
