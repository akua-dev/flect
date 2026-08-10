import { BrowserHttpClient } from "@effect/platform-browser";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref, Result, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  ShareEmbeddedRepository,
  ShareGitSource,
  ShareLocalSource,
  SharePrivateSource,
  ShareUrlSource,
} from "../../packages/product/src/share";
import {
  PrivateShareSourceRegistry,
  PrivateShareSourceRegistryLive,
} from "./private-share-source-registry";
import { ShareQuarantine } from "./share-quarantine";
import {
  makeShareSourceResolverLayer,
  ShareSourceResolver,
  type ShareSourceResolverShape,
} from "./share-source-resolver";

const commit = "a".repeat(40);
const hash = "b".repeat(64);
const candidate = {
  manifest: {
    formatVersion: 1 as const,
    id: "dev.flect.shared-card",
    name: "Shared card",
    version: "1.0.0",
    repository: ShareEmbeddedRepository.make({
      _tag: "embedded",
      archivePath: "repository.tar",
      sha256: hash,
      commit,
    }),
    artifacts: [],
    compatibility: { flect: ">=0.2.0", platforms: ["browser" as const] },
    provenance: {
      publisher: "akua-dev",
      source: "fixture",
      revision: commit,
      builder: "test",
    },
    signatures: [],
    migrations: [],
  },
  repository: new Uint8Array([1]),
  artifacts: [],
  files: [],
  archiveSha256: hash,
};

const makeLayer = (
  fetcher: typeof globalThis.fetch,
  calls: Ref.Ref<ReadonlyArray<string>>,
  maxArchiveBytes = 64 * 1024 * 1024,
) => {
  const quarantine = Layer.succeed(ShareQuarantine)({
    inspect: (bytes) =>
      Ref.update(calls, (items) => [
        ...items,
        `bytes:${bytes.byteLength}`,
      ]).pipe(Effect.as(candidate)),
    inspectGit: (url, revision) =>
      Ref.update(calls, (items) => [...items, `git:${url}:${revision}`]).pipe(
        Effect.as(candidate),
      ),
  });
  const http = BrowserHttpClient.layerFetch.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(BrowserHttpClient.Fetch)(fetcher),
        Layer.succeed(BrowserHttpClient.RequestInit)({
          credentials: "omit",
          cache: "no-store",
          redirect: "follow",
        }),
      ),
    ),
  );
  const dependencies = Layer.mergeAll(
    quarantine,
    http,
    PrivateShareSourceRegistryLive,
  );
  return makeShareSourceResolverLayer({ maxArchiveBytes }).pipe(
    Layer.provideMerge(dependencies),
  );
};

const events = (source: Parameters<ShareSourceResolverShape["open"]>[0]) =>
  Effect.gen(function* () {
    const resolver = yield* ShareSourceResolver;
    return Array.from(yield* resolver.open(source).pipe(Stream.runCollect));
  });

describe("share source resolver", () => {
  it.effect(
    "normalizes local, streamed URL, and exact public Git sources",
    () => {
      const calls = Ref.makeUnsafe<ReadonlyArray<string>>([]);
      const requests = Ref.makeUnsafe<ReadonlyArray<RequestInit>>([]);
      const fetcher: typeof globalThis.fetch = (_input, init) =>
        Ref.update(requests, (items) => [...items, init ?? {}]).pipe(
          Effect.andThen(
            Effect.succeed(
              new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { "content-length": "3" },
              }),
            ),
          ),
          Effect.runPromise,
        );
      return Effect.gen(function* () {
        const local = yield* events(
          ShareLocalSource.make({
            _tag: "local",
            name: "card.flect-share",
            bytes: new Uint8Array([1, 2]),
          }),
        );
        const url = yield* events(
          ShareUrlSource.make({
            _tag: "url",
            url: "https://example.test/card.flect-share",
          }),
        );
        const git = yield* events(
          ShareGitSource.make({
            _tag: "git",
            url: "https://example.test/card.git",
            commit,
          }),
        );

        assert.deepStrictEqual(
          [local, url, git].map((items) => items.map((event) => event.type)),
          [
            ["started", "progress", "completed"],
            ["started", "progress", "completed"],
            ["started", "progress", "completed"],
          ],
        );
        assert.deepStrictEqual(yield* Ref.get(calls), [
          "bytes:2",
          "bytes:3",
          `git:https://example.test/card.git:${commit}`,
        ]);
        assert.strictEqual((yield* Ref.get(requests))[0]?.credentials, "omit");
        assert.strictEqual((yield* Ref.get(requests))[0]?.cache, "no-store");
        assert.strictEqual((yield* Ref.get(requests))[0]?.redirect, "follow");
      }).pipe(Effect.provide(makeLayer(fetcher, calls)));
    },
  );

  it.effect(
    "opens named private adapters through their trusted closure",
    () => {
      const calls = Ref.makeUnsafe<ReadonlyArray<string>>([]);
      return Effect.gen(function* () {
        const registry = yield* PrivateShareSourceRegistry;
        yield* registry.register({
          id: "company-share",
          name: "Company share",
          open: () => Effect.succeed(new Uint8Array([1, 2, 3, 4])),
        });
        const resolved = yield* events(
          SharePrivateSource.make({
            _tag: "private",
            adapterId: "company-share",
            reference: "card/1.0.0",
          }),
        );
        assert.deepStrictEqual(
          resolved.map((event) => event.type),
          ["started", "progress", "completed"],
        );
        assert.deepStrictEqual(yield* Ref.get(calls), ["bytes:4"]);
      }).pipe(
        Effect.provide(makeLayer(() => Promise.resolve(new Response()), calls)),
      );
    },
  );

  it.effect(
    "fails on declared and streamed oversize without inspecting bytes",
    () => {
      const calls = Ref.makeUnsafe<ReadonlyArray<string>>([]);
      const declared: typeof globalThis.fetch = () =>
        Promise.resolve(
          new Response(new Uint8Array([1]), {
            status: 200,
            headers: { "content-length": "17" },
          }),
        );
      const streamed: typeof globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(10));
                controller.enqueue(new Uint8Array(10));
                controller.close();
              },
            }),
            { status: 200 },
          ),
        );
      return Effect.gen(function* () {
        for (const fetcher of [declared, streamed]) {
          const result = yield* events(
            ShareUrlSource.make({
              _tag: "url",
              url: "https://example.test/oversized.flect-share",
            }),
          ).pipe(Effect.provide(makeLayer(fetcher, calls, 16)), Effect.result);
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) {
            assert.strictEqual(result.failure.reason, "oversized");
          }
        }
        assert.deepStrictEqual(yield* Ref.get(calls), []);
      });
    },
  );

  it.effect("times out and aborts a stalled credential-free download", () => {
    const calls = Ref.makeUnsafe<ReadonlyArray<string>>([]);
    let aborted = false;
    const fetcher: typeof globalThis.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
    return Effect.gen(function* () {
      const running = yield* events(
        ShareUrlSource.make({
          _tag: "url",
          url: "https://example.test/stalled.flect-share",
        }),
      ).pipe(
        Effect.provide(makeLayer(fetcher, calls)),
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* TestClock.adjust("20 seconds");
      const error = yield* Fiber.join(running);
      assert.strictEqual(error.reason, "timeout");
      assert.isTrue(aborted);
      assert.deepStrictEqual(yield* Ref.get(calls), []);
    });
  });
});
