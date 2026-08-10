/// <reference lib="webworker" />

import { Effect, Schema, type SchemaAST } from "effect";
import {
  BrowserBuildArtifact,
  BrowserBuildFailure,
  BrowserBuildFailureFrame,
  BrowserBuildOutput,
  BrowserBuildWorkerFailure,
  BrowserBuildWorkerRequest,
  BrowserBuildWorkerSuccess,
} from "../../shared/browser-build";
import { digestBuildEntries } from "./browser-build-digest";
import { transformFrameworkSource } from "./framework-source-transform";
import {
  collectRestrictedCss,
  resolveRestrictedCssImport,
} from "./restricted-css";

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BUILD_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_FILES = 256;
const encoder = new TextEncoder();
const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const decodeRequest = Schema.decodeUnknownEffect(
  BrowserBuildWorkerRequest,
  strictOptions,
);

const buildFailure = (
  buildId: string,
  reason: BrowserBuildFailure["reason"],
  message: string,
) => BrowserBuildFailure.make({ buildId, reason, message });

const validatePath = (path: string) => {
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    return undefined;
  }
  return parts.join("/");
};

const bytes = (value: string | Uint8Array) =>
  typeof value === "string" ? encoder.encode(value) : value;

const mkdirParents = (
  path: string,
  activeMemfs: { readonly fs: { readonly mkdirSync: (path: string) => void } },
) => {
  const parts = path.split("/").slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    try {
      activeMemfs.fs.mkdirSync(current);
    } catch {}
  }
};

