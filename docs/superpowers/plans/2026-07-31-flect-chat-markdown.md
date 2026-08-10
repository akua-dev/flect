# Flect Chat Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Flect's plain-text/fence splitter with a complete,
sanitized, T3Code-quality Markdown experience for browser and desktop chat.

**Architecture:** `react-markdown` owns CommonMark rendering, with GFM and
role-aware hard-break plugins followed by raw-HTML parsing and a closed
sanitizer. Focused Flect components own safe links, native details, contained
tables, and rich code blocks; clipboard access crosses an Effect service, and
syntax highlighting is a lazy, bounded Effect workflow with escaped fallback.

**Tech Stack:** React 19, Effect 4 beta, react-markdown 10.1.0, remark-gfm
4.0.1, remark-breaks 4.0.0, rehype-raw 7.0.0, rehype-sanitize 6.0.0, Shiki
4.3.1, Vitest/Testing Library, Playwright Chromium, Tauri 2.

## Global Constraints

- Preserve all existing uncommitted T3Code UX audit changes.
- Do not commit, push, publish, or release; the repository boundary does not
  authorize those operations.
- Treat every message as untrusted text.
- Keep T3Code's file, editor, preview, skill, provider, settings, toast, and
  local-API integrations out of Flect.
- Accept link schemes only for `http`, `https`, `mailto`, and local fragments.
- Do not add code execution, filesystem, storage, Pi, native, or network
  authority to Markdown.
- Clipboard writes use an Effect `Context.Service`, named `Layer`, and typed
  error.
- Keep Shiki outside the initial application chunk through dynamic import.
- Skip highlighting during streaming and preserve escaped code on every
  loading or failure path.
- Desktop controls stay dense; compact controls remain at least 44 px.
- Test observable DOM and behavior, not implementation-file strings.
- Run every production change through a witnessed RED/GREEN cycle.

---

### Task 1: Add and verify the Markdown dependency foundation

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**

- Consumes: current Bun/Vite React application.
- Produces: pinned imports for `react-markdown`, `remark-gfm`,
  `remark-breaks`, `rehype-raw`, `rehype-sanitize`, and `shiki`.

- [ ] **Step 1: Record the current dependency absence**

Run:

```bash
rg -n '"(react-markdown|remark-gfm|remark-breaks|rehype-raw|rehype-sanitize|shiki)"' package.json
```

Expected: no matches.

- [ ] **Step 2: Install exact current compatible releases**

Run:

```bash
bun add react-markdown@10.1.0 remark-gfm@4.0.1 remark-breaks@4.0.0 rehype-raw@7.0.0 rehype-sanitize@6.0.0 shiki@4.3.1
```

Expected: `package.json` and `bun.lock` contain the six exact versions.

- [ ] **Step 3: Verify licenses and the dependency graph**

Run:

```bash
bun pm ls | rg 'react-markdown|remark-gfm|remark-breaks|rehype-raw|rehype-sanitize|shiki'
npm view react-markdown@10.1.0 license
npm view remark-gfm@4.0.1 license
npm view remark-breaks@4.0.0 license
npm view rehype-raw@7.0.0 license
npm view rehype-sanitize@6.0.0 license
npm view shiki@4.3.1 license
```

Expected: all packages resolve and every license is MIT.

### Task 2: Put clipboard writes behind Effect

**Files:**

- Create: `src/lib/clipboard.ts`
- Create: `src/lib/clipboard.test.ts`
- Modify: `src/lib/runtime.ts`

**Interfaces:**

- Produces:

```ts
export class ClipboardWriteError extends Schema.TaggedErrorClass<ClipboardWriteError>()(
  "ClipboardWriteError",
  { message: Schema.Literal("Flect could not copy this content.") },
) {}

export class Clipboard extends Context.Service<
  Clipboard,
  {
    readonly writeText: (
      value: string,
    ) => Effect.Effect<void, ClipboardWriteError>;
  }
>()("Flect/Clipboard") {}

export const ClipboardLive: Layer.Layer<Clipboard>;
```

