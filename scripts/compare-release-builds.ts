import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Effect, Schema } from "effect";

export class ReleaseBuildComparisonError extends Schema.TaggedErrorClass<ReleaseBuildComparisonError>()(
  "ReleaseBuildComparisonError",
  {
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(300),
    ),
  },
) {}

export interface ReleaseBuildComparison {
  readonly verified: boolean;
  readonly firstTreeSha256: string;
  readonly secondTreeSha256: string;
  readonly changedPaths: ReadonlyArray<string>;
  readonly binaryOffsets: Readonly<Record<string, ReadonlyArray<number>>>;
}

interface TreeEntry {
  readonly kind: "directory" | "file" | "symlink";
  readonly mode: string;
  readonly digest?: string;
  readonly target?: string;
}

const comparisonError = (message: string) =>
  ReleaseBuildComparisonError.make({ message });

const isSignatureEnvelope = (path: string) =>
  path === "Contents/_CodeSignature" ||
  path.startsWith("Contents/_CodeSignature/");

const sha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

const readTree = async (root: string) => {
  const entries = new Map<string, TreeEntry>();
  const walk = async (current: string): Promise<void> => {
    const children = await readdir(current);
    children.sort();
    for (const name of children) {
      const path = join(current, name);
      const relativePath = relative(root, path);
      if (isSignatureEnvelope(relativePath)) continue;
      const entry = await lstat(path);
      const mode = (entry.mode & 0o777).toString(8).padStart(3, "0");
      if (entry.isDirectory()) {
        entries.set(relativePath, { kind: "directory", mode });
        await walk(path);
      } else if (entry.isSymbolicLink()) {
        entries.set(relativePath, {
          kind: "symlink",
          mode,
          target: await readlink(path),
        });
      } else if (entry.isFile()) {
        entries.set(relativePath, {
          kind: "file",
          mode,
          digest: sha256(await readFile(path)),
        });
      }
    }
  };
  await walk(root);
  return entries;
};

const digestTree = (entries: ReadonlyMap<string, TreeEntry>) =>
  sha256(
    [...entries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, entry]) =>
        [
          path,
          entry.kind,
          entry.mode,
          entry.digest ?? "",
          entry.target ?? "",
        ].join("\0"),
      )
      .join("\n"),
  );

const changedOffsets = async (first: string, second: string) => {
  const [left, right] = await Promise.all([readFile(first), readFile(second)]);
  const offsets: Array<number> = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length && offsets.length < 32; index += 1) {
    if (left[index] !== right[index]) offsets.push(index);
  }
  return offsets;
};

export const compareUnsignedReleaseTrees = Effect.fn(
  "Flect.Release.compareUnsignedTrees",
)((firstApp: string, secondApp: string) =>
  Effect.tryPromise({
    try: async (): Promise<ReleaseBuildComparison> => {
      const [first, second] = await Promise.all([
        readTree(firstApp),
        readTree(secondApp),
      ]);
      const allPaths = [...new Set([...first.keys(), ...second.keys()])].sort();
      const changedPaths = allPaths
        .filter(
          (path) =>
            JSON.stringify(first.get(path)) !==
            JSON.stringify(second.get(path)),
        )
        .slice(0, 100);
      const binaryOffsets = Object.fromEntries(
        await Promise.all(
          changedPaths.flatMap((path) => {
            const left = first.get(path);
            const right = second.get(path);
            return left?.kind === "file" && right?.kind === "file"
              ? [
                  changedOffsets(
                    join(firstApp, path),
                    join(secondApp, path),
                  ).then((offsets) => [path, offsets] as const),
                ]
              : [];
          }),
        ),
      );
      const firstTreeSha256 = digestTree(first);
      const secondTreeSha256 = digestTree(second);
      return {
        verified:
          changedPaths.length === 0 && firstTreeSha256 === secondTreeSha256,
        firstTreeSha256,
        secondTreeSha256,
        changedPaths,
        binaryOffsets,
      };
    },
    catch: () =>
      comparisonError("Independent Flect builds could not be compared."),
  }),
);

const stripActualSignatures = async (app: string) => {
  for (const path of [join(app, "Contents", "MacOS", "flect-runtime"), app]) {
    const process = Bun.spawn(["codesign", "--remove-signature", path], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await process.exited) !== 0) {
      throw new Error("signature removal failed");
    }
  }
  await rm(join(app, "Contents", "_CodeSignature"), {
    recursive: true,
    force: true,
  });
};

const validAppPath = (path: string) => path.endsWith("/Flect.app");

export const compareReleaseBuilds = Effect.fn("Flect.Release.compareBuilds")(
  (firstApp: string, secondApp: string) => {
    if (!validAppPath(firstApp) || !validAppPath(secondApp)) {
      return Effect.fail(
        comparisonError(
          "Independent comparison requires two Flect.app bundles.",
        ),
      );
    }
    return Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => mkdtemp(join(tmpdir(), "flect-release-comparison-")),
        catch: () =>
          comparisonError("The comparison workspace could not be created."),
      }),
      (temporary) =>
        Effect.tryPromise({
          try: async () => {
            const first = join(temporary, "first", "Flect.app");
            const second = join(temporary, "second", "Flect.app");
            await Promise.all([
              cp(firstApp, first, {
                recursive: true,
                preserveTimestamps: true,
              }),
              cp(secondApp, second, {
                recursive: true,
                preserveTimestamps: true,
              }),
            ]);
            await Promise.all([
              stripActualSignatures(first),
              stripActualSignatures(second),
            ]);
            return await Effect.runPromise(
              compareUnsignedReleaseTrees(first, second),
            );
          },
          catch: () =>
            comparisonError(
              "Signed Flect builds could not be normalized and compared.",
            ),
        }),
      (temporary) =>
        Effect.promise(() => rm(temporary, { recursive: true, force: true })),
    );
  },
);
