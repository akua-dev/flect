import { Schema } from "effect";
import { ProductSurfaceCapabilityId } from "./product-surface";

export const ProductActionRequestId = Schema.String.check(
  Schema.isMinLength(8),
  Schema.isMaxLength(80),
  Schema.isPattern(/^action-[a-z0-9-]+$/),
);

export const ProductActionName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[a-z][a-z0-9_]*$/),
);

export const ProductActionInputJson = Schema.String.check(
  Schema.isMinLength(2),
  Schema.isMaxLength(16_384),
);

export const ProductActionResultJson = Schema.String.check(
  Schema.isMinLength(2),
  Schema.isMaxLength(131_072),
);

export class AgentProductActionRequest extends Schema.Class<AgentProductActionRequest>(
  "AgentProductActionRequest",
)({
  type: Schema.Literal("product_action_request"),
  requestId: ProductActionRequestId,
  capabilityId: ProductSurfaceCapabilityId,
  action: ProductActionName,
  inputJson: ProductActionInputJson,
}) {}

export class ProductActionResult extends Schema.Class<ProductActionResult>(
  "ProductActionResult",
)({
  version: Schema.Literal(1),
  status: Schema.Literals(["ok", "denied", "error"]),
  resultJson: ProductActionResultJson,
}) {}

const ProductActionDisplayText = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(160),
);

const ProductActionSummary = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4_000),
);

export class ProductActionReadPrepared extends Schema.Class<ProductActionReadPrepared>(
  "ProductActionReadPrepared",
)({
  version: Schema.Literal(1),
  effect: Schema.Literal("read"),
  title: ProductActionDisplayText,
  resultJson: ProductActionResultJson,
}) {}

export class ProductActionWritePrepared extends Schema.Class<ProductActionWritePrepared>(
  "ProductActionWritePrepared",
)({
  version: Schema.Literal(1),
  effect: Schema.Literal("write"),
  title: ProductActionDisplayText,
  summary: ProductActionSummary,
}) {}

export class ProductActionWritten extends Schema.Class<ProductActionWritten>(
  "ProductActionWritten",
)({
  version: Schema.Literal(1),
  effect: Schema.Literal("written"),
  title: ProductActionDisplayText,
  resultJson: ProductActionResultJson,
}) {}

export const ProductActionPrepared = Schema.Union([
  ProductActionReadPrepared,
  ProductActionWritePrepared,
]);