- [ ] **Step 1: Write failing service tests**

Create `src/lib/clipboard.test.ts` with tests that:

```ts
it.effect("writes text through the browser clipboard", () =>
  Effect.gen(function* () {
    const clipboard = yield* Clipboard;
    yield* clipboard.writeText("exact Markdown");
    expect(writeText).toHaveBeenCalledWith("exact Markdown");
  }).pipe(Effect.provide(ClipboardLive)),
);

it.effect("keeps clipboard rejection typed", () =>
  Effect.gen(function* () {
    const clipboard = yield* Clipboard;
    const exit = yield* Effect.exit(clipboard.writeText("blocked"));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(Cause.failureOption(exit.cause).pipe(Option.getOrThrow)._tag).toBe(
      "ClipboardWriteError",
    );
  }).pipe(Effect.provide(ClipboardLive)),
);
```

Use `vi.stubGlobal("navigator", ...)` or a configurable
`navigator.clipboard.writeText` property, restoring it after every test.

- [ ] **Step 2: Run the tests and witness RED**

Run:

```bash
bunx vitest run src/lib/clipboard.test.ts
```

Expected: FAIL because `src/lib/clipboard.ts` does not exist.

- [ ] **Step 3: Implement the service and live layer**

Implement `ClipboardLive` with:

```ts
const unavailable = () =>
  ClipboardWriteError.make({
    message: "Flect could not copy this content.",
  });

export const ClipboardLive = Layer.succeed(Clipboard)({
  writeText: Effect.fn("Flect.Clipboard.writeText")((value: string) =>
    Effect.tryPromise({
      try: () => {
        if (globalThis.navigator?.clipboard?.writeText === undefined) {
          return Promise.reject(new Error("Clipboard API unavailable"));
        }
        return globalThis.navigator.clipboard.writeText(value);
      },
      catch: unavailable,
    }),
  ),
});
```

Merge `ClipboardLive` into `BrowserLive` and add `Clipboard` to
`FlectBrowserServices`.

- [ ] **Step 4: Run the service tests and typecheck**

Run:

```bash
bunx vitest run src/lib/clipboard.test.ts
bun run typecheck
```

Expected: both commands exit 0.

### Task 3: Implement pure Markdown policies and serializers

**Files:**

- Create: `src/components/markdown-policy.ts`
- Create: `src/components/markdown-policy.test.ts`
- Create: `src/components/markdown-table-serialization.ts`
- Create: `src/components/markdown-table-serialization.test.ts`

**Interfaces:**

- Produces:

```ts
export const markdownUrlTransform: UrlTransform;
export const isExternalMarkdownHref: (href: string) => boolean;
export const normalizeSanitizedFragmentId: (id: string) => string;
export const extractFenceLanguage: (className?: string) => string;
export const extractFenceTitle: (meta?: string) => string | undefined;
export const serializeTableToMarkdown: (table: HTMLTableElement) => string;
export const serializeTableToCsv: (table: HTMLTableElement) => string;
```

- [ ] **Step 1: Write failing URL and fence-policy tests**

Cover:

```ts
expect(markdownUrlTransform("https://example.com")).toBe(
  "https://example.com",
);
expect(markdownUrlTransform("mailto:team@example.com")).toBe(
  "mailto:team@example.com",
);
expect(markdownUrlTransform("#summary")).toBe("#summary");
expect(markdownUrlTransform("javascript:alert(1)")).toBe("");
expect(markdownUrlTransform("data:text/html,boom")).toBe("");
expect(extractFenceLanguage("language-ts")).toBe("typescript");
expect(extractFenceTitle('title="src/app.ts"')).toBe("src/app.ts");
expect(extractFenceTitle("filename=server.ts")).toBe("server.ts");
```

Normalize common aliases: `js -> javascript`, `ts -> typescript`,
`sh -> shell`, `bash -> shell`, `yml -> yaml`, `md -> markdown`,
`text/plaintext/txt -> text`, and `gitignore -> ini`.

- [ ] **Step 2: Write failing table-serialization tests**

