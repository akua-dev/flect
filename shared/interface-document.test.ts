import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  decodeInterfaceDocument,
  defaultInterfaceDocument,
  InterfaceDocument,
  validateInterfaceDocument,
} from "./interface-document";

const validDocument = {
  version: 2,
  name: "Product workspace",
  root: {
    id: "root",
    type: "stack",
    direction: "column",
    gap: "lg",
    children: [
      {
        id: "headline",
        type: "text",
        text: "Shape your workspace",
        style: "headline",
      },
      {
        id: "prompt",
        type: "prompt",
        placeholder: "Describe the interface you need",
      },
      {
        id: "actions",
        type: "stack",
        direction: "row",
        gap: "sm",
        children: [
          {
            id: "shape",
            type: "button",
            label: "Shape interface",
            action: "shape",
          },
          {
            id: "divider",
            type: "divider",
          },
          {
            id: "agent",
            type: "agent-panel",
            title: "Shape this interface",
          },
        ],
      },
    ],
  },
} as const;

const deeplyNestedDocument = (depth: number) => {
  let node: unknown = {
    id: "leaf",
    type: "text",
    text: "Too deep",
    style: "body",
  };

  for (let index = 0; index < depth; index += 1) {
    node = {
      id: `stack-${index}`,
      type: "stack",
      direction: "column",
      gap: "sm",
      children: [node],
    };
  }

  return {
    version: 2,
    name: "Pathological depth",
    root: node,
  };
};

describe("interface document", () => {
  it.effect("decodes a recursive document from the trusted component set", () =>
    Effect.gen(function* () {
      const document = yield* validateInterfaceDocument(validDocument);

      assert.instanceOf(document, InterfaceDocument);
      assert.strictEqual(document.version, 2);
      assert.strictEqual(document.root.type, "stack");
      if (document.root.type !== "stack") {
        return assert.fail("expected the root to be a stack");
      }
      assert.strictEqual(document.root.children.length, 3);
    }),
  );

  it.effect("rejects an unregistered component before rendering", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateInterfaceDocument({
          ...validDocument,
          root: {
            id: "root",
            type: "iframe",
            src: "https://untrusted.example",
          },
        }),
      );

      assert.strictEqual(error._tag, "InvalidInterfaceDocument");
      assert.strictEqual(error.message, "The interface document is invalid.");
    }),
  );

  it.effect("rejects unknown properties and unsafe actions", () =>
    Effect.gen(function* () {
      const unknownProperty = yield* Effect.flip(
        validateInterfaceDocument({
          ...validDocument,
          runtimeEndpoint: "https://unexpected.example",
        }),
      );
      const unsafeAction = yield* Effect.flip(
        validateInterfaceDocument({
          ...validDocument,
          root: {
            id: "root",
            type: "stack",
            direction: "column",
            gap: "md",
            children: [
              {
                id: "unsafe",
                type: "button",
                label: "Run",
                action: "shell:rm",
              },
            ],
          },
        }),
      );

      assert.strictEqual(unknownProperty._tag, "InvalidInterfaceDocument");
      assert.strictEqual(unsafeAction._tag, "InvalidInterfaceDocument");
    }),
  );

  it.effect("rejects unsupported launcher actions", () =>
    Effect.gen(function* () {
      for (const action of ["open", "extensions", "connect"] as const) {
        const error = yield* Effect.flip(
          validateInterfaceDocument({
            version: 2,
            name: "Unsupported action",
            root: {
              id: "root",
              type: "stack",
              direction: "column",
              gap: "md",
              children: [
                {
                  id: "unsupported",
                  type: "button",
                  label: "Unsupported",
                  action,
                },
              ],
            },
          }),
        );

        assert.strictEqual(error._tag, "InvalidInterfaceDocument");
      }
    }),
  );

  it.effect("rejects duplicate node identifiers", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateInterfaceDocument({
          ...validDocument,
          root: {
            id: "duplicate",
            type: "stack",
            direction: "column",
            gap: "sm",
            children: [
              {
                id: "duplicate",
                type: "text",
                text: "Duplicate",
                style: "body",
              },
            ],
          },
        }),
      );

      assert.strictEqual(error._tag, "InvalidInterfaceDocument");
    }),
  );

  it.effect("rejects trees deeper than ten levels", () =>
    Effect.gen(function* () {
      let node: unknown = {
        id: "leaf",
        type: "text",
        text: "Too deep",
        style: "body",
      };

      for (let depth = 0; depth < 11; depth += 1) {
        node = {
          id: `stack-${depth}`,
          type: "stack",
          direction: "column",
          gap: "sm",
          children: [node],
        };
      }

      const error = yield* Effect.flip(
        validateInterfaceDocument({
          version: 2,
          name: "Too deep",
          root: node,
        }),
      );

      assert.strictEqual(error._tag, "InvalidInterfaceDocument");
    }),
  );

  it.effect("rejects pathological depth before recursive decoding", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateInterfaceDocument(deeplyNestedDocument(2_000)),
      );

      assert.strictEqual(error._tag, "InvalidInterfaceDocument");
    }),
  );

  it.effect(
    "fails closed for malformed, unsupported, or missing stored state",
    () =>
      Effect.gen(function* () {
        const malformed = yield* decodeInterfaceDocument("{bad json");
        const unsupported = yield* decodeInterfaceDocument(
          JSON.stringify({ ...validDocument, version: 99 }),
        );
        const missing = yield* decodeInterfaceDocument(null);

        assert.strictEqual(malformed, defaultInterfaceDocument);
        assert.strictEqual(unsupported, defaultInterfaceDocument);
        assert.strictEqual(missing, defaultInterfaceDocument);
      }),
  );

  it.effect(
    "drops unsupported actions while migrating the legacy launcher",
    () =>
      Effect.gen(function* () {
        const document = yield* decodeInterfaceDocument(
          JSON.stringify({
            version: 1,
            headline: "Where should we begin?",
            placeholder: "Describe an interface",
            secondaryActions: ["open"],
          }),
        );

        assert.strictEqual(document.version, 2);
        assert.strictEqual(document.name, "Where should we begin?");
        assert.strictEqual(document.root.type, "stack");
        if (document.root.type !== "stack") {
          return assert.fail("expected the migrated root to be a stack");
        }
        assert.strictEqual(document.root.children.length, 2);
      }),
  );
});
