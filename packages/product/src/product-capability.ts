import { Schema } from "effect";

export const ProductOperationId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z][a-z0-9.-]*$/),
);
export const ProductCapabilityId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z][a-z0-9.:-]*$/),
);
export const ProductCapabilityGrantScopeId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
);

export const ProductCapabilityDecisionId = Schema.String.check(
  Schema.isMinLength(17),
  Schema.isMaxLength(100),
  Schema.isPattern(/^decision-[a-z0-9][a-z0-9-]*$/),
);
export const ProductCapabilityWorkspaceId = Schema.String.check(
  Schema.isMinLength(11),
  Schema.isMaxLength(100),
  Schema.isPattern(/^workspace-[a-z0-9][a-z0-9-]*$/),
);
export const ProductCapabilityResourceId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z][a-z0-9.:-]*$/),
);
export const ProductCapabilityDataClassId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z][a-z0-9.:-]*$/),
);
export const ProductCapabilityRequestDigest = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/),
);
export const ProductCapabilityConfirmationPolicy = Schema.Literals([
  "once",
  "session",
  "workspace",
  "persistent",
]);
export type ProductCapabilityConfirmationPolicy =
  typeof ProductCapabilityConfirmationPolicy.Type;
export const ProductCapabilityDecisionStatus = Schema.Literals([
  "granted",
  "denied",
  "revoked",
]);
export type ProductCapabilityDecisionStatus =
  typeof ProductCapabilityDecisionStatus.Type;
export const ProductCapabilityLifecycleState = Schema.Literals([
  "available",
  "requested",
  "granted",
  "denied",
  "expired",
  "revoked",
]);
export type ProductCapabilityLifecycleState =
  typeof ProductCapabilityLifecycleState.Type;

const TimestampMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const DurationMillis = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 31_536_000_000 }),
);
const OperationIds = Schema.Array(ProductOperationId).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isUnique(),
);
const ResourceIds = Schema.Array(ProductCapabilityResourceId).check(
  Schema.isMaxLength(64),
  Schema.isUnique(),
);
const DataClassIds = Schema.Array(ProductCapabilityDataClassId).check(
  Schema.isMaxLength(64),
  Schema.isUnique(),
);

export class ProductCapabilityRateLimit extends Schema.Class<ProductCapabilityRateLimit>(
  "ProductCapabilityRateLimit",
)({
  maxInvocations: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 10_000 }),
  ),
  intervalMs: Schema.Int.check(
    Schema.isBetween({ minimum: 100, maximum: 86_400_000 }),
  ),
}) {}

export class ProductCapabilityUsage extends Schema.Class<ProductCapabilityUsage>(
  "ProductCapabilityUsage",
)({
  totalInvocations: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 10_000 }),
  ),
  windowInvocations: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 10_000 }),
  ),
  windowStartedAtMillis: TimestampMillis,
}) {}

export class ProductCapabilityManifest extends Schema.Class<ProductCapabilityManifest>(
  "ProductCapabilityManifest",
)(
  Schema.Struct({
    version: Schema.Literal(1),
    id: ProductCapabilityId,
    name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
    description: Schema.Trim.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(240),
    ),
    operationIds: OperationIds,
    resourceIds: ResourceIds,
    dataClassIds: DataClassIds,
    confirmationPolicies: Schema.Array(
      ProductCapabilityConfirmationPolicy,
    ).check(Schema.isMinLength(1), Schema.isMaxLength(4), Schema.isUnique()),
    maxGrantDurationMs: Schema.optionalKey(DurationMillis),
    maxRate: Schema.optionalKey(ProductCapabilityRateLimit),
  }),
) {}