Create a real DOM table and assert:

```ts
expect(serializeTableToMarkdown(table)).toBe(
  "| Name | Note |\\n| --- | --- |\\n| Flect | A \\\\| B |",
);
expect(serializeTableToCsv(table)).toBe(
  "Name,Note\\r\\nFlect,A | B",
);
```

Add a separate row containing `A, B` and assert that CSV quotes it. Also cover
quotes, newlines, empty cells, pipes, and header-only tables.

- [ ] **Step 3: Run policy tests and witness RED**

Run:

```bash
bunx vitest run src/components/markdown-policy.test.ts src/components/markdown-table-serialization.test.ts
```

Expected: FAIL because both implementation modules are absent.

- [ ] **Step 4: Implement minimal pure policies**

Use `react-markdown`'s `defaultUrlTransform` only after the explicit
allow-list has accepted a URL. Return an empty string for relative paths,
protocol-relative URLs, `file:`, `data:`, `javascript:`, and unknown schemes.

Implement serializers by reading `table.rows` and `row.cells`, normalizing
whitespace, escaping pipes/backslashes for Markdown, and applying RFC-style
double-quote escaping for CSV fields containing comma, quote, CR, or LF.

- [ ] **Step 5: Run policy tests GREEN**

Run:

```bash
bunx vitest run src/components/markdown-policy.test.ts src/components/markdown-table-serialization.test.ts
```

Expected: all tests pass.

### Task 4: Build the sanitized semantic renderer

**Files:**

- Replace: `src/components/message-content.tsx`
- Create: `src/components/message-content.test.tsx`

**Interfaces:**

- Consumes: Task 3 URL/fence policy.
- Produces:

```ts
export interface MessageContentProps {
  readonly content: string;
  readonly messageRole: "user" | "assistant" | "activity";
  readonly streaming?: boolean;
}

export function MessageContent(props: MessageContentProps): ReactElement;
```

- [ ] **Step 1: Write failing semantic rendering tests**

Render one assistant message containing:

```md
# Release notes

**Strong**, *emphasis*, ~~removed~~, and `inline()`.

> A quoted decision.

1. First
2. Second

- [x] Complete
- [ ] Remaining

A footnote.[^1]

[^1]: Supporting detail.
```

Assert semantic roles/tags: level-one heading, strong/em/del, blockquote,
ordered list, disabled checked/unchecked checkboxes, inline code, footnote
link, and no literal Markdown markers.

- [ ] **Step 2: Write failing role-aware line-break tests**

Assert `line one\nline two` produces a `<br>` for `messageRole="user"` and
remains one normal paragraph for `messageRole="assistant"`.

- [ ] **Step 3: Write failing sanitizer and safe-link tests**

Render:

```md
<script>window.__unsafe = true</script>
<span onclick="window.__unsafe = true" style="color:red">Safe text</span>
[unsafe](javascript:alert(1))
[safe](https://example.com/docs)
<details open><summary>More</summary>Safe detail</details>
```

Assert:

- no `script`, `style`, `onclick`, iframe, object, form, media, or image node;
- “Safe text” and “Safe detail” remain;
- unsafe link has no actionable href;
- safe link has `target="_blank"` and `rel="noopener noreferrer"`;
- details and summary remain semantic and keyboard-native.

- [ ] **Step 4: Run renderer tests and witness RED**

Run:

```bash
bunx vitest run src/components/message-content.test.tsx
```

Expected: FAIL because the existing fence splitter cannot render semantics.

- [ ] **Step 5: Implement the Markdown pipeline**

Use:

```tsx
const REMARK_PLUGINS = [remarkGfm, remarkPreserveCodeMeta];
const REMARK_PLUGINS_WITH_BREAKS = [
  remarkGfm,
  remarkBreaks,
  remarkPreserveCodeMeta,
];
const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, FLECT_MARKDOWN_SANITIZE_SCHEMA],
];
```

