import { Context, Effect, Layer } from "effect";
import {
  type CapsulePublisherKey,
  type CapsuleSignatureAssessment,
  type CapsuleTrustDecision,
  type CapsuleTrustFailure,
  type CapsuleTrustPolicy,
  evaluateCapsuleTrustPolicy,
  verifyCapsuleSignatures,
} from "../../packages/product/src/capsule-trust";

export interface CapsuleTrustVerification {
  readonly assessment: CapsuleSignatureAssessment;
  readonly decision: CapsuleTrustDecision;
}

export interface CapsuleTrustVerifierShape {
  readonly verify: (
    archive: Uint8Array,
  ) => Effect.Effect<CapsuleTrustVerification, CapsuleTrustFailure>;
}

export class CapsuleTrustVerifier extends Context.Service<
  CapsuleTrustVerifier,
  CapsuleTrustVerifierShape
>()("flect/CapsuleTrustVerifier") {}

export const makeCapsuleTrustVerifierLayer = (options?: {
  readonly keys?: ReadonlyArray<CapsulePublisherKey>;
  readonly policy?: CapsuleTrustPolicy;
}) => {
  const keys = options?.keys ?? [];
  const policy = options?.policy ?? ({ mode: "allow-unverified" } as const);
  return Layer.succeed(CapsuleTrustVerifier)({
    verify: Effect.fn("Flect.CapsuleTrustVerifier.verify")((archive) =>
      verifyCapsuleSignatures(archive, keys).pipe(
        Effect.map((assessment) => ({
          assessment,
          decision: evaluateCapsuleTrustPolicy(assessment, policy),
        })),
      ),
    ),
  });
};

export const CapsuleTrustVerifierLive = makeCapsuleTrustVerifierLayer();
