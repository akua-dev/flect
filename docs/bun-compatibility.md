# Browser Bun compatibility

Flect provides a deliberately bounded Bun-compatible command inside the
enabled Shaper's role-owned, browser-resident Bash workspace. It is not the
native Bun executable and never falls back to a system shell or system Bun.

## Supported CLI surface

| Command | Current behavior |
| --- | --- |
| `bun <file>` | Alias for `bun run <file>` |
| `bun run <entry>` | Resolves and transforms a workspace ESM graph, then runs it in a disposable Rifty JavaScript Worker |
| `bun build <entry>` | Transforms the graph into `/workspace/.flect-build` without running the entry |
| `bun install`, `bun i` | Installs declared dependencies through the trusted npm registry broker |
| `bun add <package>` | Updates `package.json`, installs into staged `node_modules`, and applies one bounded workspace delta |
| `bun remove <package>`, `bun rm <package>` | Removes the dependency and its staged package files |
| `bun stop` | Interrupts the active run or preview and waits for resource disposal |
| `bun --help`, `bun --version` | Reports the Flect compatibility surface and `flect-browser/1` |

JavaScript, TypeScript, JSX, TSX, MJS, CJS, and JSON source files are accepted
within `/workspace`. TypeScript-family syntax is transformed by the pinned
`esbuild-wasm@0.28.1` browser build. Flect reports this as a compatible
transpiler; it does not claim exact Bun parser or runtime semantics.

Package operations use the pinned Rifty npm client. Registry responses and
tarballs are integrity checked, mutations happen in a staging VFS, and only a
validated delta of at most 4,096 files and 64 MiB returns to the disposable
workspace. Flect writes npm lockfile version 3. It does not produce `bun.lock`,
run lifecycle scripts, load native addons, or expose registry credentials to
the execution realm.

## Preview behavior

`Bun.serve({ port, fetch })` registers a fetch handler; it does not bind a TCP
socket. Flect returns `/preview/<port>/`, routes requests through a
service-worker broker, and executes the handler in the run's isolated Worker.
Requests, responses, headers, and bodies are schema checked and bounded.

Rifty JavaScript Workers fail closed for browser fetch, storage, IndexedDB,
cache, OPFS, File System Access, WebSocket, EventSource, worker-spawning, and
other ambient browser capability surfaces. Disposable workspace files remain
available only through the brokered Rifty VFS.

Preview documents receive a response-enforced sandbox and restrictive CSP.
Their origin is opaque, `connect-src` is denied, OPFS is unavailable, and no
parent DOM, Flect storage, credential, Pi, Tauri, or native bridge is injected.
Stopping a preview tombstones its route and releases the iframe and Worker.

## Bash surface

Pi sees one custom tool named `bash`. Its command crosses the typed Flect
transport to a role-owned `just-bash@3.2.0` instance in the browser or Tauri
WebView. The tool result returns stdout, stderr, exit status, and an optional
preview URL. Guardian never receives this tool.

The shell supports ordinary just-bash language features and its reviewed
browser commands, including pipelines, redirection, variables, functions, file
utilities, text processing, and ripgrep. Flect disables direct-network,
JavaScript-execution, Python, SQLite, and compression commands. Compressed
ripgrep input is also unavailable because the browser build intentionally
replaces `node:zlib` with a fail-closed adapter.

The command name `bun` is reserved before execution. Guest aliases, functions,
files, PATH changes, packages, and extensions cannot replace it.

## Explicitly unsupported

The following fail rather than acquiring broader authority:

- CLI families such as `test`, `x`, `repl`, `publish`, and unknown commands;
- `Bun.spawn`, `Bun.$`, `Bun.file`, `Bun.write`, `bun:sqlite`, raw TCP or UDP,
  subprocesses, native addons, and package lifecycle scripts;
- host filesystem paths, a system shell, a system Bun installation, and native
  executables;
- ambient guest network access or arbitrary package registries;
- canonical OPFS, Git metadata, credentials, product APIs, and native bridges;
  and
- direct mutation of accepted interface or recovery state.

The browser and desktop WebView use the same TypeScript implementation. The
host Bun command remains a repository-development tool only.

## Trust boundary

Rifty and just-bash provide cooperative execution machinery; neither is
treated as hostile-code containment. Flect's boundary is the combination of:

1. a disposable, role-specific memory workspace;
2. strict Effect Schema messages and bounded output;
3. Effect-owned scopes, interruption, deadlines, and finalizers;
4. an origin-restricted package broker with integrity verification;
5. an opaque preview realm with restrictive CSP and no ambient egress; and
6. deterministic interface validation, acceptance, rollback, and safe mode
   outside the execution realm.

Canonical OPFS/Git workspace adoption remains a separate reviewed slice. Until
then, agent shell files are disposable and do not become an accepted Flect
revision merely because a command changed them.

## Provenance

- Rifty packages: `@riftydev/runtime-js`, `@riftydev/runtime-wasi`,
  `@riftydev/npm-client`, and `@riftydev/vfs`, all pinned to `0.2.0`; evaluated
  upstream commit `207e0ee9f108d6457e2448c956b84c2758e62671`.
- just-bash: `3.2.0`, Apache-2.0.
- esbuild-wasm: `0.28.1`, MIT.
- Burrow research snapshot:
  `5db19587ed318df1f12010b3a49c6daee79732c7`. Its checked-in `bun.wasm`
  (`sha256:4dddd6083635da83d7eb2a41aeaa6b44f428909d612b2f5f35b52bf3bf556630`)
  was not adopted because its source/build provenance was incomplete.
