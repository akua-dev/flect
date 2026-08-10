import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, type SchemaAST } from "effect";
import {
  CapsuleManifest,
  PortableExtensionPackage,
  ProductCapabilityManifest,
  ProductEventPolicy,
  ProductGraphqlPolicy,
  ProductHttpPolicy,
} from "./contracts.js";

const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

describe("@flect/product contracts", () => {
  it.effect("exports one strict package-owned contract surface", () =>
    Effect.gen(function* () {
      const hash = "a".repeat(64);
      const capsule = yield* Schema.decodeUnknownEffect(
        CapsuleManifest,
        strict,
      )({
        formatVersion: 1,
        id: "dev.flect.sdk-fixture",
        name: "SDK fixture",
        version: "1.0.0",
        entrypoints: [{ id: "main", path: "ui/index.html" }],
        files: [{ path: "ui/index.html", sha256: hash, bytes: 18 }],
        capabilities: [],
        extensions: [],
        compatibility: {
          flect: ">=0.2.0 <1.0.0",
          schemaVersion: 1,
          platforms: ["browser", "macos"],
        },
        provenance: {
          publisher: "akua-dev",
          source: "https://github.com/akua-dev/flect",
          revision: "sdk-fixture-v1",
          builder: "@flect/product",
        },
        signatures: [],
      });
      const extension = PortableExtensionPackage.make({
        formatVersion: 1,
        id: "sdk-guide",
        name: "SDK guide",
        description: "Public Shaper guidance.",
        version: "1.0.0",
        bundle: "extensions/sdk-guide.mjs",
        roles: ["shaper"],
        compatibility: {
          flect: ">=0.2.0 <1.0.0",
          extensionApi: 1,
          platforms: ["browser", "macos"],
        },
        capabilities: [],
        publicInstructions: "Use named operations only.",
        commands: [],
        tools: [],
        resources: {
          deadlineMs: 100,
          memoryBytes: 16 * 1024 * 1024,
          inputBytes: 64 * 1024,
          outputBytes: 64 * 1024,
          maxIntents: 1,
        },
        provenance: {
          publisher: "akua-dev",
          source: "https://github.com/akua-dev/flect",
          revision: "sdk-guide-v1",
          bundleSha256: hash,
        },
      });
      const capability = ProductCapabilityManifest.make({
        version: 1,
        id: "product.sdk.status",
        name: "Read status",
        description: "Read bounded SDK status.",
        operationIds: ["sdk.status"],
        resourceIds: ["sdk.workspace"],
        dataClassIds: ["sdk.status"],
        confirmationPolicies: ["once", "session", "workspace", "persistent"],
      });
      const http = ProductHttpPolicy.make({
        id: "sdk.http.status",
        origin: "https://api.example.test",
        pathPrefix: "/v1/",
        methods: ["GET"],
        requestHeaders: [],
        responseHeaders: ["content-type"],
        requestBytes: 0,
        responseBytes: 65_536,
        deadlineMs: 5_000,
      });
      const graphql = ProductGraphqlPolicy.make({
        version: 1,
        id: "sdk.graphql.status",
        endpoint: "https://api.example.test/graphql",
        operationId: "sdk.status",
        operationName: "SdkStatus",
        operationType: "query",
        documentSha256: hash,
        requestBytes: 16_384,
        responseBytes: 65_536,
        deadlineMs: 5_000,
      });
      const events = ProductEventPolicy.make({
        version: 1,
        id: "sdk.events.status",
        operationId: "sdk.status.watch",
        bufferCapacity: 8,
        eventBytes: 16_384,
        reconnectAttempts: 2,
        reconnectDelayMs: 250,
        sequenceResume: true,
      });

      assert.strictEqual(capsule.id, "dev.flect.sdk-fixture");
      assert.strictEqual(extension.roles[0], "shaper");
      assert.strictEqual(capability.id, "product.sdk.status");
      assert.strictEqual(http.origin, "https://api.example.test");
      assert.strictEqual(graphql.operationName, "SdkStatus");
      assert.strictEqual(events.bufferCapacity, 8);
    }),
  );

  it.effect("rejects excess authority through the public barrel", () =>
    Schema.decodeUnknownEffect(
      ProductHttpPolicy,
      strict,
    )({
      id: "sdk.http.status",
      origin: "https://api.example.test",
      pathPrefix: "/v1/",
      methods: ["GET"],
      requestHeaders: [],
      responseHeaders: [],
      requestBytes: 0,
      responseBytes: 65_536,
      deadlineMs: 5_000,
      arbitraryUrl: true,
    }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => assert.strictEqual(error._tag, "SchemaError")),
      ),
    ),
  );
});