Build `FLECT_MARKDOWN_SANITIZE_SCHEMA` from `defaultSchema`, explicitly adding
only `details`, `summary`, code metadata, `open`, GFM task-list class names,
and footnote identifiers. Remove `img`, form/media/embed tags, `style`,
`title`, and all event-like attributes.

Use custom `a`, `details`, `code`, `pre`, and `table` components. At this task,
`pre` and `table` may use semantic, contained plain fallbacks; Tasks 5 and 6
replace them with interactive components.

Wrap rendering in a class error boundary whose fallback is:

```tsx
<p className="message-content__fallback">{content}</p>
```

- [ ] **Step 6: Run semantic tests GREEN**

Run:

```bash
bunx vitest run src/components/message-content.test.tsx
bun run typecheck
```

Expected: all tests and typecheck pass.

### Task 5: Add lazy, bounded syntax highlighting and rich code blocks

**Files:**

- Create: `src/components/markdown-highlighter.ts`
- Create: `src/components/markdown-highlighter.test.ts`
- Create: `src/components/markdown-code-block.tsx`
- Create: `src/components/markdown-code-block.test.tsx`
- Modify: `src/components/message-content.tsx`
- Modify: `src/components/icons.tsx`

**Interfaces:**

- Produces:

```ts
export class MarkdownHighlightError extends Schema.TaggedErrorClass<MarkdownHighlightError>()(
  "MarkdownHighlightError",
  { language: Schema.String },
) {}

export const highlightMarkdownCode: (
  code: string,
  language: string,
) => Effect.Effect<string, MarkdownHighlightError>;

export interface MarkdownCodeBlockProps {
  readonly code: string;
  readonly language: string;
  readonly title?: string;
  readonly streaming: boolean;
}
```

- [ ] **Step 1: Write failing highlighter tests**

Assert JavaScript output includes a Shiki `<pre>` and escaped highlighted
source, unsupported languages fall back to `text`, repeated source returns
the cached result, and more than the configured cache limit evicts the oldest
entry. Expose only a test reset/introspection helper under an explicit
`__markdownHighlightTest` export.

- [ ] **Step 2: Write failing code-block interaction tests**

Provide this Markdown fixture:

````md
```ts title="src/app.ts"
const answer: number = 42
```
````

Assert:

- header text is `src/app.ts`;
- the block exposes `data-language="typescript"`;
- source code is visible before highlighting;
- `Wrap lines` toggles to `Disable line wrap` and `aria-pressed=true`;
- `Copy code` writes the exact source through `Clipboard`;
- success becomes `Copied`;
- failure becomes `Copy failed` in an `aria-live` status;
- `streaming` keeps plain code and does not render `.shiki`.

- [ ] **Step 3: Run highlighter/code tests and witness RED**

Run:

