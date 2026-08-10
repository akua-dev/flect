import { Schema } from "effect";
import { AgentIntegrationHost } from "./setup";

export const UninstallOwnedKind = Schema.Literals([
  "shell-link",
  "agent-integration",
]);
export type UninstallOwnedKind = typeof UninstallOwnedKind.Type;

export const UninstallOwnedResult = Schema.Literals([
  "pending",
  "absent",
  "preserved-conflict",
  "removed",
  "failed",
]);
export type UninstallOwnedResult = typeof UninstallOwnedResult.Type;

export class UninstallApplication extends Schema.Class<UninstallApplication>(
  "UninstallApplication",
)({
  path: Schema.String,
  action: Schema.Literal("move-to-trash"),
}) {}

export class UninstallOwnedItem extends Schema.Class<UninstallOwnedItem>(
  "UninstallOwnedItem",
)({
  kind: UninstallOwnedKind,
  host: Schema.optional(AgentIntegrationHost),
  path: Schema.String,
  result: UninstallOwnedResult,
}) {}

export const UninstallRetainedKind = Schema.Literals([
  "workspace-data",
  "provider-authentication",
  "exports",
]);
export type UninstallRetainedKind = typeof UninstallRetainedKind.Type;

export class UninstallRetainedItem extends Schema.Class<UninstallRetainedItem>(
  "UninstallRetainedItem",
)({
  kind: UninstallRetainedKind,
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
}) {}

export class UninstallPlan extends Schema.Class<UninstallPlan>("UninstallPlan")(
  {
    version: Schema.Literal(1),
    application: UninstallApplication,
    ownedIntegrations: Schema.Array(UninstallOwnedItem),
    retained: Schema.Array(UninstallRetainedItem),
  },
) {}

export class UninstallError extends Schema.TaggedErrorClass<UninstallError>()(
  "UninstallError",
  {
    reason: Schema.Literals(["invalid-application", "inspect-failed"]),
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(300),
    ),
  },
) {}