const compile = (request: BrowserBuildWorkerRequest["request"]) =>
  Effect.tryPromise({
    try: async () => {
      const [{ rolldown }, { memfs }] = await Promise.all([
        import("@rolldown/browser"),
        import("@rolldown/browser/experimental"),
      ]);
      if (memfs === undefined) {
        throw buildFailure(
          request.buildId,
          "unsupported",
          "This browser cannot provide Rolldown's isolated build filesystem.",
        );
      }

      const seen = new Set<string>();
      let inputBytes = 0;
      const files = request.files.map((file) => {
        const path = validatePath(file.path);
        if (path === undefined || seen.has(path)) {
          throw buildFailure(
            request.buildId,
            "invalid-input",
            "The restricted build received an invalid or duplicate source path.",
          );
        }
        seen.add(path);
        if (file.contents.byteLength > MAX_FILE_BYTES) {
          throw buildFailure(
            request.buildId,
            "oversized",
            "A restricted build input exceeds the per-file size limit.",
          );
        }
        inputBytes += file.contents.byteLength;
        return { path, contents: file.contents };
      });
      if (inputBytes > MAX_BUILD_BYTES) {
        throw buildFailure(
          request.buildId,
          "oversized",
          "The restricted build input exceeds the total size limit.",
        );
      }
      const entrypoint = validatePath(request.entrypoint);
      if (entrypoint === undefined || !seen.has(entrypoint)) {
        throw buildFailure(
          request.buildId,
          "invalid-input",
          "The restricted build entrypoint is not one of its source files.",
        );
      }

      const root = `/flect/${request.buildId}`;
      const frameworkModules = new Map<string, string>();
      const frameworkStyles: Array<string> = [];
      for (const file of files) {
        const absolute = `${root}/${file.path}`;
        mkdirParents(absolute, memfs);
        memfs.fs.writeFileSync(absolute, file.contents);
        const transformed = await transformFrameworkSource(
          file.path,
          file.contents,
        );
        if (transformed !== undefined) {
          frameworkModules.set(absolute, transformed.code);
          if (transformed.css.length > 0) {
            frameworkStyles.push(transformed.css);
          }
        }
      }

      const inputDigest = await digestBuildEntries(files);
      const absoluteFiles = new Set(
        files.map((file) => `${root}/${file.path}`),
      );
      const cssPrefix = "\0flect-css:";
      const bundle = await rolldown({
        cwd: root,
        input: entrypoint,
        platform: "browser",
        plugins: [
          {
            name: "flect-restricted-css",
            resolveId(source, importer) {
              const resolved = resolveRestrictedCssImport(
                source,
                importer,
                root,
                absoluteFiles,
              );
              return resolved === undefined ? null : `${cssPrefix}${resolved}`;
            },
            load(id) {
              if (id.startsWith(cssPrefix)) {
                return { code: "export {};", moduleType: "js" };
              }
              const transformed = frameworkModules.get(id);
              return transformed === undefined
                ? null
                : { code: transformed, moduleType: "js" };
            },
          },
        ],
        transform: {
          define: { "process.env.NODE_ENV": '"production"' },
          jsx: "react-jsx",
        },
      });
      try {
        const generated = await bundle.generate({
          format: "iife",
          name: "FlectApp",
          codeSplitting: false,
          entryFileNames: "app.js",
          assetFileNames: "assets/[name]-[hash][extname]",
          minify: true,
          sourcemap: false,
        });
        if (
          generated.output.length === 0 ||
          generated.output.length > MAX_OUTPUT_FILES
        ) {
          throw buildFailure(
            request.buildId,
            "oversized",
            "The restricted build emitted an unsupported number of files.",
          );
        }
        let outputBytes = 0;
        const outputs = generated.output.map((output) => {
          const path = validatePath(output.fileName);
          if (path === undefined) {
            throw buildFailure(
              request.buildId,
              "invalid-result",
              "The restricted build emitted an invalid output path.",
            );
          }
          const contents =
            output.type === "chunk"
              ? encoder.encode(output.code)
              : bytes(output.source);
          outputBytes += contents.byteLength;
          if (
            contents.byteLength > MAX_FILE_BYTES ||
            outputBytes > MAX_BUILD_BYTES
          ) {
            throw buildFailure(
              request.buildId,
              "oversized",
              "The restricted build output exceeds its size limit.",
            );
          }
          return BrowserBuildOutput.make({
            path,
            kind: output.type,
            contents,
          });
        });
        const restrictedCss = collectRestrictedCss(files);
        const frameworkCss = encoder.encode(frameworkStyles.join("\n"));
        const css = new Uint8Array(
          restrictedCss.byteLength + frameworkCss.byteLength,
        );
        css.set(restrictedCss);
        css.set(frameworkCss, restrictedCss.byteLength);
        if (css.byteLength > 0) {
          outputBytes += css.byteLength;
          if (outputBytes > MAX_BUILD_BYTES) {
            throw buildFailure(
              request.buildId,
              "oversized",
              "The restricted build output exceeds its size limit.",
            );
          }
          outputs.push(
            BrowserBuildOutput.make({
              path: "app.css",
              kind: "asset",
              contents: css,
            }),
          );
        }
        const artifactDigest = await digestBuildEntries(outputs);
        return BrowserBuildArtifact.make({
          version: 1,
          buildId: request.buildId,
          sourceRevision: request.sourceRevision,
          ...(request.dependencyGraphDigest === undefined
            ? {}
            : { dependencyGraphDigest: request.dependencyGraphDigest }),
          inputDigest,
          artifactDigest,
          outputs,
        });
      } finally {
        await bundle.close();
      }
    },
    catch: (error) => {
      if (Schema.is(BrowserBuildFailure)(error)) {
        return error;
      }
      const detail =
        error instanceof Error
          ? error.message
              .replaceAll(/\/flect\/build-[^/\s]+\//g, "")
              .slice(0, 360)
          : "Unknown compiler failure.";
      return buildFailure(
        request.buildId,
        "compile",
        `The restricted browser build did not compile: ${detail}`.slice(0, 500),
      );
    },
  });

worker.addEventListener("message", (event: MessageEvent<unknown>) => {
  const fallbackId =
    typeof event.data === "object" &&
    event.data !== null &&
    "id" in event.data &&
    typeof event.data.id === "string" &&
    /^request-[a-z0-9]+$/.test(event.data.id)
      ? event.data.id
      : "request-invalid";
  const fallbackBuildId =
    typeof event.data === "object" &&
    event.data !== null &&
    "request" in event.data &&
    typeof event.data.request === "object" &&
    event.data.request !== null &&
    "buildId" in event.data.request &&
    typeof event.data.request.buildId === "string" &&
    /^build-[a-z0-9-]+$/.test(event.data.request.buildId)
      ? event.data.request.buildId
      : "build-invalid";

  void Effect.runPromise(
    decodeRequest(event.data).pipe(
      Effect.mapError(() =>
        buildFailure(
          fallbackBuildId,
          "invalid-input",
          "The restricted browser build request was invalid.",
        ),
      ),
      Effect.flatMap((request) =>
        compile(request.request).pipe(
          Effect.map((artifact) =>
            BrowserBuildWorkerSuccess.make({
              type: "success",
              id: request.id,
              artifact,
            }),
          ),
        ),
      ),
      Effect.catch((error) =>
        Effect.succeed(
          BrowserBuildWorkerFailure.make({
            type: "failure",
            id: fallbackId,
            error: BrowserBuildFailureFrame.make(error),
          }),
        ),
      ),
    ),
  ).then((response) => worker.postMessage(response));
});
