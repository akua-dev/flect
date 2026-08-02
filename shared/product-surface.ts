import { Schema } from "effect";

export const ProductSurfaceCapabilityId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
);

const DisplayText = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
);

const LoopbackOrigin = Schema.String.check(
  Schema.isPattern(
    /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[1-9][0-9]{0,4})?$/,
  ),
);

const RelativeEntryPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
  Schema.isPattern(
    /^\/(?!\/)(?!.*(?:token|credential|secret|authorization)=)(?!.*#)[A-Za-z0-9\-._~/?=&%]*$/i,
  ),
);

const RelativeAgentActionPath = Schema.String.check(
  Schema.isMinLength(2),
  Schema.isMaxLength(500),
  Schema.isPattern(
    /^\/(?!\/)(?!.*(?:token|credential|secret|authorization)=)(?!.*[?#])[A-Za-z0-9\-._~/%]*$/i,
  ),
);

const SecretText = Schema.String.check(
  Schema.isMinLength(16),
  Schema.isMaxLength(500),
);

const IsoTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/),
);

export class ProductSurfaceRegistration extends Schema.Class<ProductSurfaceRegistration>(
  "ProductSurfaceRegistration",
)({
  version: Schema.Literal(1),
  capabilityId: ProductSurfaceCapabilityId,
  title: DisplayText,
  origin: LoopbackOrigin,
  entryPath: RelativeEntryPath,
  agentActionPath: Schema.optionalKey(RelativeAgentActionPath),
  sessionCredential: SecretText,
  expiresAt: IsoTimestamp,
}) {}

export class ProductSurfaceSummary extends Schema.Class<ProductSurfaceSummary>(
  "ProductSurfaceSummary",
)({
  version: Schema.Literal(1),
  capabilityId: ProductSurfaceCapabilityId,
  title: DisplayText,
  origin: LoopbackOrigin,
  status: Schema.Literals(["pending", "granted"]),
  expiresAt: IsoTimestamp,
}) {}

export class ResolvedProductSurface extends Schema.Class<ResolvedProductSurface>(
  "ResolvedProductSurface",
)({
  version: Schema.Literal(1),
  capabilityId: ProductSurfaceCapabilityId,
  title: DisplayText,
  origin: LoopbackOrigin,
  entryPath: RelativeEntryPath,
  agentActionPath: Schema.optionalKey(RelativeAgentActionPath),
  sessionCredential: SecretText,
}) {}

export class ProductSurfaceRevoked extends Schema.Class<ProductSurfaceRevoked>(
  "ProductSurfaceRevoked",
)({
  version: Schema.Literal(1),
  capabilityId: ProductSurfaceCapabilityId,
  status: Schema.Literal("revoked"),
}) {}

export class ProductSurfaceCapabilityMessage extends Schema.Class<ProductSurfaceCapabilityMessage>(
  "ProductSurfaceCapabilityMessage",
)({
  version: Schema.Literal(1),
  type: Schema.Literal("product-surface-capability"),
  capabilityId: ProductSurfaceCapabilityId,
  credential: SecretText,
}) {}
