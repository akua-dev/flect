# Flect Rifty Execution Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and adopt the exact Rifty leaf packages Flect needs behind one
Effect-managed, test-only `BrowserExecution` capability without exposing
untrusted authoring code or changing the current product UI.

**Architecture:** The first adoption slice wraps Rifty's browser Worker,
WASI Preview 1 runner, memory VFS, and offline package installer behind Effect
services, Schema contracts, typed errors, scoped acquisition, and test Layers.
It deliberately uses a disposable memory filesystem and hard-coded diagnostic
programs; canonical OPFS, separate-origin untrusted authoring, service-worker
preview routing, just-bash, and embedded Git are separate follow-up plans.

**Tech Stack:** Effect `4.0.0-beta.102`, `@effect/vitest
4.0.0-beta.102`, Rifty leaf packages `0.2.0`, Vite `8.1.5`, Vitest `4.1.10`,
Playwright `1.62.0`, React `19.2.8`, Bun `1.4+`, Tauri `2`.

**Implementation status (2026-07-30):** Every non-commit step below is
implemented and verified. Commit steps remain unchecked because this task did
not authorize a commit. The later Shaper-facing browser shell integration is
recorded in
[`0002-browser-bun-command.md`](../../decisions/0002-browser-bun-command.md).

## Global Constraints

- Pin each selected `@riftydev/*` package to exactly `0.2.0`; do not use
  ranges, tags, the `@riftydev/sdk` umbrella, `@riftydev/shell`, or
  `@riftydev/git`.
- Add only the packages exercised by this slice:
  `@riftydev/vfs`, `@riftydev/runtime-js`, `@riftydev/runtime-wasi`, and
  `@riftydev/npm-client`.
- Keep Effect and every `@effect/*` package exactly at
  `4.0.0-beta.102`.
- Browser code must not import Pi, provider credentials, the native bridge, or
  canonical interface storage through this capability.
- Every Rifty Promise and message crosses an Effect service boundary; React
  never imports a Rifty package.
- Use `Schema.Class` and `Schema.TaggedErrorClass` for reusable boundary
  values, strict `Schema.decodeUnknownEffect` for Worker messages, named
  `Layer` values, `Effect.fn` for workflows, and `Effect.acquireRelease` for
  Worker lifetime.
- Expected startup, compatibility, execution, package, timeout, and malformed
  message failures remain typed. Interruption remains interruption.
- This slice runs only fixed diagnostic programs and an offline package
  fixture. It does not grant a user, capsule, Pi extension, or model a general
  JavaScript, filesystem, package, or WASI execution entry point.
- Rifty's Worker and cross-origin isolation are compatibility mechanisms, not
  hostile-code containment.
- Do not change `ARCHITECTURE.md` until the proof is implemented and verified.
- Preserve `docs/.DS_Store` as unrelated user state.

---

## File map

- `shared/browser-execution.ts` owns the versioned execution requests, results,
  capability report, Worker frames, and public typed failure.
- `src/execution/browser-execution.ts` owns the public Effect service contract
  and composes the three narrow adapters.
- `src/execution/rifty-js-runtime.ts` owns scoped
  `@riftydev/runtime-js` Worker acquisition, readiness, evaluation, stdout and
  stderr capture, deadline, and disposal.
- `src/execution/rifty-wasi-runtime.ts` owns the disposable WASI Worker
  request/response bridge.
- `src/execution/rifty-wasi-worker.ts` is the Worker entry that calls
  `@riftydev/runtime-wasi.runWasi`.
- `src/execution/rifty-package-mirror.ts` owns an offline, injected-registry
  package install into `@riftydev/vfs.MemoryVfs`.
- `src/execution/browser-execution-diagnostic.tsx` is a build-gated,
  hard-coded browser diagnostic used only by Playwright.
- `src/lib/runtime.ts` composes `BrowserExecutionLive` once into a dedicated
  `ManagedRuntime`; it does not add the capability to the current shaping
  runtime.
- `tests/e2e/browser-execution.spec.ts` proves the exact production Vite
  artifacts execute in real Chromium and terminate cleanly.
- `scripts/verify-rifty-dependencies.ts` verifies exact installed package
  versions, licenses, and repository identities through Effect Schema.
- `docs/decisions/0001-rifty-execution-substrate.md` records the verified
  adoption result and exact evidence after the gate passes.

---

### Task 1: Pin and verify the selected Rifty artifacts

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Create: `scripts/verify-rifty-dependencies.ts`
- Create: `scripts/verify-rifty-dependencies.test.ts`

**Interfaces:**

- Consumes: installed package manifests under
  `node_modules/@riftydev/<package>/package.json`
- Produces: `bun run check:rifty`, which exits successfully only when all four
  packages are version `0.2.0`, license `MIT`, and reference
  `https://github.com/vanilla-wave/rifty`

- [x] **Step 1: Write the failing manifest-verification test**

Create `scripts/verify-rifty-dependencies.test.ts`:

