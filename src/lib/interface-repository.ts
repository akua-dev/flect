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
}) {}

export interface InterfaceRepositoryShape {
  readonly load: Effect.Effect<InterfaceRepositoryLoad>;
  readonly save: (
    snapshot: ShapingSnapshot,
  ) => Effect.Effect<void, InterfaceStorageError>;
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
        if (raw === null) {
          return InterfaceRepositoryLoad.make({
            recovered: false,
          });
        }
        if (raw === undefined) {
          return InterfaceRepositoryLoad.make({
            recovered: true,
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
          });
        }

        const decoded = yield* validateShapingSnapshot(input.value).pipe(
          Effect.option,
        );
        const snapshot = Option.getOrUndefined(decoded);

        return InterfaceRepositoryLoad.make({
          ...(snapshot === undefined ? {} : { snapshot }),
          recovered: snapshot === undefined,
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
      };
    }),
  );
