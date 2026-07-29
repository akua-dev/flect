# Flect repository development boundary

This file governs changes to the Flect repository. It grants no authority to
commit, push, publish, deploy, or mutate external systems.

Before changing Flect:

- Read `VISION.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, and the closest
  `AGENTS.md` covering the files in scope.
- Inspect the worktree and preserve unrelated or unfinished work.
- Keep changes inside the smallest component that owns the behavior.
- Use the approved design and implementation plan under
  `docs/superpowers/` for the initial MVP.

Repository-wide constraints:

- Keep Pi behind the local runtime boundary. Browser code must not import Pi,
  call model providers directly, or read provider credentials.
- Pi owns model/provider authentication. Do not add another credential file,
  copy secrets into Flect state, or expose them through APIs, logs, fixtures,
  screenshots, prompts, or generated artifacts.
- Bind local services to loopback. A change that exposes the runtime to a
  network requires a separately reviewed authentication and threat model.
- Keep the built-in launcher and safe-mode entry point independent from
  user-modifiable interface documents and extensions.
- Fail closed to the built-in launcher when customized interface state is
  invalid or unsupported.
- Pi tools are denied by default. Adding a tool or product capability requires
  an explicit, inspectable, revocable capability design.
- Do not execute agent-generated JavaScript or third-party extension code
  until a reviewed sandbox and recovery design exists.
- Keep runtime automation in TypeScript. Prefer native browser, Bun, Pi, and
  provider interfaces over repository-owned wrappers or shadow state.
- Test observable behavior through exported contracts, HTTP requests, and the
  rendered interface. Do not assert that source files contain selected text.
- Treat documentation as guidance, not proof that a boundary or lifecycle is
  implemented. Verify the code and fail closed where behavior is unproven.
- Never discard changes, rewrite history, commit, push, merge, publish, or
  mutate external systems unless the current task explicitly authorizes it.

When a rule is specific to one subtree, move it to that subtree's `AGENTS.md`
instead of expanding this file.