```ts
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  makeVerifyRiftyDependencies,
  verifyRiftyDependencies,
  RIFTY_DEPENDENCIES,
} from "./verify-rifty-dependencies";

describe("Rifty dependency pins", () => {
  it.effect("accepts the four exact published artifacts", () =>
    Effect.gen(function* () {
      const verified = yield* verifyRiftyDependencies;

      assert.deepStrictEqual(
        verified.map((entry) => entry.name),
        [...RIFTY_DEPENDENCIES],
      );
      assert.isTrue(verified.every((entry) => entry.version === "0.2.0"));
      assert.isTrue(verified.every((entry) => entry.license === "MIT"));
    }),
  );

  it.effect("rejects an artifact outside the exact approved pin", () =>
    Effect.gen(function* () {
      const error = yield* makeVerifyRiftyDependencies(() =>
        Effect.succeed({
          name: "@riftydev/vfs",
          version: "0.2.1",
          license: "MIT",
          repository: {
            type: "git",
            url: "git+https://github.com/vanilla-wave/rifty.git",
          },
        }),
      ).pipe(Effect.flip);

      assert.strictEqual(error._tag, "RiftyDependencyVerificationFailed");
      assert.notInclude(error.message, "0.2.1");
    }),
  );
});
```

- [x] **Step 2: Run the test and verify the verifier is absent**

Run:

```bash
bunx vitest run scripts/verify-rifty-dependencies.test.ts
```

Expected: FAIL because `./verify-rifty-dependencies` does not exist.

- [x] **Step 3: Add exact dependencies and the check script**

Add these exact entries to `dependencies`:

```json
"@riftydev/npm-client": "0.2.0",
"@riftydev/runtime-js": "0.2.0",
"@riftydev/runtime-wasi": "0.2.0",
"@riftydev/vfs": "0.2.0"
```

Add:

```json
"check:rifty": "bun scripts/verify-rifty-dependencies.ts"
```

Run:

```bash
bun install
```

- [x] **Step 4: Implement the strict manifest verifier**

Create `scripts/verify-rifty-dependencies.ts` with:

```ts
import { Effect, Schema } from "effect";

export const RIFTY_DEPENDENCIES: ReadonlyArray<string> = [
  "@riftydev/npm-client",
  "@riftydev/runtime-js",
  "@riftydev/runtime-wasi",
  "@riftydev/vfs",
];

class PackageRepository extends Schema.Class<PackageRepository>(
  "PackageRepository",
)({
  type: Schema.Literal("git"),
  url: Schema.String,
}) {}

class PackageManifest extends Schema.Class<PackageManifest>("PackageManifest")({
  name: Schema.String,
  version: Schema.String,
  license: Schema.String,
  repository: PackageRepository,
}) {}

export class VerifiedRiftyDependency extends Schema.Class<VerifiedRiftyDependency>(
  "VerifiedRiftyDependency",
)({
  name: Schema.String,
  version: Schema.String,
  license: Schema.String,
}) {}

export class RiftyDependencyVerificationFailed extends Schema.TaggedErrorClass<RiftyDependencyVerificationFailed>()(
  "RiftyDependencyVerificationFailed",
  {
    packageName: Schema.String,
    message: Schema.String,
  },
) {}

const decodeManifest = Schema.decodeUnknownEffect(PackageManifest, {
  errors: "all",
  onExcessProperty: "ignore",
});

type ManifestReader = (
  path: string,
) => Effect.Effect<unknown, RiftyDependencyVerificationFailed>;

const readManifest: ManifestReader = (path) =>
  Effect.tryPromise({
    try: () => Bun.file(path).json(),
    catch: () =>
      RiftyDependencyVerificationFailed.make({
        packageName: path,
        message: "The installed Rifty package manifest could not be read.",
      }),
  });

const verifyOne = (
  read: ManifestReader,
  name: string,
): Effect.Effect<
  VerifiedRiftyDependency,
  RiftyDependencyVerificationFailed
> => Effect.gen(function* () {
  const path = `node_modules/${name}/package.json`;
  const unknownManifest = yield* read(path);
  const manifest = yield* decodeManifest(unknownManifest).pipe(
    Effect.mapError(() =>
      RiftyDependencyVerificationFailed.make({
        packageName: name,
        message: "The installed Rifty package manifest is invalid.",
      }),
    ),
  );

  if (
    manifest.name !== name ||
    manifest.version !== "0.2.0" ||
    manifest.license !== "MIT" ||
    !manifest.repository.url.includes("github.com/vanilla-wave/rifty")
  ) {
    return yield* Effect.fail(
      RiftyDependencyVerificationFailed.make({
        packageName: name,
        message: "The installed Rifty package does not match the approved pin.",
      }),
    );
  }

  return VerifiedRiftyDependency.make({
    name,
    version: manifest.version,
    license: manifest.license,
  });
});

export const makeVerifyRiftyDependencies = (read: ManifestReader) =>
  Effect.forEach(
    RIFTY_DEPENDENCIES,
    (name) => verifyOne(read, name),
    { concurrency: 1 },
  );

export const verifyRiftyDependencies =
  makeVerifyRiftyDependencies(readManifest);

if (import.meta.main) {
  Effect.runPromise(verifyRiftyDependencies).then((entries) => {
    for (const entry of entries) {
      console.log(`${entry.name}@${entry.version} ${entry.license}`);
    }
  });
}
```

- [x] **Step 5: Run dependency verification and the focused test**

Run:

```bash
bun run check:rifty
bunx vitest run scripts/verify-rifty-dependencies.test.ts
```

Expected: four exact `0.2.0 MIT` lines, then PASS.

- [ ] **Step 6: Commit the independently verified dependency pin**

