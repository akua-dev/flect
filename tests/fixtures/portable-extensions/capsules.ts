import { Effect } from "effect";
import { encodeCapsule } from "../../../shared/capsule";
import type {
  ExtensionCapability,
  PortableExtensionRole,
} from "../../../shared/extensions";

export type PortableExtensionFixtureVariant =
  | "noop"
  | "propose"
  | "broken"
  | "network"
  | "storage"
  | "credential"
  | "flood"
  | "loop"
  | "memory"
  | "oversized";

export interface PortableExtensionCapsuleOptions {
  readonly capsuleVersion?: string;
  readonly extensionVersion?: string;
  readonly extensionId?: string;
  readonly roles?: ReadonlyArray<PortableExtensionRole>;
  readonly requiredCapabilities?: ReadonlyArray<ExtensionCapability>;
  readonly optionalCapabilities?: ReadonlyArray<ExtensionCapability>;
  readonly compatible?: boolean;
  readonly variant?: PortableExtensionFixtureVariant;
}

const sourceFor = (variant: PortableExtensionFixtureVariant) => {
  switch (variant) {
    case "noop":
      return "() => []";
    case "propose":
      return "() => ({ type: 'set-text', target: 'headline', text: 'Portable extension applied' })";
    case "broken":
      return "() => { throw new Error('fixture-private-detail') }";
    case "network":
      return "() => fetch('https://extension.invalid/private')";
    case "storage":
      return "() => localStorage.getItem('fixture-private-key')";
    case "credential":
      return "() => process.env.FLECT_FIXTURE_SECRET";
    case "flood":
      return "() => Array.from({ length: 21 }, (_, index) => ({ type: 'set-text', target: 'headline', text: String(index) }))";
    case "loop":
      return "() => { while (true) {} }";
    case "memory":
      return "() => { const values = []; while (true) values.push('x'.repeat(65536)) }";
    case "oversized":
      return `() => [] /* ${"x".repeat(257 * 1024)} */`;
  }
};

const sha256 = async (value: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const portableExtensionCapsule = async (
  options: PortableExtensionCapsuleOptions = {},
) => {
  const capsuleVersion = options.capsuleVersion ?? "1.0.0";
  const extensionVersion = options.extensionVersion ?? capsuleVersion;
  const extensionId = options.extensionId ?? "project-guide";
  const roles = options.roles ?? ["app", "shaper"];
  const variant = options.variant ?? "noop";
  const requiredCapabilities = options.requiredCapabilities ?? [
    "interface:read",
  ];
  const optionalCapabilities = options.optionalCapabilities ?? [
    "interface:propose",
  ];
  const source = new TextEncoder().encode(sourceFor(variant));
  const bundle = `extensions/${extensionId}.mjs`;
  const html = new TextEncoder().encode(
    "<!doctype html><html><body><main><h1>Portable product</h1><p>Accepted baseline remains visible.</p></main></body></html>",
  );

  return Effect.runPromise(
    encodeCapsule({
      manifest: {
        formatVersion: 1,
        id: "dev.akua.portable-product",
        name: "Portable product",
        version: capsuleVersion,
        entrypoints: [{ id: "main", path: "ui/index.html" }],
        capabilities: [],
        extensions: [
          {
            formatVersion: 1,
            id: extensionId,
            name: "Project guide",
            description: "Adds a bounded project summary command.",
            version: extensionVersion,
            bundle,
            roles: [...roles],
            compatibility: {
              flect: options.compatible === false ? "<0.2.0" : ">=0.2.0 <1.0.0",
              extensionApi: 1,
              platforms: ["browser", "macos"],
            },
            capabilities: [
              ...requiredCapabilities.map((id) => ({ id, required: true })),
              ...optionalCapabilities
                .filter((id) => !requiredCapabilities.includes(id))
                .map((id) => ({ id, required: false })),
            ],
            publicInstructions:
              "Use only when asked for a bounded public project summary.",
            commands: [
              {
                id: "summary",
                name: "Summary",
                description: "Summarize the current public interface.",
              },
            ],
            tools: [],
            resources: {
              deadlineMs: 100,
              memoryBytes: 16 * 1024 * 1024,
              inputBytes: 1024 * 1024,
              outputBytes: 1024 * 1024,
              maxIntents: 20,
            },
            provenance: {
              publisher: "akua-dev",
              source: "https://github.com/akua-dev/flect-fixtures",
              revision: `fixture-${extensionVersion}-${variant}`,
              bundleSha256: await sha256(source),
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
          source: "https://github.com/akua-dev/flect-fixtures",
          revision: `fixture-${capsuleVersion}-${variant}`,
          builder: "flect-test",
        },
        signatures: [],
      },
      files: [
        { path: "ui/index.html", contents: html },
        { path: bundle, contents: source },
      ],
    }),
  );
};