const ProductCapabilityDecisionFields = Schema.Struct({
  version: Schema.Literal(2),
  decisionId: ProductCapabilityDecisionId,
  scopeId: ProductCapabilityGrantScopeId,
  workspaceId: Schema.optionalKey(ProductCapabilityWorkspaceId),
  requestDigest: ProductCapabilityRequestDigest,
  capabilityId: ProductCapabilityId,
  status: ProductCapabilityDecisionStatus,
  confirmationPolicy: ProductCapabilityConfirmationPolicy,
  operationIds: OperationIds,
  resourceIds: ResourceIds,
  dataClassIds: DataClassIds,
  expiresAtMillis: Schema.optionalKey(TimestampMillis),
  rateLimit: Schema.optionalKey(ProductCapabilityRateLimit),
  usage: Schema.optionalKey(ProductCapabilityUsage),
  createdAtMillis: TimestampMillis,
  updatedAtMillis: TimestampMillis,
  authority: Schema.Literal("protected-user"),
}).check(
  Schema.makeFilter((decision) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (
      decision.confirmationPolicy === "workspace" &&
      decision.workspaceId === undefined
    ) {
      issues.push({
        path: ["workspaceId"],
        issue: "a workspace decision requires a workspace ID",
      });
    }
    if (
      decision.confirmationPolicy !== "workspace" &&
      decision.workspaceId !== undefined
    ) {
      issues.push({
        path: ["workspaceId"],
        issue: "only a workspace decision may contain a workspace ID",
      });
    }
    if (decision.updatedAtMillis < decision.createdAtMillis) {
      issues.push({
        path: ["updatedAtMillis"],
        issue: "the update time must not precede creation",
      });
    }
    if (
      decision.expiresAtMillis !== undefined &&
      decision.expiresAtMillis < decision.createdAtMillis
    ) {
      issues.push({
        path: ["expiresAtMillis"],
        issue: "the expiry time must not precede creation",
      });
    }
    return issues;
  }),
);

export class ProductCapabilityDecision extends Schema.Class<ProductCapabilityDecision>(
  "ProductCapabilityDecision",
)(ProductCapabilityDecisionFields) {}

export class ProductCapabilityDecisionRecord extends Schema.Class<ProductCapabilityDecisionRecord>(
  "ProductCapabilityDecisionRecord",
)(
  Schema.Struct({
    version: Schema.Literal(2),
    decisions: Schema.Array(ProductCapabilityDecision).check(
      Schema.isMaxLength(128),
    ),
  }).check(
    Schema.makeFilter(
      (record) =>
        new Set(record.decisions.map((decision) => decision.decisionId))
          .size === record.decisions.length,
      { expected: "unique capability decision IDs" },
    ),
  ),
) {}

export class ProductCapabilityProjection extends Schema.Class<ProductCapabilityProjection>(
  "ProductCapabilityProjection",
)({
  version: Schema.Literal(1),
  scopeId: ProductCapabilityGrantScopeId,
  workspaceId: ProductCapabilityWorkspaceId,
  requestDigest: ProductCapabilityRequestDigest,
  revision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  capabilityId: ProductCapabilityId,
  state: ProductCapabilityLifecycleState,
  availability: Schema.Literals(["available", "unavailable"]),
  requested: Schema.Boolean,
  required: Schema.Boolean,
  confirmationPolicies: Schema.Array(ProductCapabilityConfirmationPolicy).check(
    Schema.isMaxLength(4),
    Schema.isUnique(),
  ),
  operationIds: Schema.Array(ProductOperationId).check(
    Schema.isMaxLength(64),
    Schema.isUnique(),
  ),
  resourceIds: ResourceIds,
  dataClassIds: DataClassIds,
  decisionId: Schema.optionalKey(ProductCapabilityDecisionId),
  confirmationPolicy: Schema.optionalKey(ProductCapabilityConfirmationPolicy),
  expiresAtMillis: Schema.optionalKey(TimestampMillis),
  rateLimit: Schema.optionalKey(ProductCapabilityRateLimit),
}) {}

export class ProductCapabilityRequestEntry extends Schema.Class<ProductCapabilityRequestEntry>(
  "ProductCapabilityRequestEntry",
)({
  capabilityId: ProductCapabilityId,
  required: Schema.Boolean,
}) {}

