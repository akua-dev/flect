# Embedded AXI verification

Date: 2026-07-31

## Verdict

Verified locally. Flect now exposes one agent-first command language through
the public `flect` application executable, the App Agent and Shaper browser
sandboxes, authenticated loopback control, and MCP. Every adapter reaches the
same Effect program and workspace-controller authority; there are no public
`flectctl` or `flect-mcp` companion binaries.

The installed application is the exact app carried by the staged DMG. It is
open at `/Applications/Flect.app`, its fixed shell link is installed at
`~/.local/bin/flect`, and only the public `flect` executable plus the private
`flect-runtime` implementation are present in the bundle.

## Implemented command topology

| Surface | Adapter | Shared authority |
| --- | --- | --- |
| Installed terminal command | Public `flect` launcher and private Bun runtime | Effect AXI program and workspace controller |
| Browser App Agent | Reserved role-bound `flect` command in `just-bash` | In-process Effect command bus |
| Browser Shaper | Reserved role-bound `flect` command in `just-bash` | In-process Effect command bus |
| Outside coding agent | Explicitly enabled loopback broker | Effect broker gateway |
| MCP client | `flect mcp` over stdio | The same Effect gateway, with four compact tools |

Default output is bounded TOON, with leading `--json` for machine-compatible
JSON. Native and browser commands use the same closed `FlectCommand` schema.
The App Agent and Shaper receive only their role-authorized subset; Guardian
remains tool-free.

## Regression evidence

- A Vite development transform test parses the transformed `src/app.tsx` as
  JavaScript. This caught and prevents the React-refresh `RefreshRuntime`
  identifier collision that previously produced a blank development page.
- macOS launch and every Dock reopen reveal and focus the main window.
- A shell-link launch canonicalizes the public executable before locating
  `flect-runtime`, so `~/.local/bin/flect` remains fully self-contained.
- The public launcher replaces itself with the private runtime on Unix. MCP
  negotiation probes therefore cannot orphan private sidecars when they close.
- Agent cancellation is represented as the typed `AgentTurnCancelled` Effect
  error rather than an `instanceof` branch or an unhandled fiber interrupt.
- Cancellation finalizes every running activity with exit code 130, a bounded
  cancellation log, duration, and completion timestamp before returning the
  role to ready.
- Failed commands retain a redacted public error while the bounded operation
  journal records the internal tagged failure class for diagnostics.
- Browser end-to-end tests cover the role-bound command, authority failures,
  proposal validation, visible product actions, streaming activity, outside
  control, and reader-controlled scrolling.

## Live dogfood evidence

The production-shaped browser UI was driven through the installed public
binary after Local control was explicitly enabled in Diagnostics:

- TOON and JSON `status`, `inspect`, and `logs` returned the same live
  `workspace-local-default` snapshot shown by the UI.
- App Agent used browser Bash to run exactly `sleep 30`.
- `/Applications/Flect.app/Contents/MacOS/flect --json cancel app` completed in
  0.37 seconds.
- The initiating `flect prompt` process immediately returned a structured
  `operation-failed` result instead of hanging.
- The live workspace returned to `ready`; its Bash activity became `failed`
  with exit code 130, `Command cancelled`, `bash: operation cancelled`, and a
  completion timestamp.
- MCP negotiated through the installed executable, exposed exactly
  `flect_inspect`, `flect_command`, `flect_wait`, and `flect_logs`, and read the
  ready live workspace while control was enabled.
- After MCP close, process inspection found no negotiation probe or orphaned
  runtime. Only the graphical app and its one owned private runtime remained.
- `flect setup shell install` installed the fixed link. The final
  `~/.local/bin/flect --json setup status` reported it as installed and left
  the Codex, Claude, and OpenCode context integrations absent, as expected for
  opt-in features.

Outside control is off in the final installed application. A final MCP smoke
still negotiated all four tools and returned the expected safe tool error for
`flect_inspect` while control was revoked.

## Fresh automated gate

`bun run check:all` completed successfully after the final product changes:

- Effect checkout verified at
  `cccd029ae0124a33254b4094f1bc9c06cd43324e`;
- Rifty dependency and MIT license policy passed;
- generated Flect Skill drift check passed;
- Biome checked 218 files with no findings;
- TypeScript project build passed;
- Vitest: 80 files passed and 1 intentionally skipped; 438 tests passed and 1
  intentionally skipped;
- Playwright: 17 production-Chromium scenarios passed;
- Rust: 18 tests passed; and
- the ad-hoc signed macOS application bundle built successfully.

`bun run release:verify` passed all three packaging tests. `git diff --check`
passed, and a source scan outside historical verification/design records found
no remaining `flectctl` or `flect-mcp` references.

## Release and installed application

Staged artifacts:

| Artifact | Size | Verification |
| --- | ---: | --- |
| `dist-release/Flect_0.2.0_aarch64.dmg` | 35,701,369 bytes | SHA-256 `a03c97743bc615210b34d61535895a24284cd34334035d58ba238ad33d7d6890` |
| `dist-release/Flect_0.2.0_aarch64.dmg.sha256` | 90 bytes | `shasum -a 256 -c` passed |
| `dist-release/flect-v0.2.0-demo.mp4` | 46,856 bytes | generated by the release pipeline |

The DMG verified and mounted successfully. Flect was copied from that exact
mounted image into `/Applications/Flect.app`; SHA-256 hashes of both installed
Mach-O arm64 executables exactly match the verified bundle copies.
`codesign --verify --deep --strict` passed for both the bundle and installed
application. The resulting process topology is one graphical `flect` process
and one owned `flect-runtime` process.

CoreGraphics reports the final native main window on screen at 1180 × 781,
positioned at `(166, 118)`, layer 0. The macOS session was locked during final
capture, so the login window prevented a meaningful pixel screenshot; this did
not prevent launch, code-signature, bundle-identity, process, command, MCP, or
window-server verification. The same production UI bundle passed all 17 real
Chromium scenarios immediately beforehand.

The prior installed app was retained recoverably at
`/Applications/Flect.app.backup-20260731-195505`.

## Delivery boundary

Verification was performed on branch `codex/flect-self-contained-shaper` at
base commit `32d20f5dcb82af6cd53db9188bb029dd0d4012e4`. Changes remain intentionally
uncommitted. No commit, push, merge, GitHub release, or publication occurred.
The local app is ad-hoc signed and not notarized because Apple distribution
credentials were not used.
