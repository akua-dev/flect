# Chat Markdown verification

Date: 2026-07-31

## Verdict

Verified. Flect now renders the complete portable core of T3 Code's chat
Markdown experience while preserving Flect's Effect architecture, browser
portability, protected recovery shell, and role boundaries.

The implementation supports sanitized GFM, safe structural HTML, semantic
headings and lists, task lists, quotes, links, inline code, footnotes,
contained tables, and syntax-highlighted code blocks with title, copy, and
wrap controls. T3 Code's workspace, file, editor, preview, provider, toast, and
coding-specific integrations remain intentionally excluded.

## Source evidence

The implementation was derived from the actual local T3 Code source at commit
`d19039aeef6942e6eb204856c43b5354c0333e2d`, primarily:

- `apps/web/src/components/ChatMarkdown.tsx`
- `apps/web/src/index.css`
- `apps/web/src/markdown-list-indentation.ts`
- `apps/web/src/markdown-clipboard.ts`

Flect's approved design and implementation records are:

- `docs/superpowers/specs/2026-07-31-flect-chat-markdown-design.md`
- `docs/superpowers/plans/2026-07-31-flect-chat-markdown.md`

The renderer uses exact dependency versions:

| Package | Version | License |
|---|---:|---|
| `react-markdown` | 10.1.0 | MIT |
| `remark-gfm` | 4.0.1 | MIT |
| `remark-breaks` | 4.0.0 | MIT |
| `rehype-raw` | 7.0.0 | MIT |
| `rehype-sanitize` | 6.0.0 | MIT |
| `shiki` | 4.3.1 | MIT |

## Trust and failure boundaries

- Agent text is untrusted input.
- `rehype-raw` is followed by a closed `rehype-sanitize` schema.
- Scripts, styles, forms, frames, media, images, event handlers, and unsafe URL
  schemes do not enter the rendered tree.
- External links accept only `http`, `https`, and `mailto`; local fragments
  resolve inside their own message before the surrounding document.
- External links use `target="_blank"` with `rel="noopener noreferrer"`.
- Highlighted HTML is accepted only from the locally pinned Shiki highlighter
  after plain source text enters the Effect workflow.
- Clipboard writes cross the typed `Clipboard` Effect service and expose
  accessible local failure state.
- Streaming, parsing, and highlighter failures preserve escaped source text
  without removing the composer or protected recovery controls.
- Highlight cache growth is bounded to 100 entries and 5 MiB.

## Automated verification

A fresh `bun run check:all` completed successfully after the final production
change:

- Effect source checkout verified at
  `cccd029ae0124a33254b4094f1bc9c06cd43324e`
- Rifty dependency and license policy passed
- Biome checked 156 files with no findings
- TypeScript completed with no errors
- Vitest: 53 files passed and 1 intentionally skipped; 326 tests passed and 1
  intentionally skipped
- Playwright: 11 production-Chromium tests passed
- Rust: 8 desktop tests passed
- the Tauri release bundle built successfully

The new browser regression enters `Show the Markdown showcase` through the
public composer and verifies semantic structure, sanitation, link policy,
details, footnotes, lazy highlighting, source title, persistent wrap state,
exact code and table clipboard behavior, table expansion, compact geometry,
44 px actions, and a clean console.

## Real Chrome verification

The production Vite build and deterministic public runtime were inspected
directly in Chrome at 1440 × 1000 and 720 × 900.

At 1440 px:

- the agent rail was 400 px wide;
- assistant content, table, and code were each contained inside the rail;
- `document.documentElement.scrollWidth === 1440`;
- no inline script survived and `window.__flectUnsafeMarkdown` remained
  unset;
- the Effect link opened safely in a new context;
- details, table expansion, line wrapping, code copy, and Markdown table copy
  all exposed the expected accessible state.

At 720 px:

- the agent rail became a 720 px full-width surface;
- the table and code surfaces were each 688 px and remained internally
  contained;
- the document scroll width stayed exactly 720 px;
- every Markdown action measured 44 px high;
- Chrome reported no console messages; and
- all 12 production requests succeeded, including the lazily requested Shiki
  runtime, WebAssembly, TypeScript grammar, and theme.

Visual evidence:

- [Desktop Markdown](assets/2026-07-31-chat-markdown-desktop.png)
- [Compact Markdown](assets/2026-07-31-chat-markdown-compact.png)

## Build and installed application

The production build keeps Shiki outside the initial application chunk:

| Asset | Raw | Gzip |
|---|---:|---:|
| Main application JavaScript | 2,231.96 kB | 648.85 kB |
| Lazy Shiki browser bundle | 112.62 kB | 34.93 kB |
| Lazy Shiki WebAssembly | 622.32 kB | 232.09 kB |
| Lazy TypeScript grammar | 181.14 kB | 16.29 kB |
| Lazy GitHub dark theme | 14.43 kB | 3.12 kB |
| Application CSS | 24.88 kB | 5.67 kB |

The ad-hoc signed release bundle was installed at `/Applications/Flect.app`.
The previous installed copy was moved recoverably to
`~/.Trash/Flect.app.before-markdown-2026-07-31-1014`.

Installed smoke evidence:

- bundle version: `0.2.0`
- bundle identifier: `dev.akua.flect`
- `codesign --verify --deep --strict` passed
- the native 1180 × 781 window opened
- the private runtime started
- `GetRuntime` and `ListModels` were accepted
- both Effect RPC calls returned successful exits
- the app remained running and visible after verification

## Typography review

Two isolated reviews were reconciled before final styling: a visual hierarchy
assessment and a deterministic type-scale scan. Chat Markdown now uses the
existing system font, a 1 rem body, a 1.55 line height, compact fixed-rem
headings, a 0.65 rem block rhythm, a 70-character assistant measure, 0.875 rem
code, and 0.8125 rem table/details chrome.

The mechanical scan also found older non-Markdown pixel-sized typography in
the surrounding application. That existing drift is recorded as separate
design-system work rather than being silently expanded into this focused
renderer change.

## Follow-up boundary

The existing main application bundle remains large. The Markdown highlighter
is correctly lazy and Chrome fetched only the selected theme and grammar, but
a future performance pass can replace Shiki's broad web bundle with a smaller
custom language registry. That optimization should remain separate from
Markdown correctness and trust-boundary work.
