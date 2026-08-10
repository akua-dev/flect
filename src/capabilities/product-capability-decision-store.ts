import {
  Clock,
  Context,
  Effect,
  Layer,
  Result,
  Schema,
  type SchemaAST,
} from "effect";
import {
  ProductCapabilityDecision,
  ProductCapabilityDecisionRecord,
  ProductCapabilityGrantRecord,
  type ProductCapabilityManifest,
} from "../../shared/product-capability";
import { InterfaceStorage } from "../lib/interface-store";

const LEGACY_STORAGE_KEY = "flect.product-capability-grants.v1";
const STORAGE_KEY = "flect.product-capability-decisions.v2";
const strict: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

export class ProductCapabilityDecisionStoreFailure extends Schema.TaggedErrorClass<ProductCapabilityDecisionStoreFailure>()(
  "ProductCapabilityDecisionStoreFailure",
  {
    reason: Schema.Literals([
      "invalid-record",
      "persistence-failed",
      "storage-unavailable",
    ]),
    message: Schema.Literals([
      "The stored product capability decisions are invalid.",
      "The product capability decisions could not be saved.",
      "The stored product capability decisions are unavailable.",
    ]),
  },
) {}

export interface ProductCapabilityMigrationContext {
  readonly scopeId: string;
  readonly workspaceId: string;
  readonly requestDigest: string;
  readonly manifest: ProductCapabilityManifest;
}

export interface ProductCapabilityDecisionStoreLoad {
  readonly decisions: ReadonlyArray<ProductCapabilityDecision>;
  readonly warning?: ProductCapabilityDecisionStoreFailure;
}

export interface ProductCapabilityDecisionStoreShape {
  readonly load: (
    contexts: ReadonlyArray<ProductCapabilityMigrationContext>,
  ) => Effect.Effect<ProductCapabilityDecisionStoreLoad>;
  readonly save: (
    decisions: ReadonlyArray<ProductCapabilityDecision>,
  ) => Effect.Effect<void, ProductCapabilityDecisionStoreFailure>;
}

export class ProductCapabilityDecisionStore extends Context.Service<
  ProductCapabilityDecisionStore,
  ProductCapabilityDecisionStoreShape
>()("flect/ProductCapabilityDecisionStore") {}

const failure = (
  reason: ProductCapabilityDecisionStoreFailure["reason"],
): ProductCapabilityDecisionStoreFailure =>
  ProductCapabilityDecisionStoreFailure.make({
    reason,
    message:
      reason === "invalid-record"
        ? "The stored product capability decisions are invalid."
        : reason === "persistence-failed"
          ? "The product capability decisions could not be saved."
          : "The stored product capability decisions are unavailable.",
  });

const parseJson = (raw: string) =>
  Effect.try({
    try: (): unknown => JSON.parse(raw),
    catch: () => failure("invalid-record"),
  });

const normalize = (
  decisions: ReadonlyArray<ProductCapabilityDecision>,
): ReadonlyArray<ProductCapabilityDecision> =>
  [...decisions].sort((left, right) =>
    left.decisionId.localeCompare(right.decisionId),
  );

const decodeV2 = (raw: string) =>
  parseJson(raw).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(ProductCapabilityDecisionRecord, strict),
    ),
    Effect.map((record) => normalize(record.decisions)),
    Effect.mapError(() => failure("invalid-record")),
  );

const decodeV1 = (raw: string) =>
  parseJson(raw).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(ProductCapabilityGrantRecord, strict),
    ),
    Effect.map((record) => record.states),
    Effect.mapError(() => failure("invalid-record")),
  );