export class ProductCapabilityRequestContext extends Schema.Class<ProductCapabilityRequestContext>(
  "ProductCapabilityRequestContext",
)(
  Schema.Struct({
    version: Schema.Literal(1),
    scopeId: ProductCapabilityGrantScopeId,
    workspaceId: ProductCapabilityWorkspaceId,
    requestDigest: ProductCapabilityRequestDigest,
    revision: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(128),
    ),
    capabilities: Schema.Array(ProductCapabilityRequestEntry).check(
      Schema.isMaxLength(128),
    ),
  }).check(
    Schema.makeFilter(
      (context) =>
        new Set(
          context.capabilities.map((capability) => capability.capabilityId),
        ).size === context.capabilities.length,
      { expected: "unique requested capability IDs" },
    ),
  ),
) {}

export class ProductCapabilityAllowChoice extends Schema.Class<ProductCapabilityAllowChoice>(
  "ProductCapabilityAllowChoice",
)({
  type: Schema.Literal("allow"),
  confirmationPolicy: ProductCapabilityConfirmationPolicy,
  durationMs: Schema.optionalKey(DurationMillis),
  rateLimit: Schema.optionalKey(ProductCapabilityRateLimit),
  operationIds: Schema.optionalKey(OperationIds),
  resourceIds: Schema.optionalKey(ResourceIds),
  dataClassIds: Schema.optionalKey(DataClassIds),
}) {}

export class ProductCapabilityDenyChoice extends Schema.Class<ProductCapabilityDenyChoice>(
  "ProductCapabilityDenyChoice",
)({ type: Schema.Literal("deny") }) {}

export const ProductCapabilityDecisionChoice = Schema.Union([
  ProductCapabilityAllowChoice,
  ProductCapabilityDenyChoice,
]);
export type ProductCapabilityDecisionChoice =
  typeof ProductCapabilityDecisionChoice.Type;

export class AuthorizedProductOperation extends Schema.Class<AuthorizedProductOperation>(
  "AuthorizedProductOperation",
)({
  version: Schema.Literal(1),
  capabilityId: ProductCapabilityId,
  operationId: ProductOperationId,
  resourceIds: ResourceIds,
  dataClassIds: DataClassIds,
}) {}

export class ProductCapabilityReservation extends Schema.Class<ProductCapabilityReservation>(
  "ProductCapabilityReservation",
)({
  version: Schema.Literal(1),
  decisionId: ProductCapabilityDecisionId,
  capabilityId: ProductCapabilityId,
  operationId: ProductOperationId,
  confirmationPolicy: ProductCapabilityConfirmationPolicy,
  approvedResourceIds: ResourceIds,
  approvedDataClassIds: DataClassIds,
}) {}

export class ProductCapabilityBrokerFailure extends Schema.TaggedErrorClass<ProductCapabilityBrokerFailure>()(
  "ProductCapabilityBrokerFailure",
  {
    capabilityId: Schema.optionalKey(ProductCapabilityId),
    reason: Schema.Literals([
      "unknown-capability",
      "not-requested",
      "invalid-scope",
      "persistence-failed",
      "denied",
      "expired",
      "revoked",
      "rate-limited",
      "unavailable",
    ]),
    message: Schema.Literals([
      "The product capability is unavailable.",
      "The product capability was not requested.",
      "The requested capability scope is invalid.",
      "The product capability decision could not be saved.",
      "The product operation was denied.",
      "The product capability grant has expired.",
      "The product capability grant was revoked.",
      "The product operation is temporarily limited.",
      "This capability is unavailable on this platform.",
    ]),
  },
) {}

export class ProductOperationExecution extends Schema.Class<ProductOperationExecution>(
  "ProductOperationExecution",
)({
  version: Schema.Literal(1),
  output: Schema.Json,
  reservation: ProductCapabilityReservation,
}) {}

