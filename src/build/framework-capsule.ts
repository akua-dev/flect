import { Effect, Schema } from "effect";
import packageMetadata from "../../package.json";
import type { BrowserBuildArtifact } from "../../shared/browser-build";
import {
  decodeCapsule,
  encodeCapsule,
  type InvalidCapsule,
} from "../../shared/capsule";
import { PROJECT_IMPORT_REPORT_PATH } from "../../shared/project-import";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

export class FrameworkCapsuleFailure extends Schema.TaggedErrorClass<FrameworkCapsuleFailure>()(
  "FrameworkCapsuleFailure",
  { message: Schema.String },
) {}

const failure = (message: string) => FrameworkCapsuleFailure.make({ message });

const portableHtml = (
  source: string,
  hasCss: boolean,
  hasJavaScript: boolean,
) => {
  const withoutScripts = source.replace(
    /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
    "",
  );
  const withoutStylesheets = withoutScripts.replace(
    /<link\b(?=[^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'])[^>]*>/gi,
    "",
  );
  const styles = hasCss ? '<link rel="stylesheet" href="./app.css">' : "";
  const script = hasJavaScript ? '<script src="./app.js"></script>' : "";
  const withStyles = /<\/head\s*>/i.test(withoutStylesheets)
    ? withoutStylesheets.replace(/<\/head\s*>/i, `${styles}</head>`)
    : `${styles}${withoutStylesheets}`;
  return /<\/body\s*>/i.test(withStyles)
    ? withStyles.replace(/<\/body\s*>/i, `${script}</body>`)
    : `${withStyles}${script}`;
};

export const buildFrameworkCapsule = Effect.fn("Flect.FrameworkCapsule.build")(
  function* ({
    sourceArchive,
    artifact,
  }: {
    readonly sourceArchive: Uint8Array;
    readonly artifact: BrowserBuildArtifact;
  }) {
    const source = yield* decodeCapsule(sourceArchive).pipe(
      Effect.mapError(() =>
        failure("The imported project capsule is invalid."),
      ),
    );
    const sourceHtml = source.manifest.entrypoints.find(
      (entrypoint) => entrypoint.id === "source-html",
    );
    const htmlFile = source.files.find(
      (file) => file.path === sourceHtml?.path,
    );
    if (sourceHtml === undefined || htmlFile === undefined) {
      return yield* Effect.fail(
        failure("The imported project has no portable HTML shell."),
      );
    }
    const html = yield* Effect.try({
      try: () => decoder.decode(htmlFile.contents),
      catch: () => failure("The imported project HTML is invalid."),
    });
    const report = source.files.find(
      (file) => file.path === PROJECT_IMPORT_REPORT_PATH,
    );
    const hasCss = artifact.outputs.some((output) => output.path === "app.css");
    const hasJavaScript = artifact.outputs.some(
      (output) => output.path === "app.js",
    );
    if (!hasJavaScript) {
      return yield* Effect.fail(
        failure(
          "The verified browser build emitted no application entrypoint.",
        ),
      );
    }
    return yield* encodeCapsule({
      manifest: {
        formatVersion: 1,
        id: source.manifest.id,
        name: source.manifest.name,
        version: source.manifest.version,
        entrypoints: [{ id: "compiled-web", path: "index.html" }],
        capabilities: [...source.manifest.capabilities],
        compatibility: source.manifest.compatibility,
        provenance: {
          ...source.manifest.provenance,
          revision: artifact.sourceRevision,
          builder: `flect@${packageMetadata.version}+rolldown-browser-1.2.1`,
        },
        build: {
          sourceRevision: artifact.sourceRevision,
          inputDigest: artifact.inputDigest,
          artifactDigest: artifact.artifactDigest,
          ...(artifact.dependencyGraphDigest === undefined
            ? {}
            : { dependencyGraphDigest: artifact.dependencyGraphDigest }),
        },
        signatures: [],
      },
      files: [
        {
          path: "index.html",
          contents: encoder.encode(portableHtml(html, hasCss, hasJavaScript)),
        },
        ...artifact.outputs.map((output) => ({
          path: output.path,
          contents: output.contents,
        })),
        ...(report === undefined
          ? []
          : [{ path: report.path, contents: report.contents }]),
      ],
    }).pipe(
      Effect.mapError((error: InvalidCapsule) =>
        failure(error.message || "The verified build could not be packaged."),
      ),
    );
  },
);
