import {
  makePrivateShareSourcesLayer,
  SharePrivateSource,
  ShareSourceFailure,
} from "@flect/product";
import { Effect, Schema } from "effect";

export class PrivateSharingTransportError extends Schema.TaggedErrorClass<PrivateSharingTransportError>()(
  "PrivateSharingTransportError",
  {
    reason: Schema.Literals(["authentication", "request", "unavailable"]),
    message: Schema.String,
  },
) {}

export interface PrivateSharingTransportRequest {
  readonly reference: string;
  readonly authorization: string;
}

export interface PrivateSharingReferenceOptions {
  readonly credential: string;
  readonly load: (
    request: PrivateSharingTransportRequest,
  ) => Effect.Effect<Uint8Array, PrivateSharingTransportError>;
}

const publicAdapterFailure = () =>
  ShareSourceFailure.make({
    reason: "adapter",
    message: "The private share source could not be opened.",
  });

export const makePrivateSharingReference = (
  options: PrivateSharingReferenceOptions,
) => {
  const source = SharePrivateSource.make({
    _tag: "private",
    adapterId: "company-library",
    reference: "team/weather/1.0.0",
  });
  const layer = makePrivateShareSourcesLayer({
    sources: [
      {
        id: "company-library",
        name: "Company library",
        open: (reference) =>
          options
            .load({
              reference,
              authorization: `Bearer ${options.credential}`,
            })
            .pipe(Effect.mapError(publicAdapterFailure)),
      },
    ],
  });

  return { layer, source };
};
