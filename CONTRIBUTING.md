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
login flow; never add keys to this repository or browser storage.

## Verification

```bash
bun run check
bun run build
```

`check` runs Biome, TypeScript, and credential-free tests. Browser smoke tests
are added with the launcher milestone and run separately through Playwright.

## Change expectations

- Start behavior changes with a failing test.
- Keep browser, runtime, and shared-contract responsibilities separate.
- Add public error messages deliberately; never forward raw provider errors.
- Test safe mode when changing interface document loading or shell startup.
- Update architecture or vision documents when a boundary changes.
- Preserve unrelated work and do not push or publish without current
  authorization.