export class ProductCapabilityReceipt extends Schema.Class<ProductCapabilityReceipt>(
  "ProductCapabilityReceipt",
)({
  version: Schema.Literal(1),
  scopeId: ProductCapabilityGrantScopeId,
  workspaceId: ProductCapabilityWorkspaceId,
  requestDigest: ProductCapabilityRequestDigest,
  revision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  capabilityId: ProductCapabilityId,
  decisionId: Schema.optionalKey(ProductCapabilityDecisionId),
  confirmationPolicy: Schema.optionalKey(ProductCapabilityConfirmationPolicy),
  operationId: ProductOperationId,
  result: Schema.Literals([
    "succeeded",
    "denied",
    "expired",
    "revoked",
    "rate-limited",
    "product-denied",
    "unavailable",
    "invalid-input",
    "request-failed",
    "invalid-output",
  ]),
}) {}

export class ProductOperationInvocation extends Schema.Class<ProductOperationInvocation>(
  "ProductOperationInvocation",
)({
  version: Schema.Literal(1),
  operationId: ProductOperationId,
  input: Schema.Json,
}) {}

export class ProductOperationSummary extends Schema.Class<ProductOperationSummary>(
  "ProductOperationSummary",
)({
  version: Schema.Literal(1),
  id: ProductOperationId,
  capabilityId: ProductCapabilityId,
  permission: Schema.optionalKey(ProductCapabilityProjection),
}) {}

export class ProductCapabilityGrantState extends Schema.Class<ProductCapabilityGrantState>(
  "ProductCapabilityGrantState",
)({
  scopeId: ProductCapabilityGrantScopeId,
  capabilityId: ProductCapabilityId,
  granted: Schema.Boolean,
}) {}

export class ProductCapabilityGrantRecord extends Schema.Class<ProductCapabilityGrantRecord>(
  "ProductCapabilityGrantRecord",
)({
  version: Schema.Literal(1),
  states: Schema.Array(ProductCapabilityGrantState).check(
    Schema.isMaxLength(128),
  ),
}) {}

export class ProductOperationFailure extends Schema.TaggedErrorClass<ProductOperationFailure>()(
  "ProductOperationFailure",
  {
    operationId: ProductOperationId,
    reason: Schema.Literals([
      "denied",
      "expired",
      "revoked",
      "rate-limited",
      "product-denied",
      "unavailable",
      "invalid-input",
      "request-failed",
      "invalid-output",
    ]),
    message: Schema.Literals([
      "The product operation was denied.",
      "The product capability grant has expired.",
      "The product capability grant was revoked.",
      "The product operation is temporarily limited.",
      "The product denied this operation.",
      "This capability is unavailable on this platform.",
      "The product operation input is invalid.",
      "The product operation failed safely.",
      "The product operation returned an invalid result.",
    ]),
  },
) {}

export const makeProductOperationFailure = (
  operationId: string,
  reason: ProductOperationFailure["reason"],
): ProductOperationFailure => {
  switch (reason) {
    case "expired":
      return ProductOperationFailure.make({
        operationId,
        reason,
        message: "The product capability grant has expired.",
      });
    case "revoked":
      return ProductOperationFailure.make({
        operationId,
        reason,
        message: "The product capability grant was revoked.",
      });
    case "rate-limited":
      return ProductOperationFailure.make({
        operationId,
        reason,
        message: "The product operation is temporarily limited.",
      });
    case "product-denied":
      return ProductOperationFailure.make({
        operationId,
        reason,
        message: "The product denied this operation.",
      });
    case "unavailable":
      return ProductOperationFailure.make({
        operationId,
        reason,
        message: "This capability is unavailable on this platform.",
      });
    case "invalid-input":
      return ProductOperationFailure.make({
        operationId,
        reason,
        message: "The product operation input is invalid.",
      });
    case "request-failed":
      return ProductOperationFailure.make({
        operationId,
        reason,
        message: "The product operation failed safely.",
      });
    case "invalid-output":
      return ProductOperationFailure.make({
        operationId,
        reason,
        message: "The product operation returned an invalid result.",
      });
    case "denied":
      return ProductOperationFailure.make({
        operationId,
        reason,
        message: "The product operation was denied.",
      });
  }
};

export type ProductJson = typeof Schema.Json.Type;
