# Chat turn-folding verification — 2026-08-13

## Scope and result

- Pull request: [#39](https://github.com/akua-dev/flect/pull/39)
- Revision: working tree based on `fb20e26` on `codex/shadcn-ui-system`; the
  final commit and hosted gate are recorded in PR #39
- Host: Apple Silicon macOS, Bun 1.3.14, Playwright Chromium 151
- Scope: typed conversation-turn identity, persisted turn continuity,
  chronological Prompt → Work → Answer rendering, and compact historical turns
- Product-quality criteria reviewed: FQ-13, FQ-18, and FQ-19

Every new App Agent and Shaper operation now projects one typed operation ID
onto its prompt, tool activity, and final response. The same ID survives the
bounded continuity projection and restore path. The renderer therefore groups
work by the turn that caused it instead of guessing from adjacency or
timestamps.

Completed earlier turns fold their prompt and tool work behind one quiet
`Asked …` disclosure while leaving their final assistant response visible.
The latest turn remains expanded and follows the semantic order Prompt → Work
→ Answer, including while the assistant response is still streaming. Legacy
saved messages without a turn ID remain readable and are not assigned to a
guessed turn.

## Observable evidence

- Effect Schema and runtime tests prove that prompt, tool activity, and final
  response share one operation-backed turn ID and that consecutive operations
  receive distinct IDs.
- Continuity tests round-trip turn IDs through projection and restore.
- Rendered component tests prove an earlier prompt and its work are hidden by
  default, its final answer remains visible, expansion restores the context,
  and the latest typed turn renders Prompt → Work → Answer.
- A production-Chromium workflow completes two routed turns, observes the
  earlier `Asked …` disclosure, keeps the earlier final answer visible, opens
  the disclosure, and repeats the assertions after reload.
- The running native development app was inspected with the current hot-loaded
  shell for overlay containment. Its public `flect` command-line link is not
  installed and local control is disabled, so native turn submission was not
  claimed as evidence; no private runtime or storage path was used instead.

## Validation

- `bun run check` passed: Effect checkout and concurrency policy, generated
  Flect skill, quality coverage, Biome, TypeScript, and 911 Vitest tests passed
  with one intentional skip.
- The full production-Chromium run passed 92 of 93 workflows on its first run.
  The remaining existing warm-activation budget sampled 336 ms against its
  300 ms limit; its immediate isolated rerun passed at 239 ms (cold activation
  260 ms). All chat-turn workflows passed in both focused and full runs.
- `bun run check:rust` passed all 26 Rust tests.
- `bun run build:desktop -- --bundles app` produced an ad-hoc-signed macOS
  application successfully.

## Limitations

- This evidence does not replace the manual VoiceOver walkthrough, supported
  device matrix, Developer ID signing, notarization, or clean-machine checks
  owned by existing release issues.
- The exact pushed revision still requires the hosted `Flect quality gate`
  before merge.
