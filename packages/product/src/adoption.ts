import { Effect, Schema } from "effect";
import {
  isProductIntegration,
  ProductInferenceOwner,
  type ProductIntegration,
  ProductIntegrationFailure,
  ProductPlatform,
} from "./integration.js";
import {
  ProductCapabilityDecisionId,
  ProductCapabilityRequestDigest,
} from "./product-capability.js";

const SemanticVersion = Schema.String.check(
  Schema.isMinLength(5),
  Schema.isMaxLength(40),
  Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
);
const ProductId = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(120),
  Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
);
const Revision = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9._:/-]+$/),
);
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

export class ProductHostFacts extends Schema.Class<ProductHostFacts>(
  "ProductHostFacts",
)({
  version: Schema.Literal(1),
  flectVersion: SemanticVersion,
  platform: ProductPlatform,
  online: Schema.Boolean,
  productSessionAvailable: Schema.Boolean,
  brokerAvailable: Schema.Boolean,
  nativeAuthenticationAvailable: Schema.Boolean,
}) {}

export class ProductConnectionRecord extends Schema.Class<ProductConnectionRecord>(
  "ProductConnectionRecord",
)({
  version: Schema.Literal(1),
  productId: ProductId,
  integrationVersion: SemanticVersion,
  productRevision: Revision,
  capsuleVersion: SemanticVersion,
  archiveSha256: Sha256,
  capabilityDigest: Sha256,
  extensionDigest: Sha256,
}) {}

export class ProductUserState extends Schema.Class<ProductUserState>(
  "ProductUserState",
)({
  version: Schema.Literal(1),
  productId: ProductId,
  forkRevision: Schema.optionalKey(Revision),
  exportedSnapshotDigest: Schema.optionalKey(ProductCapabilityRequestDigest),
  decisionIds: Schema.Array(ProductCapabilityDecisionId).check(
    Schema.isMaxLength(128),
    Schema.isUnique(),
  ),
  selectedInferenceOwner: ProductInferenceOwner,
}) {}

export const ProductAdoptionReason = Schema.Literals([
  "incompatible-flect",
  "incompatible-host",
  "authentication-unavailable",
  "migration-blocked",
  "migration-required",
  "offline",
  "product-update",
  "capability-review",
  "extension-review",
  "detached",
  "fork-preserved",
  "ready",
]);
export type ProductAdoptionReason = typeof ProductAdoptionReason.Type;

const ProductAdoptionSeverity = Schema.Literals([
  "info",
  "warning",
  "blocking",
]);
const ProductAdoptionMessage = Schema.Literals([
  "This Flect version is not compatible with the product integration.",
  "This host is not compatible with the product integration.",
  "Product authentication is unavailable on this host.",
  "This product update cannot be applied safely.",
  "Review the product migration before updating.",
  "The product connection is offline; the accepted interface remains available.",
  "A reviewed product integration update is available.",
  "Review changed product capabilities before using them.",
  "Review changed product extensions before enabling them.",
  "The product connection was removed without removing user-owned work.",
  "The personal fork and export remain owned by the user.",
  "The product integration is ready.",
]);
const ProductAdoptionAction = Schema.Literals([
  "Keep the current experience or use a compatible Flect version.",
  "Use a supported host or keep the current experience.",
  "Configure the declared authentication adapter or use the product offline.",
  "Keep the current experience and ask the product team for a migration.",
  "Open protected review before applying the product update.",
  "Continue offline or reconnect the declared product adapter.",
  "Open protected review; do not overwrite the personal fork.",
  "Review and decide each changed capability.",
  "Review and explicitly enable each changed extension.",
  "Export or continue the preserved local workspace.",
  "Continue the local fork or export it at any time.",
  "Open the recommended experience or continue the personal fork.",
]);

interface DiagnosticFacts {
  readonly severity: "info" | "warning" | "blocking";
  readonly message: typeof ProductAdoptionMessage.Type;
  readonly action: typeof ProductAdoptionAction.Type;
}

