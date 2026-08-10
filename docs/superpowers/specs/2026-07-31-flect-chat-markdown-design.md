# Flect chat Markdown design

Date: 2026-07-31

## Status

Approved for implementation by the active Flect Markdown goal.

## Purpose

Flect agent messages currently render plain paragraphs and triple-backtick
fences. This loses the hierarchy and utility of normal agent output: headings
look like source text, lists collapse into prose, links are not actionable,
tables are unreadable, and code lacks language context or controls.

Flect will adopt the full core Markdown experience demonstrated by the local
T3Code implementation while keeping Flect's product and trust boundaries. The
result should feel as carefully typeset and useful as T3Code without importing
its editor, workspace, file-link, provider-skill, preview, or toast systems.

## Source reference

The implementation reference is the local T3Code checkout at commit
`d19039aeef6942e6eb204856c43b5354c0333e2d`, primarily:

- `apps/web/src/components/ChatMarkdown.tsx`
- `apps/web/src/index.css`
- `apps/web/src/markdown-list-indentation.ts`
- `apps/web/src/markdown-clipboard.ts`

Flect adapts patterns and observable behavior rather than copying the
T3Code component wholesale. T3Code-specific file and editor behavior is not a
Flect capability.

## Approaches considered

### 1. Copy T3Code's complete `ChatMarkdown`

This would maximize superficial parity, but the component is coupled to
T3Code's workspace, editor, file preview, skills, local API, settings, theme,
toast, and provider types. Pulling those assumptions into Flect would weaken
its capability boundaries and create a second product architecture.

### 2. Adapt the core renderer into Flect-native components

This is the selected approach. Use the same Markdown foundation and interaction
model, then implement only the portable rendering behaviors behind Flect's
existing tokens and platform boundaries.

### 3. Extend the existing hand-written fence splitter

This would minimize dependencies but require Flect to create and maintain a
Markdown parser, sanitizer, table serializer, and syntax renderer. It would
remain incomplete and less secure than established libraries.

## Rendering architecture

`MessageContent` remains a React rendering boundary. It accepts untrusted agent
text plus the message role and streaming state, then renders a sanitized
Markdown tree.

The core pipeline is:

```text
untrusted message text
        |
        v
react-markdown + remark-gfm
        |
        +-- user/activity role: remark-breaks
        |
        +-- fenced-code metadata preservation
        |
        v
rehype-raw -> rehype-sanitize with a closed schema
        |
        v
Flect Markdown React components
        |
        +-- safe link
        +-- details
        +-- table
        +-- inline code
        +-- rich code block
        |
        v
Flect design tokens and protected conversation rail
```

Assistant messages use normal CommonMark paragraph behavior. User and activity
messages preserve single newlines as chat-style hard breaks.

The renderer does not parse commands, grant capabilities, execute code, read
files, call providers, or alter interface documents. It is presentation only.

## Supported Markdown

The first complete implementation supports:

- paragraphs and hard breaks where role-appropriate;
- emphasis, strong text, deletions, and thematic rules;
- headings levels one through six;
- nested ordered and unordered lists;
- read-only GFM task lists;
- blockquotes;
- safe external links and local document fragments;
- inline code;
- fenced code with language and optional `title`, `file`, or `filename`
  metadata;
- GFM tables;
- footnotes;
- sanitized inline HTML needed for `<details>`, `<summary>`, and ordinary
  structural text; and
- incomplete fenced code while an agent turn is streaming.

Images are not accepted by the initial sanitizer. This avoids both remote
fetches and ambiguous local/data URL authority in model-authored output.

## Security and trust

Markdown is untrusted model output.

- Raw HTML is parsed only so a closed sanitizer can retain approved structural
  elements such as `details` and `summary`.
- Scripts, styles, iframes, objects, forms, media, event handlers, arbitrary
  attributes, and unsafe URL schemes are removed.
- Links accept only `http`, `https`, `mailto`, and local fragments. External
  links open in a new browsing context with `noopener noreferrer`.
- The renderer does not use unsanitized `dangerouslySetInnerHTML`.
- Syntax-highlighted HTML may be inserted only when produced locally by the
  pinned highlighter from plain code text. If highlighting fails, escaped
  plain code remains visible.
- Clipboard writes enter through a typed Effect platform capability. React
  owns copied/wrapped/expanded presentation state, but does not become an
  alternate application architecture.
- No Markdown behavior receives Pi credentials, shell access, Flect storage,
  interface-shaping authority, native APIs, or network authority.

## Code blocks

A fenced code block renders as one compact instrument:

- header with filename when supplied, otherwise normalized language;
- copy button with an accessible copied acknowledgement;
- wrap toggle with `aria-pressed`;
- syntax highlighting loaded lazily and cached by code, language, and theme;
- plain escaped code while streaming, loading, or after a highlighting error;
- horizontal scrolling by default and readable wrapping when enabled; and
- thin, unobtrusive scrollbars that do not affect document width.

The highlighter is not loaded for conversations that never contain fenced
code. Cache size and memory are bounded. Unsupported languages fall back to
plain text.