```bash
git add package.json bun.lock scripts/verify-rifty-dependencies.ts scripts/verify-rifty-dependencies.test.ts
git commit -m "build: pin rifty execution dependencies"
```

---

### Task 2: Define strict browser-execution contracts

**Files:**

- Create: `shared/browser-execution.ts`
- Create: `shared/browser-execution.test.ts`

**Interfaces:**

- Produces:
  - `BrowserExecutionCapabilities`
  - `JavaScriptExecutionRequest`
  - `JavaScriptExecutionResult`
  - `WasiExecutionRequest`
  - `WasiExecutionResult`
  - `PackageMirrorRequest`
  - `PackageMirrorResult`
  - `BrowserExecutionFailed`
  - `WasiWorkerRequest`
  - `WasiWorkerResponse`

- [x] **Step 1: Write strict schema tests**

Create `shared/browser-execution.test.ts` with focused tests that:

```ts
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, type SchemaAST } from "effect";
import {
  BrowserExecutionCapabilities,
  JavaScriptExecutionRequest,
  WasiWorkerResponse,
} from "./browser-execution";

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

describe("browser execution contracts", () => {
  it.effect("rejects an excess JavaScript request property", () =>
    Schema.decodeUnknownEffect(JavaScriptExecutionRequest, strict)({
      version: 1,
      source: "40 + 2",
      unexpected: true,
    }).pipe(
      Effect.match({
        onFailure: () => Effect.void,
        onSuccess: () => Effect.die("excess property was accepted"),
      }),
    ),
  );

  it.effect("round-trips the capability report", () =>
    Effect.gen(function* () {
      const report = BrowserExecutionCapabilities.make({
        version: 1,
        worker: true,
        webAssembly: true,
        crossOriginIsolated: false,
        opfs: false,
      });
      const encoded = yield* Schema.encodeUnknownEffect(
        BrowserExecutionCapabilities,
      )(report);
      const decoded = yield* Schema.decodeUnknownEffect(
        BrowserExecutionCapabilities,
        strict,
      )(encoded);
      assert.deepStrictEqual(decoded, report);
    }),
  );

  it.effect("rejects an unknown WASI worker frame", () =>
    Schema.decodeUnknownEffect(WasiWorkerResponse, strict)({
      type: "other",
      id: "request-a",
    }).pipe(
      Effect.match({
        onFailure: () => Effect.void,
        onSuccess: () => Effect.die("unknown frame was accepted"),
      }),
    ),
  );
});
```

- [x] **Step 2: Run the tests and verify the contract module is absent**

Run:

```bash
bunx vitest run shared/browser-execution.test.ts
```

Expected: FAIL because `shared/browser-execution.ts` does not exist.

- [x] **Step 3: Implement the version-one schemas**

Create `shared/browser-execution.ts` with the complete public shape:

```ts
import { Schema } from "effect";

const OutputText = Schema.String.check(Schema.isMaxLength(1_048_576));
const ArgumentText = Schema.String.check(Schema.isMaxLength(4_096));
const RequestId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^request-[a-z0-9]+$/),
);
const PackageName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(214),
  Schema.isPattern(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/),
);
const VersionRange = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
);
const Environment = Schema.Record(
  Schema.String.check(Schema.isMaxLength(128)),
  Schema.String.check(Schema.isMaxLength(4_096)),
).check(Schema.isMaxProperties(64));

export class BrowserExecutionCapabilities extends Schema.Class<BrowserExecutionCapabilities>(
  "BrowserExecutionCapabilities",
)({
  version: Schema.Literal(1),
  worker: Schema.Boolean,
  webAssembly: Schema.Boolean,
  crossOriginIsolated: Schema.Boolean,
  opfs: Schema.Boolean,
}) {}

export class JavaScriptExecutionRequest extends Schema.Class<JavaScriptExecutionRequest>(
  "JavaScriptExecutionRequest",
)({
  version: Schema.Literal(1),
  source: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(262_144),
  ),
}) {}

export class JavaScriptExecutionResult extends Schema.Class<JavaScriptExecutionResult>(
  "JavaScriptExecutionResult",
)({
  version: Schema.Literal(1),
  value: Schema.Unknown,
  stdout: OutputText,
  stderr: OutputText,
}) {}

export class WasiExecutionRequest extends Schema.Class<WasiExecutionRequest>(
  "WasiExecutionRequest",
)({
  version: Schema.Literal(1),
  module: Schema.Uint8Array,
  args: Schema.Array(ArgumentText).check(Schema.isMaxLength(64)),
  env: Environment,
}) {}

export class WasiExecutionResult extends Schema.Class<WasiExecutionResult>(
  "WasiExecutionResult",
)({
  version: Schema.Literal(1),
  exitCode: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 255 }),
  ),
  stdout: OutputText,
  stderr: OutputText,
}) {}

export class PackageMirrorRequest extends Schema.Class<PackageMirrorRequest>(
  "PackageMirrorRequest",
)({
  version: Schema.Literal(1),
  name: PackageName,
  packageVersion: VersionRange,
  dependencies: Schema.Record(PackageName, VersionRange).check(
    Schema.isMaxProperties(64),
  ),
}) {}

export class PackageMirrorResult extends Schema.Class<PackageMirrorResult>(
  "PackageMirrorResult",
)({
  version: Schema.Literal(1),
  packageCount: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 2_048 }),
  ),
  lockfileWritten: Schema.Boolean,
}) {}

export class BrowserExecutionFailed extends Schema.TaggedErrorClass<BrowserExecutionFailed>()(
  "BrowserExecutionFailed",
  {
    reason: Schema.Literals([
      "unsupported",
      "invalid-input",
      "startup",
      "worker",
      "deadline",
      "execution",
      "invalid-result",
      "package",
    ]),
    operation: Schema.Literals([
      "probe",
      "javascript",
      "wasi",
      "package-mirror",
    ]),
    message: Schema.String.check(Schema.isMaxLength(500)),
  },
) {}

export class WasiWorkerRequest extends Schema.Class<WasiWorkerRequest>(
  "WasiWorkerRequest",
)({
  type: Schema.Literal("run"),
  id: RequestId,
  request: WasiExecutionRequest,
}) {}

export class WasiWorkerSuccess extends Schema.Class<WasiWorkerSuccess>(
  "WasiWorkerSuccess",
)({
  type: Schema.Literal("success"),
  id: RequestId,
  result: WasiExecutionResult,
}) {}

export class WasiWorkerFailure extends Schema.Class<WasiWorkerFailure>(
  "WasiWorkerFailure",
)({
  type: Schema.Literal("failure"),
  id: RequestId,
  error: BrowserExecutionFailed,
}) {}

export const WasiWorkerResponse = Schema.Union([
  WasiWorkerSuccess,
  WasiWorkerFailure,
]);
export type WasiWorkerResponse = typeof WasiWorkerResponse.Type;
```