```bash
bunx vitest run src/components/markdown-highlighter.test.ts src/components/markdown-code-block.test.tsx
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the bounded Effect highlighter**

Use `Effect.tryPromise` around a dynamic:

```ts
const loadShiki = () => import("shiki/bundle/web");
```

Call the module's cached `codeToHtml` shorthand with
`theme: "github-dark-default"`. Retry once with `lang: "text"` after an
unsupported language. Bound Flect's HTML-result cache to 100 entries and
5 MiB by evicting oldest insertion-order entries.

- [ ] **Step 5: Implement `MarkdownCodeBlock`**

Keep code source in React text while highlighting is loading. Start the
highlighter Effect only when `streaming === false`; own its fiber and interrupt
it from the effect cleanup. Insert only locally generated Shiki HTML.

Copy by yielding `Clipboard` inside a named Effect and running it through
`browserRuntime` at the event boundary. Use local `idle | copied | failed`
state, reset acknowledgement after 1.2 seconds, and clear timers on unmount.

Add `CopyIcon`, `CheckIcon`, and `WrapIcon` to `icons.tsx`.

- [ ] **Step 6: Run code tests GREEN**

Run:

```bash
bunx vitest run src/components/markdown-highlighter.test.ts src/components/markdown-code-block.test.tsx src/components/message-content.test.tsx
bun run typecheck
```

Expected: all tests and typecheck pass.

### Task 6: Add contained, copyable tables

**Files:**

- Create: `src/components/markdown-table.tsx`
- Create: `src/components/markdown-table.test.tsx`
- Modify: `src/components/message-content.tsx`
- Modify: `src/components/icons.tsx`

**Interfaces:**

- Consumes: Task 2 Clipboard, Task 3 serializers.
- Produces:

```ts
export function MarkdownTable(
  props: React.ComponentProps<"table">,
): ReactElement;
```

- [ ] **Step 1: Write failing table interaction tests**

Render a GFM table and assert:

- semantic table, row, columnheader, and cell roles;
- wrapper starts with `data-expanded="false"`;
- `Expand table cells` toggles to `Collapse table cells`;
- Copy Markdown writes the exact normalized Markdown table;
- Copy CSV writes CRLF CSV with correct quoting;
- copy success/failure is announced;
- Escape or focus behavior is not hijacked by the table.

- [ ] **Step 2: Run table tests and witness RED**

Run:

```bash
bunx vitest run src/components/markdown-table.test.tsx
```

Expected: FAIL because `MarkdownTable` does not exist.

- [ ] **Step 3: Implement the table surface**

Use one horizontally scrollable viewport containing the table and a footer
with `Expand table cells`, `Copy table as Markdown`, and
`Copy table as CSV` buttons. Run clipboard Effects through `browserRuntime`;
do not introduce a menu dependency or T3Code's toast system.

Add `ExpandIcon` and `CollapseIcon` to `icons.tsx`.

- [ ] **Step 4: Run table and renderer tests GREEN**

Run:

```bash
bunx vitest run src/components/markdown-table.test.tsx src/components/message-content.test.tsx
bun run typecheck
```

Expected: all tests and typecheck pass.

### Task 7: Integrate role and streaming state into the protected rail

**Files:**

- Modify: `src/components/agent-rail.tsx`
- Modify: `src/components/agent-rail.test.tsx`

**Interfaces:**

- Consumes: `MessageContentProps` from Task 4.
- Produces: the latest active assistant message receives
  `streaming={true}`, and every message receives its actual role.

- [ ] **Step 1: Write failing rail integration tests**

Add an assistant fixture with Markdown and assert it renders a semantic
heading. Render the controller with `status="streaming"` and assert the latest
assistant code block remains plain; render `status="ready"` and wait for its
highlighted state.

- [ ] **Step 2: Run rail tests and witness RED**

Run:

```bash
bunx vitest run src/components/agent-rail.test.tsx
```

Expected: FAIL because `AgentRail` does not pass role/streaming props.

- [ ] **Step 3: Pass role and streaming state**

Render:

```tsx
<MessageContent
  content={message.content}
  messageRole={message.role}
  streaming={
    message.role === "assistant" &&
    isLatest &&
    status === "streaming"
  }
