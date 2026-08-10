import { Effect, Schema } from "effect";
import packageMetadata from "../../package.json";
import { encodeCapsule, MAX_CAPSULE_BYTES } from "../../shared/capsule";
import {
  PROJECT_IMPORT_REPORT_PATH,
  ProjectImportReport,
} from "../../shared/project-import";

const MAX_PROJECT_FILES = 255;
const MAX_PROJECT_PATH_LENGTH = 100;

export interface WebProjectFile {
  readonly path: string;
  readonly contents: Uint8Array;
}

export type WebProjectImportReport = ProjectImportReport;

export class WebProjectImportFailure extends Schema.TaggedErrorClass<WebProjectImportFailure>()(
  "WebProjectImportFailure",
  { message: Schema.String },
) {}

const failure = (message: string) => WebProjectImportFailure.make({ message });

const validatePath = (path: string) => {
  const parts = path.split("/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new Error("unsafe project path");
  }
  return parts;
};

const secretFile = (name: string) =>
  name === ".env" ||
  name.startsWith(".env.") ||
  [".npmrc", ".pypirc", "id_rsa", "id_ed25519"].includes(name) ||
  /\.(?:key|pem|p12|pfx)$/i.test(name);

export const shouldAvoidReadingWebProjectFile = (path: string) => {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  return (
    parts.some((part) => part === ".git" || part === "node_modules") ||
    name === ".DS_Store" ||
    secretFile(name)
  );
};