const diagnosticFacts = (reason: ProductAdoptionReason): DiagnosticFacts => {
  switch (reason) {
    case "incompatible-flect":
      return {
        severity: "blocking",
        message:
          "This Flect version is not compatible with the product integration.",
        action:
          "Keep the current experience or use a compatible Flect version.",
      };
    case "incompatible-host":
      return {
        severity: "blocking",
        message: "This host is not compatible with the product integration.",
        action: "Use a supported host or keep the current experience.",
      };
    case "authentication-unavailable":
      return {
        severity: "blocking",
        message: "Product authentication is unavailable on this host.",
        action:
          "Configure the declared authentication adapter or use the product offline.",
      };
    case "migration-blocked":
      return {
        severity: "blocking",
        message: "This product update cannot be applied safely.",
        action:
          "Keep the current experience and ask the product team for a migration.",
      };
    case "migration-required":
      return {
        severity: "warning",
        message: "Review the product migration before updating.",
        action: "Open protected review before applying the product update.",
      };
    case "offline":
      return {
        severity: "warning",
        message:
          "The product connection is offline; the accepted interface remains available.",
        action: "Continue offline or reconnect the declared product adapter.",
      };
    case "product-update":
      return {
        severity: "warning",
        message: "A reviewed product integration update is available.",
        action: "Open protected review; do not overwrite the personal fork.",
      };
    case "capability-review":
      return {
        severity: "warning",
        message: "Review changed product capabilities before using them.",
        action: "Review and decide each changed capability.",
      };
    case "extension-review":
      return {
        severity: "warning",
        message: "Review changed product extensions before enabling them.",
        action: "Review and explicitly enable each changed extension.",
      };
    case "detached":
      return {
        severity: "info",
        message:
          "The product connection was removed without removing user-owned work.",
        action: "Export or continue the preserved local workspace.",
      };
    case "fork-preserved":
      return {
        severity: "info",
        message: "The personal fork and export remain owned by the user.",
        action: "Continue the local fork or export it at any time.",
      };
    case "ready":
      return {
        severity: "info",
        message: "The product integration is ready.",
        action:
          "Open the recommended experience or continue the personal fork.",
      };
  }
};

export class ProductAdoptionDiagnostic extends Schema.Class<ProductAdoptionDiagnostic>(
  "ProductAdoptionDiagnostic",
)(
  Schema.Struct({
    version: Schema.Literal(1),
    reason: ProductAdoptionReason,
    severity: ProductAdoptionSeverity,
    message: ProductAdoptionMessage,
    action: ProductAdoptionAction,
  }).check(
    Schema.makeFilter(
      (diagnostic) => {
        const facts = diagnosticFacts(diagnostic.reason);
        return (
          diagnostic.severity === facts.severity &&
          diagnostic.message === facts.message &&
          diagnostic.action === facts.action
        );
      },
      { expected: "a canonical product adoption diagnostic" },
    ),
  ),
) {}

export class ProductAdoptionSnapshot extends Schema.Class<ProductAdoptionSnapshot>(
  "ProductAdoptionSnapshot",
)({
  version: Schema.Literal(1),
  productId: ProductId,
  state: Schema.Literals(["ready", "review", "blocked", "offline", "detached"]),
  diagnostics: Schema.Array(ProductAdoptionDiagnostic).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(12),
  ),
  connection: Schema.optionalKey(ProductConnectionRecord),
  userState: ProductUserState,
}) {}

const diagnostic = (reason: ProductAdoptionReason): ProductAdoptionDiagnostic =>
  ProductAdoptionDiagnostic.make({
    version: 1,
    reason,
    ...diagnosticFacts(reason),
  });

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const parseVersion = (value: string): Version | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return [major, minor, patch].every(Number.isSafeInteger)
    ? { major, minor, patch }
    : undefined;
};

const compareVersion = (left: Version, right: Version): number =>
  left.major - right.major ||
  left.minor - right.minor ||
  left.patch - right.patch;

const satisfiesRange = (version: string, range: string): boolean => {
  const match = /^>=(\S+) <(\S+)$/.exec(range);
  const value = parseVersion(version);
  const minimum = match?.[1] === undefined ? undefined : parseVersion(match[1]);
  const maximum = match?.[2] === undefined ? undefined : parseVersion(match[2]);
  return (
    value !== undefined &&
    minimum !== undefined &&
    maximum !== undefined &&
    compareVersion(value, minimum) >= 0 &&
    compareVersion(value, maximum) < 0
  );
};

const invalidIntegration = () =>
  ProductIntegrationFailure.make({
    reason: "invalid-metadata",
    message: "The product integration is invalid.",
    recovery: "Review the product integration and keep the current experience.",
  });

export const createProductConnectionRecord = (
  integration: ProductIntegration,
): ProductConnectionRecord => {
  const descriptor = integration.metadata.descriptor;
  const experience = integration.metadata.experience;
  return ProductConnectionRecord.make({
    version: 1,
    productId: descriptor.id,
    integrationVersion: descriptor.integrationVersion,
    productRevision: descriptor.revision,
    capsuleVersion: experience.capsuleVersion,
    archiveSha256: experience.archiveSha256,
    capabilityDigest: integration.capabilityDigest,
    extensionDigest: integration.extensionDigest,
  });
};

