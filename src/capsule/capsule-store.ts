import type { Vfs } from "@riftydev/vfs";
import { Context, Effect, Layer, Schema } from "effect";
import { browserPersistentStorage } from "../lib/browser-persistent-vfs";

const ROOT = "/flect-capsules/default";
const OBJECTS = `${ROOT}/objects`;
const BINDINGS = `${ROOT}/bindings.json`;

export interface CapsuleArchiveBindings {
  readonly accepted?: Uint8Array;
  readonly candidate?: Uint8Array;
  readonly lastKnownGood?: Uint8Array;
}

export interface CapsuleUninstallResult {
  readonly removedBindings: number;
  readonly removedObjects: number;
}

export class CapsuleStoreError extends Schema.TaggedErrorClass<CapsuleStoreError>()(
  "CapsuleStoreError",
  { message: Schema.Literal("Capsule storage is unavailable.") },
) {}

const failure = () =>
  CapsuleStoreError.make({ message: "Capsule storage is unavailable." });

export interface CapsuleStoreShape {
  readonly persistence: "durable" | "session";
  readonly load: Effect.Effect<CapsuleArchiveBindings, CapsuleStoreError>;
  readonly save: (
    bindings: CapsuleArchiveBindings,
  ) => Effect.Effect<void, CapsuleStoreError>;
  /**
   * Removes only archives named by this store's current binding file. Unknown
   * files and every other workspace namespace are deliberately left alone.
   */
  readonly uninstall: Effect.Effect<CapsuleUninstallResult, CapsuleStoreError>;
}

export class CapsuleStore extends Context.Service<
  CapsuleStore,
  CapsuleStoreShape
>()("flect/CapsuleStore") {}

const hash = async (archive: Uint8Array) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(archive).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const bindingKeys = ["accepted", "candidate", "lastKnownGood"] as const;

const readBindingDigests = async (vfs: Vfs) => {
  if (!(await vfs.exists(BINDINGS))) return undefined;
  const parsed: unknown = JSON.parse(await vfs.readFileText(BINDINGS));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("invalid bindings");
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== 1 ||
    Object.keys(record).some(
      (key) =>
        key !== "version" && !bindingKeys.some((binding) => binding === key),
    )
  )
    throw new Error("invalid bindings");
  const digests: Partial<Record<(typeof bindingKeys)[number], string>> = {};
  for (const key of bindingKeys) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
      throw new Error("invalid binding");
    digests[key] = value;
  }
  return digests;
};

const makeCapsuleStore = (
  vfs: Vfs,
  persistence: CapsuleStoreShape["persistence"],
): CapsuleStoreShape => ({
  persistence,
  load: Effect.tryPromise({
    try: async () => {
      const digests = await readBindingDigests(vfs);
      if (digests === undefined) return {};
      const read = async (key: string) => {
        const value = digests[key as keyof typeof digests];
        if (value === undefined) return undefined;
        return vfs.readFile(`${OBJECTS}/${value}.flect`);
      };
      const [accepted, candidate, lastKnownGood] = await Promise.all([
        read("accepted"),
        read("candidate"),
        read("lastKnownGood"),
      ]);
      return {
        ...(accepted === undefined ? {} : { accepted }),
        ...(candidate === undefined ? {} : { candidate }),
        ...(lastKnownGood === undefined ? {} : { lastKnownGood }),
      };
    },
    catch: failure,
  }),
  save: (bindings) =>
    Effect.tryPromise({
      try: async () => {
        await vfs.mkdir(OBJECTS, { recursive: true });
        const write = async (archive: Uint8Array | undefined) => {
          if (archive === undefined) return undefined;
          const digest = await hash(archive);
          const path = `${OBJECTS}/${digest}.flect`;
          if (!(await vfs.exists(path))) await vfs.writeFile(path, archive);
          return digest;
        };
        const [accepted, candidate, lastKnownGood] = await Promise.all([
          write(bindings.accepted),
          write(bindings.candidate),
          write(bindings.lastKnownGood),
        ]);
        await vfs.writeFile(
          BINDINGS,
          JSON.stringify({
            version: 1,
            ...(accepted === undefined ? {} : { accepted }),
            ...(candidate === undefined ? {} : { candidate }),
            ...(lastKnownGood === undefined ? {} : { lastKnownGood }),
          }),
        );
      },
      catch: failure,
    }),
  uninstall: Effect.tryPromise({
    try: async () => {
      const digests = await readBindingDigests(vfs);
      if (digests === undefined) {
        return { removedBindings: 0, removedObjects: 0 };
      }
      const bound = bindingKeys.filter((key) => digests[key] !== undefined);
      const objects = [...new Set(Object.values(digests))];

      // Commit the inactive state before object cleanup. A failed cleanup can
      // leave only unreachable bytes; it cannot reactivate a removed capsule.
      await vfs.writeFile(BINDINGS, JSON.stringify({ version: 1 }));
      for (const digest of objects) {
        await vfs.rm(`${OBJECTS}/${digest}.flect`, { force: true });
      }
      await vfs.rm(BINDINGS, { force: true });
      return {
        removedBindings: bound.length,
        removedObjects: objects.length,
      };
    },
    catch: failure,
  }),
});

export const makeCapsuleStoreLayer = (
  vfs: Vfs,
  persistence: CapsuleStoreShape["persistence"] = "session",
) => Layer.succeed(CapsuleStore)(makeCapsuleStore(vfs, persistence));

export const CapsuleStoreLive = Layer.effect(
  CapsuleStore,
  Effect.promise(() =>
    browserPersistentStorage().then(({ vfs, persistence }) =>
      makeCapsuleStore(vfs, persistence),
    ),
  ),
);
