# Flect performance and platform-native baseline — 2026-08-10

## Purpose

Record the current production browser baseline before the live-canvas,
incremental-workspace, and platform-native work tracked by #20 and #36.

This report measures the protected empty shell. It does not claim full agent,
compiler, direct-manipulation, packaged macOS, or long-session performance.

## Environment

- Source commit: `f5503b0` on `main`
- Host: Apple Silicon macOS
- Bun: `1.3.14`
- Vite: `8.1.5`
- Browser: Headless Chrome `151.0.0.0`
- Browser driver: `chrome-devtools-axi`
- Production server: `vite preview` on `127.0.0.1`
- Runtime: intentionally offline; `/api/runtime` and `/api/models` returned
  `502`, so no Pi credentials or provider calls were involved

The checked-in `bun.lock` uses lockfile version 2, which Bun 1.3.14 cannot
read. The audit therefore used a detached temporary Git worktree and a
non-frozen install. No generated dependency or build file was copied back into
the source workspace.

## Production bundle

`bun run build` transformed 404 modules in approximately 1.2 seconds and
reported the main application chunk above Vite's 500 KiB warning threshold.

| Artifact | Raw | Gzip |
| --- | ---: | ---: |
| Initial application JavaScript | 1,888,091 B | 538,929 B transferred |
| Initial CSS | 16,849 B | 4,129 B transferred |
| esbuild Wasm | 13,940,120 B | 3,714,744 B |
| Large worker | 3,931,247 B | 1,094,323 B |
| QuickJS/Emscripten Wasm A | 528,551 B | 247,176 B |
| QuickJS/Emscripten Wasm B | 503,134 B | 231,526 B |
| Complete `dist` directory | approximately 20 MiB | not served as one payload |

The cold initial request set contained only HTML, the main application
JavaScript, CSS, favicon, and the two runtime status requests. The compiler,
sandbox, worker, and Wasm assets were not requested before use. That lazy
network behavior is correct and must be preserved.

The initial JavaScript is still too large for an instant protected shell. The
eager entry path constructs the browser runtime and role-owned sandboxed shell;
that path statically reaches the `just-bash/browser` implementation. The exact
module contribution requires a compatible Rolldown bundle analyzer, but the
runtime/shell boundary is the first code-splitting target. Heavy development
capabilities should load behind typed on-demand tools rather than the initial
React render.

## Browser results

### Load metrics

| Profile | DOM interactive | FCP | LCP | CLS | Long tasks | Used JS heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Local cold, no throttle | 38.7 ms | 139.9 ms | 156.5 ms | 0 | none | 9.58 MiB |
| Fast 4G, 4x CPU | 194.3 ms | 1,062.6 ms | 1,145.9 ms | 0.0048 | one at 63 ms | 9.66 MiB |
| Slow 4G, 4x CPU | 596.6 ms | 4,350.8 ms | 4,434.1 ms | 0.0048 | one at 57 ms | 9.69 MiB |

On Fast 4G with 4x CPU throttling, the main JavaScript request took 709 ms. On
Slow 4G with the same CPU throttle it took 3,596 ms. The bundle, rather than
HTML or CSS, dominates the remote-browser cold path.

The local result is excellent for an empty shell. The Slow 4G result is poor
and fails the normal 2.5-second LCP boundary. Flect's own #36 gate is stricter:
less than 1 second on Fast 4G/4x CPU and less than 2.5 seconds on Slow 4G/4x
CPU.

### Interaction sample

A no-op role-control click produced a 24 ms Event Timing duration with roughly
1 ms of handler processing. This is responsive, but it is not representative
of agent streaming, canvas selection, compilation, direct manipulation, or
history restoration.

### Stability and accessibility

- Cold local CLS was 0; throttled CLS was 0.0048.
- Lighthouse accessibility scored 96.
- Lighthouse best practices scored 96.
- Lighthouse SEO scored 100.
- The role labels failed contrast at 3.84:1 and 4.33:1 where 4.5:1 is required.
- Role and model buttons failed visible-label/accessibility-name matching.
- The two expected offline runtime requests caused console errors in this
  runtime-free audit.

## Platform-native findings

1. `src/styles.css` declares `color-scheme: dark` and supplies no light system
   appearance. The browser UI therefore ignores a light host preference.
2. The same shell composition and control grammar are used at desktop and
   narrow touch viewports. Responsive layout works, but this is not evidence
   of an iOS or Android-native host.
3. The current UI exposes Safe mode, Edit/Run, Shaper/App Agent, and a disabled
   retry-first setup state. These are known earlier-proof artifacts, not the
   intended live-canvas interaction.
4. Browser screenshots cannot prove macOS menu, window, focus, shortcut,
   trackpad, file-panel, appearance, VoiceOver, reopen, or lifecycle quality.
   Those require packaged-host evidence.
5. The current empty shell has no local load hitch, but the initial JavaScript
   creates a 57–63 ms long task on a 4x-throttled CPU and misses the stricter
   no-task-over-50-ms interaction principle.

## Required next work

1. Split the protected visual shell from browser development capabilities.
   Load `just-bash`, compilers, package resolution, sandboxes, Workers, and
   Wasm only when the agent invokes the corresponding typed tool.
2. Enforce an initial JavaScript budget of 200 KiB gzip / 600 KiB decoded and
   preserve the current absence of optional heavy assets on first load.
3. Add automated production AXI traces for local, Fast 4G/4x CPU, and Slow
   4G/4x CPU profiles, plus event, layout-shift, long-task, bundle, and heap
   assertions.
4. Implement real system light/dark and accessibility appearance contracts.
5. Create platform adapters for browser and macOS behavior, using host-native
   protected surfaces wherever the WebView cannot meet the contract.
6. Measure the full live-editing loop: composer input, stream rendering,
   selection, drag/resize, incremental patch, failing build, Undo, history,
   cancellation, 50 edit cycles, and memory disposal.
7. Run the corresponding packaged macOS matrix on clean supported hardware.

## Conclusion

The current local empty shell paints quickly and remains visually stable. The
initial JavaScript bundle is nevertheless too large, throttled browser startup
is not yet release quality, accessibility has concrete control defects, and
platform-native behavior is unproven beyond responsive browser layout. Flect
does not yet meet the final native-feel requirement.
