import { MemoryVfs, OpfsVfs, type Vfs } from "@riftydev/vfs";
import { Context, Effect, Layer, Schema } from "effect";

const ROOT = "/flect-capsules/default";
const OBJECTS = `${ROOT}/objects`;
const BINDINGS = `${ROOT}/bindings.json`;

export interface CapsuleArchiveBindings {
  readonly accepted?: Uint8Array;
  readonly candidate?: Uint8Array;
  readonly lastKnownGood?: Uint8Array;
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

const makeCapsuleStore = (
  vfs: Vfs,
  persistence: CapsuleStoreShape["persistence"],
): CapsuleStoreShape => ({
  persistence,
  load: Effect.tryPromise({
    try: async () => {
      if (!(await vfs.exists(BINDINGS))) return {};
      const parsed: unknown = JSON.parse(await vfs.readFileText(BINDINGS));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error("invalid bindings");
      const record = parsed as Record<string, unknown>;
      if (
        record.version !== 1 ||
        Object.keys(record).some(
          (key) =>
            !["version", "accepted", "candidate", "lastKnownGood"].includes(
              key,
            ),
        )
      )
        throw new Error("invalid bindings");
      const read = async (key: string) => {
        const value = record[key];
        if (value === undefined) return undefined;
        if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
          throw new Error("invalid binding");
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
});

export const makeCapsuleStoreLayer = (
  vfs: Vfs,
  persistence: CapsuleStoreShape["persistence"] = "session",
) => Layer.succeed(CapsuleStore)(makeCapsuleStore(vfs, persistence));

export const CapsuleStoreLive = Layer.effect(
  CapsuleStore,
  Effect.promise(async () => {
    if (OpfsVfs.isSupported()) {
      try {
        const vfs = new OpfsVfs();
        await vfs.init();
        return makeCapsuleStore(vfs, "durable");
      } catch {}
    }
    return makeCapsuleStore(new MemoryVfs(), "session");
  }),
);
