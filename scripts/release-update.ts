import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { Effect, Schema } from "effect";

export class UpdaterEvidenceError extends Schema.TaggedErrorClass<UpdaterEvidenceError>()(
  "UpdaterEvidenceError",
  {
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(300),
    ),
  },
) {}

const evidenceError = (message: string) =>
  UpdaterEvidenceError.make({ message });

export interface UpdaterEvidenceInput {
  readonly mode: "development" | "public";
  readonly version: string;
  readonly target?: string;
  readonly publicKey?: string;
  readonly privateKeyConfigured?: boolean;
  readonly archivePath?: string;
  readonly signaturePath?: string;
  readonly artifactUrl?: string;
}

export type UpdaterEvidence =
  | { readonly available: false; readonly reason: "development" }
  | {
      readonly available: true;
      readonly target: "darwin-aarch64";
      readonly artifactUrl: string;
      readonly archiveSha256: string;
      readonly publicKeySha256: string;
      readonly signature: string;
    };

export const validateUpdaterArchiveEntries = Effect.fn(
  "Flect.Updater.validateArchiveEntries",
)(function* (source: string) {
  const entries = source
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (
    entries.length === 0 ||
    entries.some(
      (entry) =>
        entry.startsWith("/") ||
        entry.split("/").includes("..") ||
        (entry !== "Flect.app" && !entry.startsWith("Flect.app/")),
    ) ||
    !entries.includes("Flect.app/Contents/MacOS/flect") ||
    !entries.includes("Flect.app/Contents/MacOS/flect-runtime") ||
    entries.some(
      (entry) => entry.endsWith("/flectctl") || entry.endsWith("/flect-mcp"),
    )
  ) {
    return yield* Effect.fail(
      evidenceError("The updater archive inventory is invalid."),
    );
  }
});

const sha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

const decodeEnvelope = (value: string) => {
  const normalized = value.trim();
  const decoded = Buffer.from(normalized, "base64");
  return decoded.length === 0 || decoded.toString("base64") !== normalized
    ? undefined
    : decoded.toString("utf8");
};

const verifyMinisign = (
  archive: Uint8Array,
  encodedPublicKey: string,
  encodedSignature: string,
) => {
  const publicSource = decodeEnvelope(encodedPublicKey);
  const signatureSource = decodeEnvelope(encodedSignature);
  if (publicSource === undefined || signatureSource === undefined) return false;
  const publicLines = publicSource.trim().split(/\r?\n/u);
  const signatureLines = signatureSource.trim().split(/\r?\n/u);
  if (publicLines.length !== 2 || signatureLines.length !== 4) return false;
  const publicRecord = Buffer.from(publicLines[1] ?? "", "base64");
  const signatureRecord = Buffer.from(signatureLines[1] ?? "", "base64");
  const globalSignature = Buffer.from(signatureLines[3] ?? "", "base64");
  const trustedComment = signatureLines[2];
  if (
    publicRecord.length !== 42 ||
    signatureRecord.length !== 74 ||
    globalSignature.length !== 64 ||
    trustedComment?.startsWith("trusted comment: ") !== true ||
    !publicRecord.subarray(2, 10).equals(signatureRecord.subarray(2, 10))
  ) {
    return false;
  }
  const algorithm = signatureRecord.subarray(0, 2).toString("ascii");
  if (algorithm !== "ED" && algorithm !== "Ed") return false;
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    publicRecord.subarray(10, 42),
  ]);
  const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  const payload =
    algorithm === "ED"
      ? createHash("blake2b512").update(archive).digest()
      : archive;
  const artifactSignature = signatureRecord.subarray(10, 74);
  const globalPayload = Buffer.concat([
    artifactSignature,
    Buffer.from(trustedComment.slice("trusted comment: ".length)),
  ]);
  return (
    verify(null, payload, publicKey, artifactSignature) &&
    verify(null, globalPayload, publicKey, globalSignature)
  );
};

const requiredFile = Effect.fn("Flect.Updater.requiredFile")(
  (path: string | undefined, kind: "archive" | "signature") =>
    path === undefined
      ? Effect.fail(evidenceError(`The updater ${kind} is missing.`))
      : Effect.tryPromise({
          try: async () => {
            const entry = await stat(path);
            if (!entry.isFile() || entry.size === 0) {
              throw new Error("not a non-empty file");
            }
            return path;
          },
          catch: () => evidenceError(`The updater ${kind} is missing.`),
        }),
);

export const validateUpdaterEvidence = Effect.fn(
  "Flect.Updater.validateEvidence",
)(function* (input: UpdaterEvidenceInput) {
  if (input.mode === "development") {
    return {
      available: false,
      reason: "development",
    } satisfies UpdaterEvidence;
  }
  const publicKey = input.publicKey?.trim();
  if (publicKey === undefined || publicKey.length === 0) {
    return yield* Effect.fail(
      evidenceError("A public release requires a public update key."),
    );
  }
  if (input.privateKeyConfigured !== true) {
    return yield* Effect.fail(
      evidenceError("A public release requires a private signing key."),
    );
  }
  if (input.target !== "darwin-aarch64") {
    return yield* Effect.fail(
      evidenceError("The updater target must be darwin-aarch64."),
    );
  }
  const expectedUrl = `https://github.com/akua-dev/flect/releases/download/v${input.version}/Flect.app.tar.gz`;
  if (input.artifactUrl !== expectedUrl) {
    return yield* Effect.fail(
      evidenceError(
        "The updater artifact must use the fixed HTTPS release URL.",
      ),
    );
  }
  const archivePath = yield* requiredFile(input.archivePath, "archive");
  const signaturePath = yield* requiredFile(input.signaturePath, "signature");
  const [archive, signatureSource] = yield* Effect.tryPromise({
    try: () =>
      Promise.all([readFile(archivePath), readFile(signaturePath, "utf8")]),
    catch: () => evidenceError("The updater evidence could not be read."),
  });
  const signature = signatureSource.trim();
  if (signature.length === 0 || signature.length > 16_384) {
    return yield* Effect.fail(
      evidenceError("The updater signature is empty or unbounded."),
    );
  }
  if (!verifyMinisign(archive, publicKey, signature)) {
    return yield* Effect.fail(
      evidenceError("The updater signature does not match the staged archive."),
    );
  }
  return {
    available: true,
    target: "darwin-aarch64",
    artifactUrl: expectedUrl,
    archiveSha256: sha256(archive),
    publicKeySha256: sha256(publicKey),
    signature,
  } satisfies UpdaterEvidence;
});

export interface StaticUpdateManifestInput {
  readonly path: string;
  readonly version: string;
  readonly notes: string;
  readonly url: string;
  readonly signature: string;
}

export const writeStaticUpdateManifest = Effect.fn(
  "Flect.Updater.writeStaticManifest",
)(function* (input: StaticUpdateManifestInput) {
  const manifest = {
    version: input.version,
    notes: input.notes,
    platforms: {
      "darwin-aarch64": {
        url: input.url,
        signature: input.signature,
      },
    },
  } as const;
  yield* Effect.tryPromise({
    try: () => writeFile(input.path, `${JSON.stringify(manifest, null, 2)}\n`),
    catch: () =>
      evidenceError("The static update manifest could not be written."),
  });
  return manifest;
});
