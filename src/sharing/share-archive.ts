import { Effect, Schema } from "effect";
import {
  decodeCapsule,
  MAX_CAPSULE_BYTES,
} from "../../packages/product/src/capsule";
import {
  decodePortableTar,
  encodePortableTar,
  PORTABLE_TAR_BLOCK_BYTES,
  type PortableTarEntry,
} from "../../packages/product/src/portable-tar";
import {
  MAX_SHARE_ARCHIVE_BYTES,
  ShareEmbeddedRepository,
  type ShareManifest,
  validateShareManifest,
} from "../../packages/product/src/share";

const MAX_REPOSITORY_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 66;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class ShareArchiveFailure extends Schema.TaggedErrorClass<ShareArchiveFailure>()(
  "ShareArchiveFailure",
  { message: Schema.String },
) {}

const invalid = () =>
  ShareArchiveFailure.make({
    message: "The .flect-share archive is invalid.",
  });

export interface ShareArchiveSource {
  readonly manifest: ShareManifest;
  readonly repository: Uint8Array;
  readonly artifacts: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>;
}

export interface DecodedShareArchive {
  readonly manifest: ShareManifest;
  readonly repository: Uint8Array;
  readonly artifacts: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>;
}

const sha256 = Effect.fn("Flect.ShareArchive.sha256")((contents: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        Uint8Array.from(contents),
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    catch: invalid,
  }),
);

const archiveLimits = {
  maxArchiveBytes: MAX_SHARE_ARCHIVE_BYTES,
  maxEntries: MAX_ARCHIVE_ENTRIES,
  maxEntryBytes: MAX_SHARE_ARCHIVE_BYTES,
  minimumArchiveBytes: PORTABLE_TAR_BLOCK_BYTES * 4,
};

const declaredCapsules = (manifest: ShareManifest) =>
  manifest.artifacts.flatMap((artifact) =>
    artifact.capsule === undefined ? [] : [artifact.capsule],
  );

const verifyArtifacts = Effect.fn("Flect.ShareArchive.verifyArtifacts")(
  function* (
    manifest: ShareManifest,
    artifacts: ReadonlyArray<PortableTarEntry>,
  ) {
    const declared = declaredCapsules(manifest).toSorted((left, right) =>
      left.path.localeCompare(right.path),
    );
    if (
      artifacts.length !== declared.length ||
      artifacts.some(
        (artifact, index) => artifact.path !== declared[index]?.path,
      )
    ) {
      return yield* Effect.fail(invalid());
    }
    for (let index = 0; index < artifacts.length; index += 1) {
      const artifact = artifacts[index];
      const expected = declared[index];
      if (
        artifact === undefined ||
        expected === undefined ||
        artifact.contents.byteLength > MAX_CAPSULE_BYTES ||
        (yield* sha256(artifact.contents)) !== expected.sha256
      ) {
        return yield* Effect.fail(invalid());
      }
      yield* decodeCapsule(artifact.contents).pipe(
        Effect.mapError(() => invalid()),
      );
    }
  },
);

export const encodeShareArchive = Effect.fn("Flect.ShareArchive.encode")(
  function* (source: ShareArchiveSource) {
    const manifest = yield* validateShareManifest(source.manifest).pipe(
      Effect.mapError(() => invalid()),
    );
    if (
      manifest.repository._tag !== "git" ||
      source.repository.byteLength === 0 ||
      source.repository.byteLength > MAX_REPOSITORY_BYTES
    ) {
      return yield* Effect.fail(invalid());
    }
    const artifacts = [...source.artifacts].toSorted((left, right) =>
      left.path.localeCompare(right.path),
    );
    yield* verifyArtifacts(manifest, artifacts);
    const embedded = yield* validateShareManifest({
      ...manifest,
      repository: ShareEmbeddedRepository.make({
        _tag: "embedded",
        archivePath: "repository.tar",
        sha256: yield* sha256(source.repository),
        commit: manifest.repository.commit,
      }),
    }).pipe(Effect.mapError(() => invalid()));
    return yield* encodePortableTar(
      [
        {
          path: "share.json",
          contents: encoder.encode(JSON.stringify(embedded)),
        },
        { path: "repository.tar", contents: source.repository },
        ...artifacts,
      ],
      archiveLimits,
    ).pipe(Effect.mapError(() => invalid()));
  },
);

export const decodeShareArchive = Effect.fn("Flect.ShareArchive.decode")(
  function* (
    archive: Uint8Array,
  ): Effect.fn.Return<DecodedShareArchive, ShareArchiveFailure> {
    const entries = yield* decodePortableTar(archive, archiveLimits).pipe(
      Effect.mapError(() => invalid()),
    );
    const manifestEntry = entries[0];
    const repositoryEntry = entries[1];
    if (
      manifestEntry?.path !== "share.json" ||
      repositoryEntry?.path !== "repository.tar" ||
      repositoryEntry.contents.byteLength === 0 ||
      repositoryEntry.contents.byteLength > MAX_REPOSITORY_BYTES
    ) {
      return yield* Effect.fail(invalid());
    }
    const manifestInput = yield* Effect.try({
      try: (): unknown => JSON.parse(decoder.decode(manifestEntry.contents)),
      catch: invalid,
    });
    const manifest = yield* validateShareManifest(manifestInput).pipe(
      Effect.mapError(() => invalid()),
    );
    if (
      manifest.repository._tag !== "embedded" ||
      manifest.repository.archivePath !== repositoryEntry.path ||
      (yield* sha256(repositoryEntry.contents)) !== manifest.repository.sha256
    ) {
      return yield* Effect.fail(invalid());
    }
    const artifacts = entries.slice(2);
    yield* verifyArtifacts(manifest, artifacts);
    return {
      manifest,
      repository: repositoryEntry.contents,
      artifacts,
    };
  },
);