const compatibility = (
  files: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>,
  moduleGraphSupported: boolean,
) => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const source = files
    .filter((file) => /\.(?:html?|css|js|mjs)$/i.test(file.path))
    .flatMap((file) => {
      try {
        return [decoder.decode(file.contents)];
      } catch {
        return [];
      }
    })
    .join("\n");
  const findings = [
    {
      found: /<form\b/i.test(source),
      capability: { id: "web:forms", required: false },
      warning:
        "Forms are contained and cannot submit from the isolated preview.",
    },
    {
      found:
        (!moduleGraphSupported &&
          /<script\b[^>]*\btype\s*=\s*["']?module\b/i.test(source)) ||
        (!moduleGraphSupported &&
          /\b(?:import|export)\s+(?:[^('"`]|$)/m.test(source)),
      capability: { id: "web:module-graph", required: true },
      warning: "Module graphs require a framework-compatible build adapter.",
    },
    {
      found: /(?:https?:)?\/\//i.test(source),
      capability: { id: "web:remote-network", required: true },
      warning: "Remote URLs require an explicit product network capability.",
    },
    {
      found: /\b(?:localStorage|sessionStorage|indexedDB)\b/.test(source),
      capability: { id: "web:storage", required: true },
      warning: "Web storage is unavailable to opaque compiled capsules.",
    },
    {
      found: /\b(?:Worker|SharedWorker|serviceWorker)\b/.test(source),
      capability: { id: "web:workers", required: true },
      warning: "Workers are unavailable to opaque compiled capsules.",
    },
  ].filter((finding) => finding.found);
  return {
    capabilities: findings.map((finding) => finding.capability),
    warnings: findings.map((finding) => finding.warning),
  };
};

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dependencyNames = (manifest: Readonly<Record<string, unknown>>) =>
  ["dependencies", "devDependencies", "optionalDependencies"].flatMap(
    (field) => {
      const value = manifest[field];
      return record(value)
        ? Object.entries(value).flatMap(([name, version]) =>
            typeof version === "string" ? [name] : [],
          )
        : [];
    },
  );

const decodePackageManifest = (
  files: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>,
) => {
  const source = files.find((file) => file.path === "package.json");
  if (source === undefined) return undefined;
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(source.contents),
  );
  if (!record(value)) throw new Error("invalid package manifest");
  return value;
};

const moduleEntrypoint = (
  html: string,
  files: ReadonlyArray<{ readonly path: string }>,
) => {
  const match = html.match(
    /<script\b(?=[^>]*\btype\s*=\s*["']module["'])(?=[^>]*\bsrc\s*=\s*["']([^"']+)["'])[^>]*>/i,
  );
  const reference = match?.[1]?.split(/[?#]/, 1)[0];
  if (
    reference === undefined ||
    reference.length === 0 ||
    reference.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(reference)
  ) {
    return undefined;
  }
  const path = reference.replace(/^\.\//, "").replace(/^\//, "");
  return files.some((file) => file.path === path) ? path : undefined;
};

const supportedVitePlugins = new Set([
  "@vitejs/plugin-react",
  "@vitejs/plugin-react-swc",
]);

const unsupportedVitePlugin = (dependencies: ReadonlyArray<string>) =>
  dependencies.find(
    (name) =>
      (name.startsWith("vite-plugin-") || /^@[^/]+\/vite-plugin-/.test(name)) &&
      !supportedVitePlugins.has(name),
  );

const textFile = (
  file: { readonly path: string; readonly contents: Uint8Array },
  decoder: TextDecoder,
) => {
  try {
    return decoder.decode(file.contents);
  } catch {
    return undefined;
  }
};

const unsupportedViteConfiguration = (
  files: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>,
) => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const config = files.find((file) =>
    /^vite\.config\.(?:[cm]?[jt]s)$/i.test(file.path),
  );
  const configSource =
    config === undefined ? undefined : textFile(config, decoder);
  if (
    configSource !== undefined &&
    /\bresolve\s*:\s*\{[\s\S]{0,2000}?\balias\s*:/m.test(configSource)
  ) {
    return "Vite resolve.alias is not executed by Flect's portable compiler. Replace aliases with relative imports before importing.";
  }

  for (const file of files.filter((candidate) =>
    /\.(?:[cm]?[jt]sx?)$/i.test(candidate.path),
  )) {
    const source = textFile(file, decoder);
    const nodeImport = source?.match(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](node:[^"']+)["']/m,
    )?.[1];
    if (nodeImport !== undefined) {
      return `${nodeImport} is a Node built-in and is unavailable in Flect's browser build. Replace it with a browser API or an explicit typed product capability.`;
    }
  }
  return undefined;
};

const projectName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "web-project";

export const importWebProject = Effect.fn("Flect.WebProject.import")(function* (
  input: ReadonlyArray<WebProjectFile>,
) {
  if (input.length === 0) {
    return yield* Effect.fail(failure("Choose a web project folder."));
  }
  const parsed = yield* Effect.try({
    try: () => input.map((file) => ({ file, parts: validatePath(file.path) })),
    catch: () => failure("The project contains an unsafe path."),
  });
  const firstRoot = parsed[0]?.parts[0] ?? "web-project";
  const stripRoot = parsed.every(
    ({ parts }) => parts.length > 1 && parts[0] === firstRoot,
  );
  const normalized = parsed.map(({ file, parts }) => {
    const relativeParts = stripRoot ? parts.slice(1) : parts;
    return {
      path: relativeParts.join("/"),
      contents: file.contents,
      ignored: shouldAvoidReadingWebProjectFile(relativeParts.join("/")),
    };
  });
  const included = normalized.filter((file) => !file.ignored);
  const ignoredFiles = normalized
    .filter((file) => file.ignored)
    .map((file) => file.path)
    .toSorted();
  const tooLongPath = included.find(
    (file) => file.path.length > MAX_PROJECT_PATH_LENGTH,
  );
  if (tooLongPath !== undefined) {
    return yield* Effect.fail(
      failure(
        `The project path ${tooLongPath.path} exceeds the portable 100 characters limit. Shorten it before importing.`,
      ),
    );
  }
  if (included.some((file) => file.path === PROJECT_IMPORT_REPORT_PATH)) {
    return yield* Effect.fail(
      failure(
        `${PROJECT_IMPORT_REPORT_PATH} is reserved for Flect import metadata. Rename the source file before importing.`,
      ),
    );
  }
  const bytes = included.reduce(
    (total, file) => total + file.contents.byteLength,
    0,
  );
  if (
    included.length === 0 ||
    included.length > MAX_PROJECT_FILES ||
    bytes > MAX_CAPSULE_BYTES
  ) {
    return yield* Effect.fail(
      failure(
        "The project exceeds the 255 source files or 32 MiB import limit.",
      ),
    );
  }
  const entrypoints = included.filter(
    (file) => file.path.toLowerCase() === "index.html",
  );
  if (entrypoints.length !== 1) {
    return yield* Effect.fail(
      failure(
        "Choose a single project folder with one index.html at its root.",
      ),
    );
  }
  const html = yield* Effect.try({
    try: () =>
      new TextDecoder("utf-8", { fatal: true }).decode(
        entrypoints[0]?.contents ?? new Uint8Array(),
      ),
    catch: () => failure("The project index.html is not valid UTF-8."),
  });
  const manifest = yield* Effect.try({
    try: () => decodePackageManifest(included),
    catch: () => failure("The project package.json is invalid."),
  });
  const dependencies = manifest === undefined ? [] : dependencyNames(manifest);
  const unsupportedPlugin = unsupportedVitePlugin(dependencies);
  if (unsupportedPlugin !== undefined) {
    return yield* Effect.fail(
      failure(
        `${unsupportedPlugin} requires Vite plugin execution and cannot enter Flect's portable build. Remove it or precompile that behavior before importing.`,
      ),
    );
  }
  const unsupportedConfiguration = unsupportedViteConfiguration(included);
  if (unsupportedConfiguration !== undefined) {
    return yield* Effect.fail(failure(unsupportedConfiguration));
  }
  const sourceEntrypoint = moduleEntrypoint(html, included);
  const kind =
    sourceEntrypoint === undefined
      ? ("static-html" as const)
      : dependencies.includes("react") || dependencies.includes("react-dom")
        ? ("vite-react" as const)
        : ("vite" as const);
  const name = projectName(stripRoot ? firstRoot : "web-project");
  const compatibilityReport = compatibility(
    included,
    sourceEntrypoint !== undefined,
  );
  const adaptations =
    sourceEntrypoint === undefined
      ? []
      : [
          "Flect uses its restricted browser compiler instead of executing Vite config or package scripts.",
          ...(manifest !== undefined && record(manifest.devDependencies)
            ? [
                "Development dependencies are preserved in source but excluded from the portable acceptance build.",
              ]
            : []),
        ];
  const report = ProjectImportReport.make({
    version: 1,
    kind,
    name: stripRoot ? firstRoot : "web-project",
    entrypoint: sourceEntrypoint ?? "index.html",
    includedFiles: included.length,
    ignoredFiles,
    adaptations,
    warnings: compatibilityReport.warnings,
  });
  const archive = yield* encodeCapsule({
    manifest: {
      formatVersion: 1,
      id: `local.flect.${name}`,
      name: stripRoot ? firstRoot.slice(0, 80) : "Web project",
      version: "1.0.0",
      entrypoints: [
        ...(sourceEntrypoint === undefined
          ? [{ id: "plain-web", path: "index.html" }]
          : [
              { id: "browser-source", path: sourceEntrypoint },
              { id: "source-html", path: "index.html" },
            ]),
      ],
      capabilities: compatibilityReport.capabilities,
      compatibility: {
        flect: `>=${packageMetadata.version} <1.0.0`,
        schemaVersion: 1,
        platforms: ["browser", "macos", "windows", "linux"],
      },
      provenance: {
        publisher: "local-user",
        source: "local-directory-import",
        revision: "unversioned",
        builder: `flect@${packageMetadata.version}`,
      },
      signatures: [],
    },
    files: [
      ...included.map(({ path, contents }) => ({ path, contents })),
      {
        path: PROJECT_IMPORT_REPORT_PATH,
        contents: new TextEncoder().encode(JSON.stringify(report)),
      },
    ],
  }).pipe(
    Effect.mapError(() => failure("The web project could not be packaged.")),
  );
  return {
    archive,
    report,
  };
});
