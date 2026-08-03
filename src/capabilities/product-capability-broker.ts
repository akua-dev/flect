import { Clock, Context, Effect, Layer, SynchronizedRef } from "effect";
import {
  type AuthorizedProductOperation,
  ProductCapabilityBrokerFailure,
  ProductCapabilityDecision,
  type ProductCapabilityDecisionChoice,
  type ProductCapabilityManifest,
  ProductCapabilityProjection,
  ProductCapabilityRateLimit,
  type ProductCapabilityRequestContext,
  ProductCapabilityReservation,
  ProductCapabilityUsage,
} from "../../shared/product-capability";
import {
  ProductCapabilityDecisionStore,
  type ProductCapabilityDecisionStoreFailure,
  type ProductCapabilityMigrationContext,
} from "./product-capability-decision-store";

interface BrokerState {
  readonly decisions: ReadonlyArray<ProductCapabilityDecision>;
  readonly loadedContexts: ReadonlySet<string>;
  readonly warnings: ReadonlyArray<ProductCapabilityDecisionStoreFailure>;
}

export interface ProductCapabilityBrokerShape {
  readonly catalog: (
    context: ProductCapabilityRequestContext,
  ) => Effect.Effect<ReadonlyArray<ProductCapabilityProjection>>;
  readonly decide: (
    context: ProductCapabilityRequestContext,
    capabilityId: string,
    choice: ProductCapabilityDecisionChoice,
  ) => Effect.Effect<
    ProductCapabilityProjection,
    ProductCapabilityBrokerFailure
  >;
  readonly revoke: (
    decisionId: string,
  ) => Effect.Effect<void, ProductCapabilityBrokerFailure>;
  readonly reserve: (
    context: ProductCapabilityRequestContext,
    operation: AuthorizedProductOperation,
  ) => Effect.Effect<
    ProductCapabilityReservation,
    ProductCapabilityBrokerFailure
  >;
  readonly inspectReservation: (
    reservation: ProductCapabilityReservation,
  ) => Effect.Effect<void, ProductCapabilityBrokerFailure>;
  readonly validate: (
    reservation: ProductCapabilityReservation,
    operation: AuthorizedProductOperation,
  ) => Effect.Effect<void, ProductCapabilityBrokerFailure>;
  readonly withReservation: <A, E>(
    reservation: ProductCapabilityReservation,
    operation: AuthorizedProductOperation,
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ProductCapabilityBrokerFailure>;
  readonly warnings: Effect.Effect<
    ReadonlyArray<ProductCapabilityDecisionStoreFailure>
  >;
}

export class ProductCapabilityBroker extends Context.Service<
  ProductCapabilityBroker,
  ProductCapabilityBrokerShape
>()("flect/ProductCapabilityBroker") {}

const messageFor = (reason: ProductCapabilityBrokerFailure["reason"]) => {
  switch (reason) {
    case "unknown-capability":
      return "The product capability is unavailable.";
    case "not-requested":
      return "The product capability was not requested.";
    case "invalid-scope":
      return "The requested capability scope is invalid.";
    case "persistence-failed":
      return "The product capability decision could not be saved.";
    case "expired":
      return "The product capability grant has expired.";
    case "revoked":
      return "The product capability grant was revoked.";
    case "rate-limited":
      return "The product operation is temporarily limited.";
    case "unavailable":
      return "This capability is unavailable on this platform.";
    case "denied":
      return "The product operation was denied.";
  }
};

const brokerFailure = (
  reason: ProductCapabilityBrokerFailure["reason"],
  capabilityId?: string,
) =>
  ProductCapabilityBrokerFailure.make({
    reason,
    message: messageFor(reason),
    ...(capabilityId === undefined ? {} : { capabilityId }),
  });

const transition = <A, B>(result: A, state: B): readonly [A, B] => [
  result,
  state,
];

const isDurable = (decision: ProductCapabilityDecision) =>
  decision.confirmationPolicy === "workspace" ||
  decision.confirmationPolicy === "persistent";

const durableDecisions = (state: BrokerState) =>
  state.decisions.filter(isDurable);

const addWarning = (
  warnings: ReadonlyArray<ProductCapabilityDecisionStoreFailure>,
  warning: ProductCapabilityDecisionStoreFailure,
) =>
  warnings.some((current) => current.reason === warning.reason)
    ? warnings
    : [...warnings, warning];

const isSubset = (
  selected: ReadonlyArray<string>,
  available: ReadonlyArray<string>,
) => selected.every((value) => available.includes(value));

const latestDecision = (
  state: BrokerState,
  context: ProductCapabilityRequestContext,
  capabilityId: string,
) =>
  state.decisions
    .filter(
      (decision) =>
        decision.scopeId === context.scopeId &&
        decision.capabilityId === capabilityId &&
        decision.requestDigest === context.requestDigest &&
        (decision.confirmationPolicy !== "workspace" ||
          decision.workspaceId === context.workspaceId),
    )
    .sort((left, right) => right.updatedAtMillis - left.updatedAtMillis)[0];

const lifecycle = (decision: ProductCapabilityDecision, now: number) => {
  if (decision.status === "denied") return "denied";
  if (decision.status === "revoked") return "revoked";
  if (
    (decision.expiresAtMillis !== undefined &&
      decision.expiresAtMillis <= now) ||
    (decision.confirmationPolicy === "once" &&
      (decision.usage?.totalInvocations ?? 0) >= 1)
  ) {
    return "expired";
  }
  return "granted";
};

const makeProjection = (options: {
  readonly context: ProductCapabilityRequestContext;
  readonly manifest?: ProductCapabilityManifest;
  readonly requested: boolean;
  readonly required: boolean;
  readonly decision?: ProductCapabilityDecision;
  readonly now: number;
  readonly capabilityId: string;
}) => {
  const { context, decision, manifest } = options;
  const state =
    manifest === undefined
      ? "requested"
      : !options.requested
        ? "available"
        : decision === undefined
          ? "requested"
          : lifecycle(decision, options.now);
  return ProductCapabilityProjection.make({
    version: 1,
    scopeId: context.scopeId,
    workspaceId: context.workspaceId,
    requestDigest: context.requestDigest,
    revision: context.revision,
    capabilityId: options.capabilityId,
    state,
    availability: manifest === undefined ? "unavailable" : "available",
    requested: options.requested,
    required: options.required,
    confirmationPolicies:
      manifest === undefined ? [] : [...manifest.confirmationPolicies],
    operationIds: manifest === undefined ? [] : [...manifest.operationIds],
    resourceIds: manifest === undefined ? [] : [...manifest.resourceIds],
    dataClassIds: manifest === undefined ? [] : [...manifest.dataClassIds],
    ...(decision === undefined
      ? {}
      : {
          decisionId: decision.decisionId,
          confirmationPolicy: decision.confirmationPolicy,
          ...(decision.expiresAtMillis === undefined
            ? {}
            : { expiresAtMillis: decision.expiresAtMillis }),
          ...(decision.rateLimit === undefined
            ? {}
            : { rateLimit: decision.rateLimit }),
        }),
  });
};

export const makeProductCapabilityBrokerLayer = (options: {
  readonly manifests: ReadonlyArray<ProductCapabilityManifest>;
}) =>
  Layer.effect(
    ProductCapabilityBroker,
    Effect.gen(function* () {
      const store = yield* ProductCapabilityDecisionStore;
      const initial = yield* store.load([]);
      const state = yield* SynchronizedRef.make<BrokerState>({
        decisions: initial.decisions,
        loadedContexts: new Set(),
        warnings:
          initial.warning === undefined ? [] : [initial.warning],
      });
      const manifests = new Map(
        options.manifests.map((manifest) => [manifest.id, manifest]),
      );

      const ensureLoaded = Effect.fn("Flect.ProductCapabilityBroker.load")(
        function* (context: ProductCapabilityRequestContext) {
          const contextKey = `${context.scopeId}\u0000${context.requestDigest}`;
          yield* SynchronizedRef.updateEffect(state, (current) => {
            if (current.loadedContexts.has(contextKey)) {
              return Effect.succeed(current);
            }
            const migrationContexts: Array<ProductCapabilityMigrationContext> =
              [];
            for (const request of context.capabilities) {
              const manifest = manifests.get(request.capabilityId);
              if (manifest !== undefined) {
                migrationContexts.push({
                  scopeId: context.scopeId,
                  workspaceId: context.workspaceId,
                  requestDigest: context.requestDigest,
                  manifest,
                });
              }
            }
            return store.load(migrationContexts).pipe(
              Effect.map((loaded) => {
                const byId = new Map(
                  loaded.decisions.map((decision) => [
                    decision.decisionId,
                    decision,
                  ]),
                );
                for (const decision of current.decisions) {
                  byId.set(decision.decisionId, decision);
                }
                return {
                  decisions: [...byId.values()],
                  loadedContexts: new Set([
                    ...current.loadedContexts,
                    contextKey,
                  ]),
                  warnings:
                    loaded.warning === undefined
                      ? current.warnings
                      : addWarning(current.warnings, loaded.warning),
                };
              }),
            );
          });
        },
      );

      const catalog = Effect.fn("Flect.ProductCapabilityBroker.catalog")(
        function* (context: ProductCapabilityRequestContext) {
          yield* ensureLoaded(context);
          const current = yield* SynchronizedRef.get(state);
          const now = yield* Clock.currentTimeMillis;
          const requested = new Map(
            context.capabilities.map((entry) => [entry.capabilityId, entry]),
          );
          const capabilityIds = [
            ...new Set([...manifests.keys(), ...requested.keys()]),
          ].sort((left, right) => left.localeCompare(right));
          return capabilityIds.map((capabilityId) => {
            const request = requested.get(capabilityId);
            return makeProjection({
              context,
              capabilityId,
              manifest: manifests.get(capabilityId),
              requested: request !== undefined,
              required: request?.required ?? false,
              decision:
                request === undefined
                  ? undefined
                  : latestDecision(current, context, capabilityId),
              now,
            });
          });
        },
      );

      const decide = Effect.fn("Flect.ProductCapabilityBroker.decide")(
        function* (
          context: ProductCapabilityRequestContext,
          capabilityId: string,
          choice: ProductCapabilityDecisionChoice,
        ) {
          yield* ensureLoaded(context);
          const requested = context.capabilities.some(
            (entry) => entry.capabilityId === capabilityId,
          );
          if (!requested) {
            return yield* Effect.fail(
              brokerFailure("not-requested", capabilityId),
            );
          }
          const manifest = manifests.get(capabilityId);
          if (manifest === undefined) {
            return yield* Effect.fail(
              brokerFailure("unknown-capability", capabilityId),
            );
          }
          const now = yield* Clock.currentTimeMillis;
          const operationIds =
            choice.type === "allow" && choice.operationIds !== undefined
              ? choice.operationIds
              : manifest.operationIds;
          const resourceIds =
            choice.type === "allow" && choice.resourceIds !== undefined
              ? choice.resourceIds
              : manifest.resourceIds;
          const dataClassIds =
            choice.type === "allow" && choice.dataClassIds !== undefined
              ? choice.dataClassIds
              : manifest.dataClassIds;
          if (
            !isSubset(operationIds, manifest.operationIds) ||
            !isSubset(resourceIds, manifest.resourceIds) ||
            !isSubset(dataClassIds, manifest.dataClassIds)
          ) {
            return yield* Effect.fail(
              brokerFailure("invalid-scope", capabilityId),
            );
          }
          if (
            choice.type === "allow" &&
            (!manifest.confirmationPolicies.includes(
              choice.confirmationPolicy,
            ) ||
              (choice.durationMs !== undefined &&
                manifest.maxGrantDurationMs !== undefined &&
                choice.durationMs > manifest.maxGrantDurationMs) ||
              (choice.rateLimit !== undefined &&
                manifest.maxRate !== undefined &&
                choice.rateLimit.maxInvocations * manifest.maxRate.intervalMs >
                  manifest.maxRate.maxInvocations *
                    choice.rateLimit.intervalMs))
          ) {
            return yield* Effect.fail(
              brokerFailure("invalid-scope", capabilityId),
            );
          }
          const selectedRate =
            choice.type === "allow"
              ? (choice.rateLimit ?? manifest.maxRate)
              : undefined;
          const decision = ProductCapabilityDecision.make({
            version: 2,
            decisionId: `decision-${crypto.randomUUID()}`,
            scopeId: context.scopeId,
            ...(choice.type === "allow" &&
            choice.confirmationPolicy === "workspace"
              ? { workspaceId: context.workspaceId }
              : {}),
            requestDigest: context.requestDigest,
            capabilityId,
            status: choice.type === "deny" ? "denied" : "granted",
            confirmationPolicy:
              choice.type === "deny" ? "persistent" : choice.confirmationPolicy,
            operationIds: [...operationIds],
            resourceIds: [...resourceIds],
            dataClassIds: [...dataClassIds],
            ...(choice.type === "allow" && choice.durationMs !== undefined
              ? { expiresAtMillis: now + choice.durationMs }
              : {}),
            ...(selectedRate === undefined
              ? {}
              : {
                  rateLimit: ProductCapabilityRateLimit.make(selectedRate),
                }),
            usage: ProductCapabilityUsage.make({
              totalInvocations: 0,
              windowInvocations: 0,
              windowStartedAtMillis: now,
            }),
            createdAtMillis: now,
            updatedAtMillis: now,
            authority: "protected-user",
          });
          yield* SynchronizedRef.updateEffect(state, (current) => {
            const replaced = current.decisions.filter(
              (candidate) =>
                candidate.scopeId === context.scopeId &&
                candidate.capabilityId === capabilityId,
            );
            const next: BrokerState = {
              ...current,
              decisions: [
                ...current.decisions.filter(
                  (candidate) =>
                    candidate.scopeId !== context.scopeId ||
                    candidate.capabilityId !== capabilityId,
                ),
                decision,
              ],
            };
            const mustSave = isDurable(decision) || replaced.some(isDurable);
            return mustSave
              ? store.save(durableDecisions(next)).pipe(
                  Effect.as(next),
                  Effect.mapError(() =>
                    brokerFailure("persistence-failed", capabilityId),
                  ),
                )
              : Effect.succeed(next);
          });
          const projections = yield* catalog(context);
          const projection = projections.find(
            (candidate) => candidate.capabilityId === capabilityId,
          );
          return projection === undefined
            ? yield* Effect.fail(
                brokerFailure("unknown-capability", capabilityId),
              )
            : projection;
        },
      );

      const revoke = Effect.fn("Flect.ProductCapabilityBroker.revoke")(
        function* (decisionId: string) {
          const now = yield* Clock.currentTimeMillis;
          yield* SynchronizedRef.updateEffect(state, (current) => {
            const existing = current.decisions.find(
              (decision) => decision.decisionId === decisionId,
            );
            if (existing === undefined) {
              return Effect.fail(brokerFailure("unknown-capability"));
            }
            const revoked = ProductCapabilityDecision.make({
              ...existing,
              status: "revoked",
              updatedAtMillis: now,
            });
            const next: BrokerState = {
              ...current,
              decisions: current.decisions.map((decision) =>
                decision.decisionId === decisionId ? revoked : decision,
              ),
            };
            return isDurable(existing)
              ? store.save(durableDecisions(next)).pipe(
                  Effect.as(next),
                  Effect.mapError(() =>
                    brokerFailure("persistence-failed", existing.capabilityId),
                  ),
                )
              : Effect.succeed(next);
          });
        },
      );

      const reserve = Effect.fn("Flect.ProductCapabilityBroker.reserve")(
        function* (
          context: ProductCapabilityRequestContext,
          operation: AuthorizedProductOperation,
        ) {
          yield* ensureLoaded(context);
          const manifest = manifests.get(operation.capabilityId);
          if (manifest === undefined) {
            return yield* Effect.fail(
              brokerFailure("unavailable", operation.capabilityId),
            );
          }
          if (
            !context.capabilities.some(
              (entry) => entry.capabilityId === operation.capabilityId,
            ) ||
            !manifest.operationIds.includes(operation.operationId)
          ) {
            return yield* Effect.fail(
              brokerFailure("denied", operation.capabilityId),
            );
          }
          if (
            !isSubset(operation.resourceIds, manifest.resourceIds) ||
            !isSubset(operation.dataClassIds, manifest.dataClassIds)
          ) {
            return yield* Effect.fail(
              brokerFailure("denied", operation.capabilityId),
            );
          }
          const now = yield* Clock.currentTimeMillis;
          return yield* SynchronizedRef.modifyEffect(state, (current) => {
            const decision = latestDecision(
              current,
              context,
              operation.capabilityId,
            );
            if (decision === undefined || decision.status === "denied") {
              return Effect.fail(
                brokerFailure("denied", operation.capabilityId),
              );
            }
            if (decision.status === "revoked") {
              return Effect.fail(
                brokerFailure("revoked", operation.capabilityId),
              );
            }
            if (
              (decision.expiresAtMillis !== undefined &&
                decision.expiresAtMillis <= now) ||
              (decision.confirmationPolicy === "once" &&
                (decision.usage?.totalInvocations ?? 0) >= 1)
            ) {
              return Effect.fail(
                brokerFailure("expired", operation.capabilityId),
              );
            }
            if (
              !decision.operationIds.includes(operation.operationId) ||
              !isSubset(operation.resourceIds, decision.resourceIds) ||
              !isSubset(operation.dataClassIds, decision.dataClassIds)
            ) {
              return Effect.fail(
                brokerFailure("denied", operation.capabilityId),
              );
            }
            const previous =
              decision.usage ??
              ProductCapabilityUsage.make({
                totalInvocations: 0,
                windowInvocations: 0,
                windowStartedAtMillis: now,
              });
            const windowReset =
              decision.rateLimit !== undefined &&
              now - previous.windowStartedAtMillis >=
                decision.rateLimit.intervalMs;
            const windowInvocations = windowReset
              ? 0
              : previous.windowInvocations;
            if (
              decision.rateLimit !== undefined &&
              windowInvocations >= decision.rateLimit.maxInvocations
            ) {
              return Effect.fail(
                brokerFailure("rate-limited", operation.capabilityId),
              );
            }
            const updated = ProductCapabilityDecision.make({
              ...decision,
              usage: ProductCapabilityUsage.make({
                totalInvocations: previous.totalInvocations + 1,
                windowInvocations: windowInvocations + 1,
                windowStartedAtMillis: windowReset
                  ? now
                  : previous.windowStartedAtMillis,
              }),
            });
            const next: BrokerState = {
              ...current,
              decisions: current.decisions.map((candidate) =>
                candidate.decisionId === decision.decisionId
                  ? updated
                  : candidate,
              ),
            };
            const reservation = ProductCapabilityReservation.make({
              version: 1,
              decisionId: decision.decisionId,
              capabilityId: operation.capabilityId,
              operationId: operation.operationId,
              confirmationPolicy: decision.confirmationPolicy,
              approvedResourceIds: [...decision.resourceIds],
              approvedDataClassIds: [...decision.dataClassIds],
            });
            return isDurable(decision)
              ? store.save(durableDecisions(next)).pipe(
                  Effect.as(transition(reservation, next)),
                  Effect.mapError(() =>
                    brokerFailure("persistence-failed", operation.capabilityId),
                  ),
                )
              : Effect.succeed(transition(reservation, next));
          });
        },
      );

      const validate = Effect.fn("Flect.ProductCapabilityBroker.validate")(
        function* (
          reservation: ProductCapabilityReservation,
          operation: AuthorizedProductOperation,
        ) {
          if (
            reservation.capabilityId !== operation.capabilityId ||
            reservation.operationId !== operation.operationId ||
            !isSubset(operation.resourceIds, reservation.approvedResourceIds) ||
            !isSubset(operation.dataClassIds, reservation.approvedDataClassIds)
          ) {
            return yield* Effect.fail(
              brokerFailure("denied", operation.capabilityId),
            );
          }
        },
      );

      const inspectReservation = Effect.fn(
        "Flect.ProductCapabilityBroker.inspectReservation",
      )(function* (reservation: ProductCapabilityReservation) {
        const current = yield* SynchronizedRef.get(state);
        const decision = current.decisions.find(
          (candidate) => candidate.decisionId === reservation.decisionId,
        );
        if (
          decision === undefined ||
          decision.capabilityId !== reservation.capabilityId ||
          !decision.operationIds.includes(reservation.operationId) ||
          !isSubset(reservation.approvedResourceIds, decision.resourceIds) ||
          !isSubset(reservation.approvedDataClassIds, decision.dataClassIds)
        ) {
          return yield* Effect.fail(
            brokerFailure("denied", reservation.capabilityId),
          );
        }
        if (decision.status === "revoked") {
          return yield* Effect.fail(
            brokerFailure("revoked", reservation.capabilityId),
          );
        }
        if (decision.status !== "granted") {
          return yield* Effect.fail(
            brokerFailure("denied", reservation.capabilityId),
          );
        }
        const now = yield* Clock.currentTimeMillis;
        if (
          decision.expiresAtMillis !== undefined &&
          decision.expiresAtMillis <= now
        ) {
          return yield* Effect.fail(
            brokerFailure("expired", reservation.capabilityId),
          );
        }
      });

      const withReservation = Effect.fn(
        "Flect.ProductCapabilityBroker.withReservation",
      )(
        <A, E>(
          reservation: ProductCapabilityReservation,
          operation: AuthorizedProductOperation,
          effect: Effect.Effect<A, E>,
        ) =>
          SynchronizedRef.modifyEffect(state, (current) =>
            Effect.gen(function* () {
              const decision = current.decisions.find(
                (candidate) => candidate.decisionId === reservation.decisionId,
              );
              if (
                decision === undefined ||
                decision.capabilityId !== reservation.capabilityId ||
                reservation.operationId !== operation.operationId ||
                reservation.capabilityId !== operation.capabilityId ||
                !decision.operationIds.includes(reservation.operationId) ||
                !isSubset(
                  reservation.approvedResourceIds,
                  decision.resourceIds,
                ) ||
                !isSubset(
                  reservation.approvedDataClassIds,
                  decision.dataClassIds,
                ) ||
                !isSubset(operation.resourceIds, reservation.approvedResourceIds) ||
                !isSubset(
                  operation.dataClassIds,
                  reservation.approvedDataClassIds,
                )
              ) {
                return yield* Effect.fail(
                  brokerFailure("denied", reservation.capabilityId),
                );
              }
              if (decision.status === "revoked") {
                return yield* Effect.fail(
                  brokerFailure("revoked", reservation.capabilityId),
                );
              }
              if (decision.status !== "granted") {
                return yield* Effect.fail(
                  brokerFailure("denied", reservation.capabilityId),
                );
              }
              const now = yield* Clock.currentTimeMillis;
              if (
                decision.expiresAtMillis !== undefined &&
                decision.expiresAtMillis <= now
              ) {
                return yield* Effect.fail(
                  brokerFailure("expired", reservation.capabilityId),
                );
              }
              const result = yield* effect;
              return [result, current] as const;
            }),
          ),
      );

      return {
        catalog,
        decide,
        inspectReservation,
        reserve,
        revoke,
        validate,
        withReservation,
        warnings: SynchronizedRef.get(state).pipe(
          Effect.map((current) => current.warnings),
        ),
      };
    }),
  );
