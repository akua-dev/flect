import { Schema } from "effect";

export class CapsuleTrustDiagnosticResult extends Schema.Class<CapsuleTrustDiagnosticResult>(
  "CapsuleTrustDiagnosticResult",
)({
  verified: Schema.Literal("verified"),
  changed: Schema.Literal("changed-after-signing"),
  forked: Schema.Literal("locally-forked"),
  permissionAuthorityChanged: Schema.Literal(false),
}) {}
