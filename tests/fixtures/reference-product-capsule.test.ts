import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeCapsule } from "../../shared/capsule";
import {
  REFERENCE_APP_AGENT_INSTRUCTIONS,
  referenceProductCapsule,
} from "./reference-product-capsule";

const capabilityIds = [
  "product.reference.status",
  "product.reference.projects.read",
  "product.reference.projects.write",
  "product.reference.projects.events",
];

const operationIds = [
  "reference.status",
  "reference.projects.list",
  "reference.projects.archive",
  "reference.projects.subscribe",
];

describe("reference product capsule", () => {
  it.effect(
    "contains only named public product authority and instructions",
    () =>
      Effect.gen(function* () {
        const decoded = yield* referenceProductCapsule.pipe(
          Effect.flatMap(decodeCapsule),
        );
        assert.deepStrictEqual(
          decoded.manifest.capabilities.map((capability) => capability.id),
          capabilityIds,
        );
        for (const operationId of operationIds) {
          assert.include(REFERENCE_APP_AGENT_INSTRUCTIONS, operationId);
        }
        assert.notInclude(REFERENCE_APP_AGENT_INSTRUCTIONS, "https://");
        assert.notInclude(REFERENCE_APP_AGENT_INSTRUCTIONS, "mutation {");
        assert.notInclude(JSON.stringify(decoded.manifest), "host-secret");
      }),
  );
});
