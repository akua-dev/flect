import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  ShapingSnapshot,
  validateShapingSnapshot,
} from "../../shared/revisions";
import {
  InterfaceStorage,
  type InterfaceStorageError,
} from "./interface-store";

export const REVISION_JOURNAL_KEY = "flect.revisions.v1";
export const RECOVERY_MARKER_KEY = "flect.recovery.v1";

export class RecoveryMarker extends Schema.Class<RecoveryMarker>(
  "RecoveryMarker",
)({
  version: Schema.Literal(1),
  status: Schema.Literals(["pending", "clear"]),
}) {}

export const decodeRecoveryMarker = Schema.decodeUnknownEffect(RecoveryMarker);

class InvalidRevisionJournal extends Schema.TaggedErrorClass<InvalidRevisionJournal>()(
  "InvalidRevisionJournal",
  {
    message: Schema.Literal("The revision journal is invalid."),
  },
) {}

export class InterfaceRepositoryLoad extends Schema.Class<InterfaceRepositoryLoad>(
  "InterfaceRepositoryLoad",
)({
  snapshot: Schema.optionalKey(ShapingSnapshot),
  recovered: Schema.Boolean,
  recovery: Schema.optionalKey(Schema.Boolean),
}) {}

export interface InterfaceRepositoryShape {
  readonly load: Effect.Effect<InterfaceRepositoryLoad>;
  readonly save: (
    snapshot: ShapingSnapshot,
  ) => Effect.Effect<void, InterfaceStorageError>;
  readonly markRecovery?: Effect.Effect<void, InterfaceStorageError>;
  readonly clearRecovery?: Effect.Effect<void, InterfaceStorageError>;
}

export class InterfaceRepository extends Context.Service<
  InterfaceRepository,
  InterfaceRepositoryShape
>()("flect/InterfaceRepository") {}

export const makeInterfaceRepositoryLayer = ({
  safeMode,
}: {
  readonly safeMode: boolean;
}) =>
  Layer.effect(
    InterfaceRepository,
    Effect.gen(function* () {
      const storage = yield* InterfaceStorage;

      const load = Effect.fn("Flect.InterfaceRepository.load")(function* () {
        if (safeMode) {
          return InterfaceRepositoryLoad.make({
            recovered: true,
          });
        }

        const raw = yield* storage
          .read(REVISION_JOURNAL_KEY)
          .pipe(Effect.orElseSucceed(() => undefined));
        const recoveryRaw = yield* storage
          .read(RECOVERY_MARKER_KEY)
          .pipe(Effect.orElseSucceed(() => undefined));
        const recovery =
          recoveryRaw === undefined || recoveryRaw === null
            ? false
            : yield* Effect.try({
                try: (): unknown => JSON.parse(recoveryRaw),
                catch: () => undefined,
              }).pipe(
                Effect.flatMap(decodeRecoveryMarker),
                Effect.map((marker) => marker.status === "pending"),
                Effect.orElseSucceed(() => true),
              );
        if (raw === null) {
          return InterfaceRepositoryLoad.make({
            recovered: false,
            ...(recovery ? { recovery: true } : {}),
          });
        }
        if (raw === undefined) {
          return InterfaceRepositoryLoad.make({
            recovered: true,
            ...(recovery ? { recovery: true } : {}),
          });
        }

        const input = yield* Effect.try({
          try: (): unknown => JSON.parse(raw),
          catch: () =>
            InvalidRevisionJournal.make({
              message: "The revision journal is invalid.",
            }),
        }).pipe(Effect.option);
        if (Option.isNone(input)) {
          return InterfaceRepositoryLoad.make({
            recovered: true,
            ...(recovery ? { recovery: true } : {}),
          });
        }

        const decoded = yield* validateShapingSnapshot(input.value).pipe(
          Effect.option,
        );
        const snapshot = Option.getOrUndefined(decoded);

        return InterfaceRepositoryLoad.make({
          ...(snapshot === undefined ? {} : { snapshot }),
          recovered: snapshot === undefined,
          ...(recovery ? { recovery: true } : {}),
        });
      });

      return {
        load: load(),
        save: Effect.fn("Flect.InterfaceRepository.save")(
          (snapshot: ShapingSnapshot) =>
            safeMode
              ? Effect.void
              : storage.write(REVISION_JOURNAL_KEY, JSON.stringify(snapshot)),
        ),
        markRecovery: storage.write(
          RECOVERY_MARKER_KEY,
          JSON.stringify({ version: 1, status: "pending" }),
        ),
        clearRecovery: storage.remove(RECOVERY_MARKER_KEY),
      };
    }),
  );