Before constructing `WasiExecutionRequest`, the public service rejects a
zero-byte module or a module above 8 MiB with
`BrowserExecutionFailed(reason: "invalid-input", operation: "wasi")`.

- [x] **Step 4: Run contract tests**

Run:

```bash
bunx vitest run shared/browser-execution.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add shared/browser-execution.ts shared/browser-execution.test.ts
git commit -m "feat: define browser execution contracts"
```

---

### Task 3: Wrap the Rifty JavaScript Worker in a scoped Effect service

**Files:**

- Create: `src/execution/browser-execution.ts`
- Create: `src/execution/rifty-js-runtime.ts`
- Create: `src/execution/rifty-js-runtime.test.ts`

**Interfaces:**

- Consumes: `JavaScriptExecutionRequest`, `JavaScriptExecutionResult`,
  `BrowserExecutionCapabilities`, and `BrowserExecutionFailed`
- Produces:

```ts
export interface BrowserExecutionShape {
  readonly probe: Effect.Effect<
    BrowserExecutionCapabilities,
    BrowserExecutionFailed
  >;
  readonly evaluateJavaScript: (
    request: JavaScriptExecutionRequest,
  ) => Effect.Effect<JavaScriptExecutionResult, BrowserExecutionFailed>;
  readonly runWasi: (
    request: WasiExecutionRequest,
  ) => Effect.Effect<WasiExecutionResult, BrowserExecutionFailed>;
  readonly mirrorPackages: (
    request: PackageMirrorRequest,
  ) => Effect.Effect<PackageMirrorResult, BrowserExecutionFailed>;
}
```

- [x] **Step 1: Write lifecycle and failure tests**

Create `src/execution/rifty-js-runtime.test.ts`:

```ts
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { JavaScriptExecutionRequest } from "../../shared/browser-execution";
import {
  makeRiftyJavaScriptTestLayer,
  RiftyJavaScriptExecution,
} from "./rifty-js-runtime";

const request = JavaScriptExecutionRequest.make({
  version: 1,
  source: "40 + 2",
});

describe("RiftyJavaScriptExecution", () => {
  const success = makeRiftyJavaScriptTestLayer({
    evaluate: () => Effect.succeed({ ok: true, value: 42 }),
    stdout: ["answer\n"],
    stderr: [],
  });

  it.layer(success.layer)((it) => {
    it.effect("normalizes output and releases the Worker", () =>
      Effect.gen(function* () {
        const execution = yield* RiftyJavaScriptExecution;
        const result = yield* execution.evaluate(request);
        const releases = yield* Ref.get(success.releases);

        assert.strictEqual(result.value, 42);
        assert.strictEqual(result.stdout, "answer\n");
        assert.strictEqual(result.stderr, "");
        assert.strictEqual(releases, 1);
      }),
    );
  });

  const rejected = makeRiftyJavaScriptTestLayer({
    evaluate: () =>
      Effect.succeed({
        ok: false,
        message: "foreign stack and source must stay private",
      }),
    stdout: [],
    stderr: [],
  });

  it.layer(rejected.layer)((it) => {
    it.effect("maps a guest failure to the stable public error", () =>
      Effect.gen(function* () {
        const execution = yield* RiftyJavaScriptExecution;
        const error = yield* execution.evaluate(request).pipe(Effect.flip);
        const releases = yield* Ref.get(rejected.releases);

        assert.strictEqual(error._tag, "BrowserExecutionFailed");
        assert.strictEqual(error.operation, "javascript");
        assert.strictEqual(error.reason, "execution");
        assert.notInclude(error.message, "foreign stack");
        assert.strictEqual(releases, 1);
      }),
    );
  });

  const stalled = makeRiftyJavaScriptTestLayer({
    evaluate: () => Effect.never,
    stdout: [],
    stderr: [],
  });

  it.layer(stalled.layer)((it) => {
    it.effect("interrupts at the outer deadline and releases the Worker", () =>
      Effect.gen(function* () {
        const execution = yield* RiftyJavaScriptExecution;
        const fiber = yield* execution.evaluate(request).pipe(Effect.forkChild);

        yield* TestClock.adjust("2 seconds");
        const error = yield* Fiber.join(fiber).pipe(Effect.flip);
        const releases = yield* Ref.get(stalled.releases);

        assert.strictEqual(error.reason, "deadline");
        assert.strictEqual(releases, 1);
      }),
    );
  });
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bunx vitest run src/execution/rifty-js-runtime.test.ts
```