export interface EvaluateProductAdoptionInput {
  readonly integration: ProductIntegration;
  readonly host: ProductHostFacts;
  readonly connection: ProductConnectionRecord | undefined;
  readonly userState: ProductUserState;
  readonly detached: boolean;
}

export const evaluateProductAdoption = Effect.fn(
  "Flect.ProductAdoption.evaluate",
)(function* (input: EvaluateProductAdoptionInput) {
  if (!isProductIntegration(input.integration)) {
    return yield* Effect.fail(invalidIntegration());
  }
  const descriptor = input.integration.metadata.descriptor;
  if (
    input.userState.productId !== descriptor.id ||
    (input.connection?.productId !== undefined &&
      input.connection.productId !== descriptor.id)
  ) {
    return yield* Effect.fail(invalidIntegration());
  }
  if (input.detached) {
    const diagnostics = [diagnostic("detached")];
    if (
      input.userState.forkRevision !== undefined ||
      input.userState.exportedSnapshotDigest !== undefined
    ) {
      diagnostics.push(diagnostic("fork-preserved"));
    }
    return ProductAdoptionSnapshot.make({
      version: 1,
      productId: descriptor.id,
      state: "detached",
      diagnostics,
      userState: input.userState,
    });
  }

  const reasons: Array<ProductAdoptionReason> = [];
  if (
    !satisfiesRange(input.host.flectVersion, descriptor.compatibility.flect)
  ) {
    reasons.push("incompatible-flect");
  }
  if (!descriptor.compatibility.platforms.includes(input.host.platform)) {
    reasons.push("incompatible-host");
  }
  const authenticationUnavailable =
    (descriptor.connection === "browser-direct" &&
      descriptor.authenticationOwner === "product" &&
      !input.host.productSessionAvailable) ||
    (descriptor.connection === "brokered" && !input.host.brokerAvailable) ||
    (descriptor.authenticationOwner === "host" &&
      input.host.platform === "macos" &&
      !input.host.brokerAvailable &&
      !input.host.nativeAuthenticationAvailable);
  if (authenticationUnavailable) {
    reasons.push("authentication-unavailable");
  }
  const previous = input.connection;
  if (
    previous !== undefined &&
    previous.integrationVersion !== descriptor.integrationVersion
  ) {
    const migration = input.integration.metadata.migrations.find(
      (candidate) =>
        candidate.from === previous.integrationVersion &&
        candidate.to === descriptor.integrationVersion,
    );
    reasons.push(
      migration?.disposition === "blocked"
        ? "migration-blocked"
        : "migration-required",
    );
  }
  if (descriptor.connection !== "offline" && !input.host.online) {
    reasons.push("offline");
  }
  const update =
    previous !== undefined &&
    (previous.integrationVersion !== descriptor.integrationVersion ||
      previous.productRevision !== descriptor.revision ||
      previous.capsuleVersion !==
        input.integration.metadata.experience.capsuleVersion ||
      previous.archiveSha256 !==
        input.integration.metadata.experience.archiveSha256);
  if (update) {
    reasons.push("product-update");
  }
  if (
    previous !== undefined &&
    previous.capabilityDigest !== input.integration.capabilityDigest
  ) {
    reasons.push("capability-review");
  }
  if (
    previous !== undefined &&
    previous.extensionDigest !== input.integration.extensionDigest
  ) {
    reasons.push("extension-review");
  }
  if (
    (update ||
      reasons.includes("capability-review") ||
      reasons.includes("extension-review")) &&
    (input.userState.forkRevision !== undefined ||
      input.userState.exportedSnapshotDigest !== undefined)
  ) {
    reasons.push("fork-preserved");
  }
  if (reasons.length === 0) {
    reasons.push("ready");
  }
  const diagnostics = reasons.map(diagnostic);
  const state = reasons.some((reason) =>
    [
      "incompatible-flect",
      "incompatible-host",
      "authentication-unavailable",
      "migration-blocked",
    ].includes(reason),
  )
    ? "blocked"
    : reasons.includes("offline")
      ? "offline"
      : reasons.some((reason) =>
            [
              "migration-required",
              "product-update",
              "capability-review",
              "extension-review",
            ].includes(reason),
          )
        ? "review"
        : "ready";
  return ProductAdoptionSnapshot.make({
    version: 1,
    productId: descriptor.id,
    state,
    diagnostics,
    ...(input.connection === undefined ? {} : { connection: input.connection }),
    userState: input.userState,
  });
});

export const detachProduct = Effect.fn("Flect.ProductAdoption.detach")(
  (input: Omit<EvaluateProductAdoptionInput, "detached">) =>
    evaluateProductAdoption({
      ...input,
      connection: undefined,
      detached: true,
    }),
);
