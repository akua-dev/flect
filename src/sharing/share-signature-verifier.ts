import { Cause, Context, Effect, Layer, Option } from "effect";
import type { ShareManifest } from "../../packages/product/src/share";
import { ShareSignatureAssessment } from "../../shared/share-review";

export { ShareSignatureAssessment } from "../../shared/share-review";

export interface ShareSignatureVerificationRequest {
  readonly manifest: ShareManifest;
  readonly archiveSha256: string;
  readonly keyId: string;
  readonly signature: Uint8Array;
}

export interface ShareSignatureVerifierShape {
  readonly verify: (
    manifest: ShareManifest,
    archiveSha256: string,
  ) => Effect.Effect<ShareSignatureAssessment>;
}

export class ShareSignatureVerifier extends Context.Service<
  ShareSignatureVerifier,
  ShareSignatureVerifierShape
>()("flect/ShareSignatureVerifier") {}

const decodeSignature = (value: string) =>
  Effect.try({
    try: () => {
      if (!/^[A-Za-z0-9+/]{86}==$/.test(value)) {
        throw new Error("invalid signature");
      }
      const decoded = atob(value);
      if (decoded.length !== 64) throw new Error("invalid signature");
      return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    },
    catch: () => undefined,
  }).pipe(Effect.option, Effect.map(Option.getOrUndefined));

export const makeShareSignatureVerifierLayer = (options?: {
  readonly verify?: (
    request: ShareSignatureVerificationRequest,
  ) => Effect.Effect<boolean>;
}) =>
  Layer.succeed(ShareSignatureVerifier)({
    verify: Effect.fn("Flect.ShareSignatureVerifier.verify")(
      function* (manifest, archiveSha256) {
        if (manifest.signatures.length === 0) {
          return ShareSignatureAssessment.make({
            status: "unsigned",
            keyIds: [],
            authoritative: false,
          });
        }
        const keyIds = manifest.signatures.map((claim) => claim.keyId);
        if (new Set(keyIds).size !== keyIds.length) {
          return ShareSignatureAssessment.make({
            status: "invalid",
            keyIds: [...new Set(keyIds)].toSorted(),
            authoritative: false,
          });
        }
        const claims = [];
        for (const claim of manifest.signatures) {
          const signature = yield* decodeSignature(claim.signature);
          if (signature === undefined) {
            return ShareSignatureAssessment.make({
              status: "invalid",
              keyIds: keyIds.toSorted(),
              authoritative: false,
            });
          }
          claims.push({ claim, signature });
        }
        if (options?.verify === undefined) {
          return ShareSignatureAssessment.make({
            status: "present-unverified",
            keyIds: keyIds.toSorted(),
            authoritative: false,
          });
        }
        const verified = yield* Effect.forEach(
          claims,
          ({ claim, signature }) =>
            options
              .verify?.({
                manifest,
                archiveSha256,
                keyId: claim.keyId,
                signature,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause)
                    : Effect.succeed(false),
                ),
              ) ?? Effect.succeed(false),
        );
        return ShareSignatureAssessment.make({
          status: verified.every(Boolean) ? "verified" : "invalid",
          keyIds: keyIds.toSorted(),
          authoritative: false,
        });
      },
    ),
  });

export const ShareSignatureVerifierLive = makeShareSignatureVerifierLayer();