Expected: FAIL because the service and adapter do not exist.

- [x] **Step 3: Implement the public service and private factory**

In `browser-execution.ts`, define `BrowserExecution` with
`Context.Service` and no implementation.

In `rifty-js-runtime.ts`, define a private `RiftyJavaScriptRuntimeFactory`
service whose `acquire` field is scoped. The live factory must:

1. import the bundled Worker URL with:

   ```ts
   import runtimeWorkerUrl from "@riftydev/runtime-js/worker?worker&url";
   ```

2. call `spawnRuntime({ workerUrl: runtimeWorkerUrl })`;
3. subscribe immediately and wait for `ready`;
4. capture stdout and stderr chunks in bounded `Ref` values;
5. expose evaluation through `Effect.tryPromise`;
6. release the event subscription and call `runtime.dispose()` in the
   `Effect.acquireRelease` finalizer.

Map all foreign errors to `BrowserExecutionFailed.make(...)` without including
foreign stacks or source in the public message.

- [x] **Step 4: Add the JavaScript adapter Layer**

Export:

```ts
export const RiftyJavaScriptLive: Layer.Layer<
  RiftyJavaScriptExecution,
  never,
  RiftyJavaScriptRuntimeFactory
>;

export const RiftyJavaScriptRuntimeFactoryLive: Layer.Layer<
  RiftyJavaScriptRuntimeFactory,
  never
>;
```

The `evaluate` operation must use:

```ts
Effect.scoped(
  factory.acquire.pipe(
    Effect.flatMap((runtime) => runtime.evaluate(request.source)),
    Effect.timeoutOrElse({
      duration: "2 seconds",
      orElse: () =>
        Effect.fail(
          BrowserExecutionFailed.make({
            reason: "deadline",
            operation: "javascript",
            message: "Browser JavaScript execution exceeded its deadline.",
          }),
        ),
    }),
  ),
);
```

Normalize and schema-decode the output before returning it.

- [x] **Step 5: Run the lifecycle tests**

Run:

```bash
bunx vitest run src/execution/rifty-js-runtime.test.ts
```

Expected: PASS, including one release on every terminal path.

- [ ] **Step 6: Commit the scoped JavaScript adapter**

```bash
git add src/execution/browser-execution.ts src/execution/rifty-js-runtime.ts src/execution/rifty-js-runtime.test.ts
git commit -m "feat: wrap rifty javascript execution"
```

---

### Task 4: Run WASI modules in a disposable Worker

**Files:**

- Create: `src/execution/rifty-wasi-runtime.ts`
- Create: `src/execution/rifty-wasi-worker.ts`
- Create: `src/execution/rifty-wasi-runtime.test.ts`

**Interfaces:**

- Consumes: `WasiExecutionRequest`, `WasiWorkerRequest`,
  `WasiWorkerResponse`
- Produces: `RiftyWasiExecution` Effect service with:

```ts
readonly run: (
  request: WasiExecutionRequest,
) => Effect.Effect<WasiExecutionResult, BrowserExecutionFailed>;
```

- [x] **Step 1: Write Worker bridge tests**

Create `src/execution/rifty-wasi-runtime.test.ts`. Use this valid no-op WASI
module fixture:

```ts
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { WasiExecutionRequest } from "../../shared/browser-execution";
import {
  makeRiftyWasiWorkerHandle,
  makeRiftyWasiTestLayer,
  RiftyWasiExecution,
} from "./rifty-wasi-runtime";

export const NOOP_WASI_MODULE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x0a, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);

const request = WasiExecutionRequest.make({
  version: 1,
  module: NOOP_WASI_MODULE,
  args: ["flect-test"],
  env: {},
});

describe("RiftyWasiExecution", () => {
  const success = makeRiftyWasiTestLayer({
    run: () =>
      Effect.succeed({
        version: 1,
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
  });

  it.layer(success.layer)((it) => {
    it.effect("returns the exit code and releases the Worker", () =>
      Effect.gen(function* () {
        const execution = yield* RiftyWasiExecution;
        const result = yield* execution.run(request);
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(yield* Ref.get(success.releases), 1);
      }),
    );
  });

  const malformed = makeRiftyWasiTestLayer({
    run: () => Effect.fail("malformed-response"),
  });

  it.layer(malformed.layer)((it) => {
    it.effect("rejects a malformed Worker response", () =>
      Effect.gen(function* () {
        const execution = yield* RiftyWasiExecution;
        const error = yield* execution.run(request).pipe(Effect.flip);
        assert.strictEqual(error.reason, "invalid-result");
        assert.strictEqual(yield* Ref.get(malformed.releases), 1);
      }),
    );
  });

  const stalled = makeRiftyWasiTestLayer({
    run: () => Effect.never,
  });

  it.layer(stalled.layer)((it) => {
    it.effect("terminates at the deadline", () =>
      Effect.gen(function* () {
        const execution = yield* RiftyWasiExecution;
        const fiber = yield* execution.run(request).pipe(Effect.forkChild);
        yield* TestClock.adjust("2 seconds");
        const error = yield* Fiber.join(fiber).pipe(Effect.flip);
        assert.strictEqual(error.reason, "deadline");
        assert.strictEqual(yield* Ref.get(stalled.releases), 1);
      }),
    );
  });
});
```