export const makeProductCapabilityDecisionStoreLayer = Layer.effect(
  ProductCapabilityDecisionStore,
  Effect.gen(function* () {
    const storage = yield* InterfaceStorage;

    const save = Effect.fn("Flect.ProductCapabilityDecisionStore.save")(
      function* (decisions: ReadonlyArray<ProductCapabilityDecision>) {
        const normalized = normalize(
          yield* Schema.decodeUnknownEffect(
            Schema.Array(ProductCapabilityDecision).check(
              Schema.isMaxLength(128),
            ),
            strict,
          )(decisions).pipe(Effect.mapError(() => failure("invalid-record"))),
        );
        yield* storage
          .write(
            STORAGE_KEY,
            JSON.stringify(
              ProductCapabilityDecisionRecord.make({
                version: 2,
                decisions: normalized,
              }),
            ),
          )
          .pipe(Effect.mapError(() => failure("persistence-failed")));
      },
    );

    const load = Effect.fn("Flect.ProductCapabilityDecisionStore.load")(
      function* (contexts: ReadonlyArray<ProductCapabilityMigrationContext>) {
        const storedV2 = yield* storage.read(STORAGE_KEY).pipe(
          Effect.mapError(() => failure("storage-unavailable")),
          Effect.result,
        );
        if (Result.isFailure(storedV2)) {
          return { decisions: [], warning: storedV2.failure };
        }
        let durable: ReadonlyArray<ProductCapabilityDecision> = [];
        if (storedV2.success !== null) {
          const decoded = yield* decodeV2(storedV2.success).pipe(Effect.result);
          if (Result.isFailure(decoded)) {
            return { decisions: [], warning: decoded.failure };
          }
          durable = decoded.success;
        }

        const storedV1 = yield* storage.read(LEGACY_STORAGE_KEY).pipe(
          Effect.mapError(() => failure("storage-unavailable")),
          Effect.result,
        );
        if (Result.isFailure(storedV1)) {
          return { decisions: durable, warning: storedV1.failure };
        }
        if (storedV1.success === null) return { decisions: durable };

        const legacy = yield* decodeV1(storedV1.success).pipe(Effect.result);
        if (Result.isFailure(legacy)) {
          return { decisions: durable, warning: legacy.failure };
        }

        const now = yield* Clock.currentTimeMillis;
        const byKey = new Map(
          contexts.map((context) => [
            `${context.scopeId}\u0000${context.manifest.id}`,
            context,
          ]),
        );
        const represented = new Set(
          durable.map(
            (decision) => `${decision.scopeId}\u0000${decision.capabilityId}`,
          ),
        );
        const migrated = [...legacy.success]
          .sort((left, right) => {
            const leftKey = `${left.scopeId}\u0000${left.capabilityId}`;
            const rightKey = `${right.scopeId}\u0000${right.capabilityId}`;
            return leftKey.localeCompare(rightKey);
          })
          .map((state, index) => ({
            state,
            context: byKey.get(`${state.scopeId}\u0000${state.capabilityId}`),
            index,
          }))
          .filter(
            (entry) =>
              !represented.has(
                `${entry.state.scopeId}\u0000${entry.state.capabilityId}`,
              ) &&
              entry.context?.manifest.confirmationPolicies.includes(
                "persistent",
              ),
          )
          .map((entry) => {
            const context = entry.context;
            if (context === undefined) return undefined;
            return ProductCapabilityDecision.make({
              version: 2,
              decisionId: `decision-migrated-${String(entry.index + 1).padStart(4, "0")}`,
              scopeId: entry.state.scopeId,
              requestDigest: context.requestDigest,
              capabilityId: entry.state.capabilityId,
              status: entry.state.granted ? "granted" : "revoked",
              confirmationPolicy: "persistent",
              operationIds: [...context.manifest.operationIds],
              resourceIds: [...context.manifest.resourceIds],
              dataClassIds: [...context.manifest.dataClassIds],
              createdAtMillis: now,
              updatedAtMillis: now,
              authority: "protected-user",
            });
          })
          .filter((decision) => decision !== undefined);

        const decisions = normalize([...durable, ...migrated]);
        if (migrated.length > 0) {
          const persisted = yield* save(decisions).pipe(Effect.result);
          if (Result.isFailure(persisted)) {
            return { decisions: durable, warning: persisted.failure };
          }
        }
        const complete = legacy.success.every((state) =>
          decisions.some(
            (decision) =>
              decision.scopeId === state.scopeId &&
              decision.capabilityId === state.capabilityId,
          ),
        );
        if (complete) {
          yield* storage.remove(LEGACY_STORAGE_KEY).pipe(Effect.ignore);
        }
        return { decisions };
      },
    );

    return { load, save };
  }),
);
