import { Effect } from "effect";
import { encodeCapsule } from "../../shared/capsule";

const encoder = new TextEncoder();

export const REFERENCE_APP_AGENT_INSTRUCTIONS = `Operate this product only through its named Flect operations:
- reference.status reads the offline product status.
- reference.projects.list reads projects for reference-workspace.
- reference.projects.archive archives project alpha only after explicit user authority.
- reference.projects.subscribe watches bounded ordered project status events.
Never request a URL, GraphQL document, credential, cookie, socket, or raw transport.`;

const extensionSource = encoder.encode("() => []");

const sha256 = (value: Uint8Array) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from(value),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  });

export const referenceProductCapsule = Effect.gen(function* () {
  const bundleSha256 = yield* sha256(extensionSource);
  return yield* encodeCapsule({
    manifest: {
      formatVersion: 1,
      id: "dev.flect.reference-product",
      name: "Flect reference product",
      version: "1.0.0",
      entrypoints: [{ id: "main", path: "ui/index.html" }],
      capabilities: [
        { id: "product.reference.status", required: true },
        { id: "product.reference.projects.read", required: true },
        { id: "product.reference.projects.write", required: false },
        { id: "product.reference.projects.events", required: false },
      ],
      extensions: [
        {
          formatVersion: 1,
          id: "reference-product-guide",
          name: "Reference product guide",
          description: "Gives App Agent the public named-operation contract.",
          version: "1.0.0",
          bundle: "extensions/reference-product-guide.mjs",
          roles: ["app"],
          compatibility: {
            flect: ">=0.2.0 <1.0.0",
            extensionApi: 1,
            platforms: ["browser", "macos"],
          },
          capabilities: [],
          publicInstructions: REFERENCE_APP_AGENT_INSTRUCTIONS,
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
            revision: "reference-product-v1",
            bundleSha256,
          },
        },
      ],
      compatibility: {
        flect: ">=0.2.0 <1.0.0",
        schemaVersion: 1,
        platforms: ["browser", "macos"],
      },
      provenance: {
        publisher: "akua-dev",
        source: "https://github.com/akua-dev/flect",
        revision: "reference-product-v1",
        builder: "flect-reference-product",
      },
      signatures: [],
    },
    files: [
      {
        path: "ui/index.html",
        contents: encoder.encode(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reference projects</title></head>
  <body>
    <main data-reference-product>
      <p>Reference workspace</p>
      <h1>Projects</h1>
      <article data-project-id="alpha"><strong>Alpha</strong><span>Active</span></article>
    </main>
  </body>
</html>`),
      },
      {
        path: "extensions/reference-product-guide.mjs",
        contents: extensionSource,
      },
    ],
  });
});
