import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  decodeInterfaceDocument,
  defaultInterfaceDocument,
  InterfaceDocument,
} from "./interface-document";

describe("interface document", () => {
  it.effect("loads a valid version-one document", () =>
    Effect.gen(function* () {
      const document = yield* decodeInterfaceDocument(
        JSON.stringify({
          version: 1,
          headline: "Shape your workspace",
          placeholder: "Describe the interface you need",
          secondaryActions: ["open", "connect"],
        }),
      );

      expect(document).toEqual(
        new InterfaceDocument({
          version: 1,
          headline: "Shape your workspace",
          placeholder: "Describe the interface you need",
          secondaryActions: ["open", "connect"],
        }),
      );
    }),
  );

  it.effect("fails closed for malformed JSON", () =>
    Effect.gen(function* () {
      const document = yield* decodeInterfaceDocument("{bad json");
      expect(document).toBe(defaultInterfaceDocument);
    }),
  );

  it.effect("fails closed for unsupported versions and excess fields", () =>
    Effect.gen(function* () {
      const unsupported = yield* decodeInterfaceDocument(
        JSON.stringify({
          version: 2,
          headline: "Replace the protected core",
          placeholder: "Anything",
          secondaryActions: [],
        }),
      );
      const excessive = yield* decodeInterfaceDocument(
        JSON.stringify({
          version: 1,
          headline: "Replace the protected core",
          placeholder: "Anything",
          secondaryActions: [],
          runtimeEndpoint: "https://unexpected.example",
        }),
      );

      expect(unsupported).toBe(defaultInterfaceDocument);
      expect(excessive).toBe(defaultInterfaceDocument);
    }),
  );

  it.effect("uses the built-in document when no custom state exists", () =>
    Effect.gen(function* () {
      const missing = yield* decodeInterfaceDocument(null);
      const undefinedState = yield* decodeInterfaceDocument(undefined);

      expect(missing).toBe(defaultInterfaceDocument);
      expect(undefinedState).toBe(defaultInterfaceDocument);
    }),
  );
});
