# Contributing to Flect

Flect is early. Changes should strengthen the small protected core rather than
prematurely expanding the platform.

## Requirements

- Bun 1.4 or newer
- A modern Chromium, Firefox, or Safari browser
- Pi authentication only for optional manual model smoke tests

## Setup

```bash
bun install
```

The `prepare` script clones the canonical Effect source at the exact version
used by Flect into the ignored `.repos/effect` directory. If needed, run it
directly:

```bash
bun run prepare
```

No model credential is required for unit tests, type-checking, linting, or the
production build.

## Development

```bash
bun run dev
```

This starts:

- the browser shell through Vite; and
- the Pi-backed runtime on `127.0.0.1:3210`.

Pi owns provider login and credentials. Authenticate through Pi's supported
login flow:

```bash
bunx pi
# Run /login inside Pi, then choose a provider.
```

Never add keys to this repository or browser storage.

## Verification

```bash
bun run check
bun run build
```

`check` runs Biome, TypeScript, and credential-free tests. A manual browser
smoke should cover the empty launcher, a streamed turn, cancellation,
`?safe=1`, and a compact viewport. A credentialed turn must never be recorded
in a fixture, screenshot, or log.

## Change expectations

- Start behavior changes with a failing test.
- Read `.agents/skills/effect-ts/SKILL.md` and its routed references for the
  Effect capability being changed.
- Search `.repos/effect` for current API signatures and tests instead of
  guessing from older Effect versions.
- Use Effect Schema, Services, Layers, Effects, Streams, scoped resources, and
  `@effect/vitest` at application boundaries.
- Keep all Effect packages aligned to the same exact version.
- Keep browser, runtime, and shared-contract responsibilities separate.
- Add public error messages deliberately; never forward raw provider errors.
- Test safe mode when changing interface document loading or shell startup.
- Update architecture or vision documents when a boundary changes.
- Preserve unrelated work and do not push or publish without current
  authorization.