Add this test to the same `describe` block:

```ts
it.effect("maps a synchronous postMessage failure to worker failure", () => {
  const worker = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    postMessage: () => {
      throw new DOMException("Could not clone", "DataCloneError");
    },
  } satisfies Pick<
    Worker,
    "addEventListener" | "removeEventListener" | "postMessage"
  >;

  return Effect.gen(function* () {
    const error = yield* makeRiftyWasiWorkerHandle(worker)
      .run(request)
      .pipe(Effect.flip);
    assert.strictEqual(error.reason, "worker");
  });
});
```

- [x] **Step 2: Run the tests and verify the adapter is absent**

Run:

```bash
bunx vitest run src/execution/rifty-wasi-runtime.test.ts
```

Expected: FAIL because the runtime and Worker do not exist.

- [x] **Step 3: Implement the Worker entry**

`rifty-wasi-worker.ts` must:

- decode every incoming `unknown` frame with strict Effect Schema;
- call `runWasi(request.module, { args, env, preopens: {} })`;
- cap stdout and stderr before constructing the result;
- schema-encode one `WasiWorkerResponse`;
- transfer no host object or filesystem handle;
- map a thrown foreign failure to a redacted
  `BrowserExecutionFailed(operation: "wasi")`.

- [x] **Step 4: Implement scoped Worker acquisition**

Use:

```ts
new Worker(new URL("./rifty-wasi-worker.ts", import.meta.url), {
  type: "module",
  name: "flect-rifty-wasi",
});
```

The factory must use `Effect.acquireRelease`; its finalizer always calls
`terminate()`. The request bridge must remove message and error listeners on
success, failure, interruption, and timeout.

- [x] **Step 5: Run unit and production-build checks**

Run:

```bash
bunx vitest run src/execution/rifty-wasi-runtime.test.ts
bun run build
```

Expected: tests PASS and Vite emits the WASI Worker without unresolved Node
builtins.

- [ ] **Step 6: Commit the WASI adapter**

```bash
git add src/execution/rifty-wasi-runtime.ts src/execution/rifty-wasi-worker.ts src/execution/rifty-wasi-runtime.test.ts
git commit -m "feat: add scoped rifty wasi execution"
```

---

### Task 5: Prove offline package installation into a disposable Rifty VFS

**Files:**

- Create: `src/execution/rifty-package-mirror.ts`
- Create: `src/execution/rifty-package-mirror.test.ts`
- Create: `src/execution/fixtures/package-registry.ts`

**Interfaces:**

- Consumes: `PackageMirrorRequest`
- Produces: `RiftyPackageMirror` service with:

```ts
readonly install: (
  request: PackageMirrorRequest,
) => Effect.Effect<PackageMirrorResult, BrowserExecutionFailed>;
```

- [x] **Step 1: Build a deterministic registry fixture**

Create `src/execution/fixtures/package-registry.ts` with the fixed
zero-dependency `flect-fixture@1.0.0` npm tarball and its SHA-512 integrity:

```ts
import type { Packument } from "@riftydev/npm-client";
import { Context, Layer } from "effect";

const TARBALL_BASE64 =
  "H4sIAAAAAAACE+3TsQ7CIBAGYGafomFWSmvVROPDkPZq0BYaoKaJ8d09q8ZEBxdtot63/HAMDPA3Kt+pDcTNJcXWW8PeTKJ5lvWJHlPKxey+7udJMp9isgG0PiiHV7L/dOBG1cCXvKwgD5NSd6F1wMd8D85ra/AkEVJInNRKn7faFNDhP+HHESPf7tr7+Paqn7jjZf/T5/7jkPo/gNoWbQUCusa64KN1lKUr6jUhhPy+E9y6GJgADAAA";
const TARBALL_URL =
  "https://registry.flect.invalid/flect-fixture/-/flect-fixture-1.0.0.tgz";
const INTEGRITY =
  "sha512-UtEKTNiX8Hl8pY4rXAeaqQIn4FoI6bXsJB/osrIJ7KjLdJp1P+VT+cjo25gH2I/4dtASAlzkzJJBkCD48sKulQ==";

const tarball = Uint8Array.from(atob(TARBALL_BASE64), (character) =>
  character.charCodeAt(0),
);

export class RegistryFetcher extends Context.Service<
  RegistryFetcher,
  {
    readonly fetch: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
  }
>()("flect/RegistryFetcher") {}

const makePackument = (integrity: string): Packument => ({
  name: "flect-fixture",
  "dist-tags": { latest: "1.0.0" },
  versions: {
    "1.0.0": {
      name: "flect-fixture",
      version: "1.0.0",
      dist: {
        tarball: TARBALL_URL,
        integrity,
      },
    },
  },
});

const makeRegistryFetcherLayer = (integrity: string) =>
  Layer.succeed(RegistryFetcher)({
    fetch: (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (url === "https://registry.flect.invalid/flect-fixture") {
        return Promise.resolve(Response.json(makePackument(integrity)));
      }

      if (url === TARBALL_URL) {
        return Promise.resolve(
          new Response(tarball, {
            headers: { "content-type": "application/octet-stream" },
          }),
        );
      }

      return Promise.reject(
        new Error("Fixture registry rejected an unknown URL."),
      );
    },
  });

export const FixtureRegistryFetcherLive =
  makeRegistryFetcherLayer(INTEGRITY);

export const BadIntegrityRegistryFetcherLive =
  makeRegistryFetcherLayer("sha512-invalid");
```