/>
```

- [ ] **Step 4: Run integration tests GREEN**

Run:

```bash
bunx vitest run src/components/agent-rail.test.tsx src/components/message-content.test.tsx
```

Expected: all tests pass.

### Task 8: Apply T3Code-quality Flect typography and responsive containment

**Files:**

- Modify: `src/styles.css`
- Modify: `tests/e2e/flect.spec.ts`
- Modify: `server/test-runtime.ts`

**Interfaces:**

- Consumes: semantic classes from Tasks 4–7.
- Produces: production-browser visual and geometry evidence.

- [ ] **Step 1: Add the deterministic Markdown showcase**

Make `FlectTestRuntimeLive.prompt(sessionId, text)` return a representative
Markdown delta when `text === "Show the Markdown showcase"`; preserve the
existing deterministic response for every other prompt.

The showcase must contain a heading, paragraph emphasis, quote, task list,
safe link, details, footnote, table, inline code, and titled TypeScript fence.

- [ ] **Step 2: Write failing production-Chromium assertions**

Add an E2E flow that enters Run, sends the showcase prompt, and verifies:

- heading, quote, task checkbox, details, link, table, and code block appear;
- external link safety attributes are present;
- code highlighting completes;
- wrap and table expansion work;
- copy buttons acknowledge success;
- at 720 × 780, `.role-shell` and document scroll widths equal viewport width;
- code/table inner viewports own any horizontal overflow;
- all Markdown chrome buttons meet 44 px at compact width; and
- no console errors are emitted.

- [ ] **Step 3: Run the E2E test and witness RED**

Run:

```bash
bunx playwright test tests/e2e/flect.spec.ts --grep "renders complete Markdown"
```

Expected: FAIL because the showcase and visual styles are not complete.

- [ ] **Step 4: Replace minimal message CSS with the Flect Markdown system**

Implement the spec's typography with:

- 0.65 rem block rhythm and zero outer first/last margins;
- compact 1.25/1.125/1/0.875 rem headings;
- nested list markers and 0.25 rem list-item rhythm;
- disabled task-checkbox alignment;
- rose interaction links with visible keyboard focus;
- two-pixel blockquote rule;
- quiet bordered inline-code chip;
- contained code/table surfaces using existing tokens;
- code header/action styles and Shiki background bridge;
- table row separators, collapsed ellipsis, expanded wrapping;
- native details summary with a rotating chevron marker;
- thin internal scrollbars;
- 44 px Markdown action targets at `max-width: 760px`; and
- reduced-motion acknowledgement/disclosure behavior.

- [ ] **Step 5: Run focused browser tests GREEN**

Run:

```bash
bunx playwright test tests/e2e/flect.spec.ts --grep "renders complete Markdown"
bunx playwright test tests/e2e/flect.spec.ts --grep "compact breakpoints"
```

Expected: both tests pass.

### Task 9: Document evidence and run completion verification

**Files:**

- Create: `docs/verification/2026-07-31-chat-markdown-verification.md`
- Modify if behavior changed: `DESIGN.md`

**Interfaces:**

- Produces: reproducible source comparison, security evidence, test evidence,
  browser screenshots, and installed-app smoke evidence.

- [ ] **Step 1: Update the visible design-system owner**

Add a concise `Chat Markdown` section to `DESIGN.md` documenting only the
shipped visual contract: semantic rhythm, compact headings, code/table
instruments, token usage, and compact targets. Link to the design spec for
implementation detail rather than duplicating it.

- [ ] **Step 2: Run full static and automated verification**

Run:

```bash
bun run check:all
```

Expected: Effect preparation, Rifty verification, Biome, TypeScript, all
Vitest tests, all Playwright tests, Rust tests, and the macOS app build exit 0.

- [ ] **Step 3: Inspect the production build in real Chromium**

Start the deterministic runtime and Vite production preview, then use Chrome
to:

- render the Markdown showcase at desktop and compact widths;
- exercise details, wrap, table expansion, and copy;
- inspect accessibility roles and focus;
- confirm unsafe content is absent;
- capture desktop, code, table, and compact screenshots;
- inspect console and network errors; and
- record exact code/table/document overflow geometry.

- [ ] **Step 4: Rebuild, install, and smoke-test macOS**

Use the app bundle produced by `check:all`. Quit only Flect, move the current
`/Applications/Flect.app` to a timestamped recoverable Trash backup, install
the new bundle with `ditto`, verify its ad-hoc signature, launch it, confirm
the 1180 × 781 native window, and confirm the packaged frontend completes
`GetRuntime` and `ListModels` over the private Effect RPC bridge.

- [ ] **Step 5: Write the verification record**

Document:

- T3Code reference commit and adapted/excluded behavior;
- dependency versions and licenses;
- sanitizer and unsafe-link evidence;
- unit/E2E/Rust test counts;
- production bundle sizes and lazy Shiki chunk evidence;
- real-Chromium interaction and geometry results;
- installed bundle signature/window/RPC results; and
- any remaining non-blocking performance follow-up.

- [ ] **Step 6: Run final hygiene checks**

Run:

```bash
bun run lint
git diff --check
git status --short
```

Expected: lint and diff checks exit 0; status contains only intended,
uncommitted Flect changes.