## Tables

Tables render inside a horizontally contained surface:

- row separators and quiet headers rather than a dense boxed spreadsheet;
- collapsed cells by default so arbitrary content cannot expand the rail;
- an expand/collapse control for wrapping cell content;
- Copy as Markdown and Copy as CSV actions;
- keyboard-accessible controls with visible focus;
- correct escaping for Markdown and CSV serialization; and
- no page or rail-level horizontal overflow.

## Links and details

External links are visibly links, break safely across narrow rails, and expose
their destination without downloading remote favicons. Fragment links scroll
only to matching identifiers inside the rendered Markdown before falling back
to the current document.

`details` is rendered as a controlled, keyboard-native disclosure with a clear
summary and subdued nested content. Unsupported or malformed raw HTML is
sanitized into inert content.

## Visual design

The visual system follows T3Code's information hierarchy but remains Flect:

- body text uses the rail's existing 14 px scale and comfortable 1.55 rhythm;
- headings are compact, progressively scaled, and never resemble a document
  editor toolbar;
- blocks use 0.65 rem vertical rhythm, with first and last margins removed;
- links use Flect rose only as an interaction cue;
- quotes use a two-pixel tokenized rule and muted text;
- inline code uses a quiet bordered chip;
- code and table chrome use `--surface`, `--surface-raised`, `--line`,
  `--muted`, and `--ink`;
- controls remain dense on desktop and meet the existing 44 px compact target;
- no wide decorative shadows, gradients, glass effects, or new card language;
  and
- reduced-motion users receive no copied-state or disclosure animation.

## Streaming behavior

The existing conversation message updates remain the source of truth.
Incomplete Markdown must stay readable during streaming:

- incomplete fences render as plain fenced code rather than disappearing;
- highlighting is skipped until the message is no longer streaming;
- parser or highlighter failures fall back to escaped text/code without
  breaking the conversation;
- copy controls always use the source code, never highlighted HTML; and
- completing a stream upgrades the same content to highlighted output without
  changing message authority or history.

## Error handling

Expected clipboard failures are typed in the Effect error channel and produce
an accessible local status without throwing from React.

Markdown parsing and syntax-highlighting defects are contained by a renderer
error boundary. The fallback is the original escaped message text or code.
Failures never remove the composer, role switcher, revision controls, safe-mode
entry, or recovery shell.

## Component boundaries

- `MessageContent` selects role-aware Markdown behavior and owns the top-level
  error fallback.
- `MarkdownCodeBlock` owns code chrome and ephemeral copy/wrap state.
- `HighlightedCode` owns lazy, bounded highlighting and plain-code fallback.
- `MarkdownTable` owns containment, expansion, and serialization actions.
- `MarkdownDetails` owns disclosure presentation.
- `MarkdownLink` owns safe external and fragment navigation.
- the platform clipboard service owns the browser/Tauri clipboard boundary.
- serializers and URL policy are pure modules with focused tests.

No component reaches into agent sessions, the shaping kernel, revision
storage, or Pi.

## Testing

Test-first coverage proves observable behavior:

- all supported block and inline Markdown structures render semantically;
- GFM task lists are read-only;
- raw script/event/style injection and unsafe URLs are removed;
- external links have safe target/relationship attributes;
- fragment links remain local;
- code language and filename metadata render correctly;
- copying code writes the exact source through a test Effect layer;
- wrapping is keyboard operable and stateful;
- unsupported languages and highlighter failures preserve plain code;
- streaming code does not suspend or disappear;
- table expansion and Markdown/CSV copy are correct;
- malformed Markdown remains visible;
- user hard breaks and assistant paragraphs differ as designed;
- narrow layouts contain code and tables without document overflow;
- focus visibility, control names, target sizes, and contrast remain
  accessible; and
- real Chromium exercises representative Markdown in the production build.

The final gate is `bun run check:all`, followed by a production Chromium visual
inspection and an installed macOS launch/RPC smoke check.

## Intentional exclusions

This feature does not add:

- T3Code file chips, workspace-relative path resolution, or editor actions;
- integrated browser/file preview actions;
- provider skills or skill chips;
- task-list mutation of model messages;
- remote favicon fetching;
- model-authored images or image fetching;
- T3Code settings, themes, menus, toasts, or local API;
- Markdown-authored Flect capabilities or interface revisions; or
- code execution from rendered messages.

Those are product capabilities, not Markdown presentation.

## Acceptance criteria

The feature is complete when:

1. every supported Markdown family above has observable automated coverage;
2. unsafe HTML and link inputs are proven inert;
3. code highlighting, copy, wrap, titles, streaming fallback, and error
   fallback work;
4. tables are readable, contained, expandable, and copyable in both formats;
5. the Flect rail remains responsive and accessible at desktop and compact
   widths;
6. all business and platform effects remain inside Effect capabilities;
7. browser and Tauri builds use the same renderer;
8. full repository verification passes;
9. the production UI is inspected in real Chromium; and
10. the rebuilt installed macOS app starts its native window and private
    runtime successfully.