- [x] **Step 2: Write package-mirror tests**

Tests must assert:

- `MemoryVfs` contains
  `/workspace/node_modules/flect-fixture/package.json`;
- `/workspace/bun.lock` or unrelated host files are absent;
- the returned package count is `1`;
- the Rifty npm-client v3 lockfile is present at
  `/workspace/package-lock.json`;
- a bad integrity value fails with
  `BrowserExecutionFailed(reason: "package")`;
- the caller's `AbortSignal` interrupts acquisition.

- [x] **Step 3: Run the focused tests and verify failure**

Run:

```bash
bunx vitest run src/execution/rifty-package-mirror.test.ts
```

Expected: FAIL because `RiftyPackageMirror` does not exist.

- [x] **Step 4: Implement the memory-only package mirror**

The live adapter must:

1. create a new `MemoryVfs` per call;
2. create `/workspace/package.json` from the schema-decoded request;
3. construct `RegistryClient` with only `RegistryFetcher.fetch`;
4. call `install({ vfs, cwd: "/workspace", registry, signal })`;
5. reject any portable path outside `/workspace`;
6. read and validate the installed manifest and lockfile;
7. return only `PackageMirrorResult`; and
8. drop the VFS after the Effect finishes.

No production layer may bind `RegistryFetcher` to `globalThis.fetch` in this
plan. Only the fixture Layer exists.

- [x] **Step 5: Run the package tests**

Run:

```bash
bunx vitest run src/execution/rifty-package-mirror.test.ts
```

Expected: PASS with no network access.

- [ ] **Step 6: Commit the offline package proof**

```bash
git add src/execution/rifty-package-mirror.ts src/execution/rifty-package-mirror.test.ts src/execution/fixtures/package-registry.ts
git commit -m "feat: prove rifty package mirroring"
```

---

### Task 6: Compose one diagnostic runtime and verify production Chromium

**Files:**

- Modify: `src/lib/runtime.ts`
- Modify: `src/main.tsx`
- Modify: `src/vite-env.d.ts`
- Modify: `vite.config.ts`
- Modify: `playwright.config.ts`
- Create: `src/execution/browser-execution-diagnostic.tsx`
- Create: `tests/e2e/browser-execution.spec.ts`

**Interfaces:**

- Consumes: `RiftyJavaScriptLive`, `RiftyWasiExecution`,
  `RiftyPackageMirror`
- Produces:

```ts
export const executionRuntime: ManagedRuntime.ManagedRuntime<
  BrowserExecution,
  never
>;
```

- [x] **Step 1: Write the real-browser test**

Create a Playwright test that opens:

```text
/?execution-diagnostic=1
```

and asserts:

```ts
await expect(page.getByTestId("execution-diagnostic")).toHaveAttribute(
  "data-status",
  "passed",
);
await expect(page.getByTestId("execution-js")).toHaveText("42");
await expect(page.getByTestId("execution-wasi")).toHaveText("0");
await expect(page.getByTestId("execution-release")).toHaveText("disposed");
```

Capture `pageerror`, console errors, and failed same-origin application
requests exactly as the existing `tests/e2e/flect.spec.ts` does.

- [x] **Step 2: Run the test and verify the diagnostic route is absent**

Run:

```bash
bunx playwright test tests/e2e/browser-execution.spec.ts
```

Expected: FAIL because no diagnostic surface exists.

- [x] **Step 3: Compose the Effect runtime once**

Build one named `BrowserExecutionLive` Layer from the three adapters and add a
separate `executionRuntime` to `src/lib/runtime.ts`. Do not merge it into
`browserRuntime` or `shapingRuntime`.

The fixed diagnostic performs:

```ts
evaluateJavaScript(
  JavaScriptExecutionRequest.make({
    version: 1,
    source: "40 + 2",
  }),
);

runWasi(
  WasiExecutionRequest.make({
    version: 1,
    module: NOOP_WASI_MODULE,
    args: ["flect-diagnostic"],
    env: {},
  }),
);
```

The diagnostic does not accept source, package names, arguments, or Wasm bytes
from the URL, DOM, storage, or network.

- [x] **Step 4: Gate the diagnostic out of ordinary builds**

Declare:

```ts
interface ImportMetaEnv {
  readonly VITE_FLECT_EXECUTION_DIAGNOSTIC?: "1";
}
```

`main.tsx` may render `BrowserExecutionDiagnostic` only when both:

```ts
import.meta.env.VITE_FLECT_EXECUTION_DIAGNOSTIC === "1"
new URLSearchParams(location.search).get("execution-diagnostic") === "1"
```

Otherwise it renders the existing `App` unchanged.

- [x] **Step 5: Add the Rifty browser headers and Worker format**

Define one header object in `vite.config.ts` and apply it to `server.headers`
and `preview.headers`:

```ts
const browserExecutionHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};
```

Add:

```ts
worker: { format: "es" }
```

Do not loosen the Tauri CSP or add arbitrary `connect-src`.

- [x] **Step 6: Enable the diagnostic only in the Playwright build**

Change the Playwright Vite command to:

```text
VITE_FLECT_EXECUTION_DIAGNOSTIC=1 bun run build &&
bun run preview -- --host 127.0.0.1 --port 5173
```

Keep `FLECT_TEST_MODE=1` limited to the Pi runtime process.

- [x] **Step 7: Run real-browser and ordinary-product regression tests**

Run:

```bash
bunx playwright test tests/e2e/browser-execution.spec.ts
bunx playwright test tests/e2e/flect.spec.ts
VITE_FLECT_EXECUTION_DIAGNOSTIC=0 bun run build
```

Expected:

- diagnostic PASS in Chromium;
- existing Flect E2E PASS;
- ordinary build contains no rendered diagnostic route and the existing shell
  remains unchanged.

- [ ] **Step 8: Commit the browser adoption gate**

```bash
git add src/lib/runtime.ts src/main.tsx src/vite-env.d.ts vite.config.ts playwright.config.ts src/execution/browser-execution-diagnostic.tsx tests/e2e/browser-execution.spec.ts
git commit -m "test: prove rifty execution in chromium"
```

---

### Task 7: Freeze the adoption evidence and run the repository gate

**Files:**

- Create: `docs/decisions/0001-rifty-execution-substrate.md`
- Modify:
  `docs/superpowers/specs/2026-07-30-flect-self-contained-shaper-design.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:**

- Consumes: exact passing package, unit, browser, and desktop-build evidence
- Produces: one durable decision record and verified current-architecture
  statement

- [x] **Step 1: Record the decision without duplicating the research appendix**

Create the decision record with:

- status `Accepted`;
- date `2026-07-30`;
- selected package names and exact `0.2.0` pins;
- evaluated Rifty commit
  `207e0ee9f108d6457e2448c956b84c2758e62671`;
- the narrow adopted surfaces;
- proof commands and observed browser;
- the fact that Rifty is cooperative execution, not containment;
- explicit deferrals: canonical OPFS, separate-origin authoring,
  service-worker preview, just-bash, wasm-git, worktrees, package network
  broker, and public UI;
- a link to the design's retained-references section rather than copying its
  project inventory.

- [x] **Step 2: Mark only the completed design slice as verified**

Update the design's delivery checklist or status text to say the
execution-substrate proof passed. Do not mark later shell, Git, authoring,
capsule, or release slices complete.

- [x] **Step 3: Update current architecture narrowly**

Add one verified paragraph to `ARCHITECTURE.md` stating:

- four exact Rifty leaf packages are present;
- an internal Effect-managed diagnostic can execute fixed JavaScript and WASI
  in disposable Workers and mirror one offline fixture into memory;
- the capability is not wired to React's ordinary product UI, Pi, extensions,
  canonical storage, or network;
- it is not a hostile-code sandbox.

- [x] **Step 4: Run the complete credential-free gate**

Run:

```bash
bun run check:rifty
bun run check:all
```

Expected:

- Effect checkout verification PASS;
- Biome PASS;
- TypeScript PASS;
- Vitest PASS;
- Chromium Playwright PASS;
- Rust tests PASS;
- release-mode macOS application bundle build PASS.

- [x] **Step 5: Inspect the final worktree**

Run:

```bash
git diff --check
git status --short
```

Expected: only the intended implementation, tests, dependency lock, decision,
architecture, and plan/spec changes plus the preserved unrelated
`docs/.DS_Store`.

- [ ] **Step 6: Commit the evidence**

```bash
git add ARCHITECTURE.md docs/decisions/0001-rifty-execution-substrate.md docs/superpowers/specs/2026-07-30-flect-self-contained-shaper-design.md
git commit -m "docs: accept rifty execution substrate"
```

---

## Self-review

- **Spec coverage:** This plan covers only delivery slice 1, the
  execution-substrate adoption proof. The next independent plans must cover
  the separate-origin untrusted runtime and package broker, just-bash,
  wasm-git/libgit2 with real worktrees, portable command packages, and
  Rifty/Vite preview versus Rolldown acceptance.
- **No public authority:** No task accepts user source, model input, capsule
  commands, arbitrary Wasm, registry URLs, or credentials.
- **Type consistency:** `BrowserExecution` owns four methods throughout;
  `RiftyJavaScriptExecution`, `RiftyWasiExecution`, and
  `RiftyPackageMirror` are the three adapters composed once at the edge.
- **Lifecycle:** Both execution paths acquire disposable Workers in Scope;
  the package mirror creates a per-call memory VFS.
- **Documentation ownership:** The spec retains future design and research,
  the decision owns the adopted tradeoff, and `ARCHITECTURE.md` changes only
  after observable proof passes.
