import { Effect, Schema, type SchemaAST } from "effect";

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const DisplayText = (maximum: number) =>
  Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(maximum));

const NodeId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
);

export interface StackNode {
  readonly id: string;
  readonly type: "stack";
  readonly direction: "row" | "column";
  readonly gap: "sm" | "md" | "lg";
  readonly children: ReadonlyArray<InterfaceNode>;
}

export interface TextNode {
  readonly id: string;
  readonly type: "text";
  readonly text: string;
  readonly style: "headline" | "body" | "muted";
}

export interface PromptNode {
  readonly id: string;
  readonly type: "prompt";
  readonly placeholder: string;
}

export interface ButtonNode {
  readonly id: string;
  readonly type: "button";
  readonly label: string;
  readonly action:
    | "open"
    | "extensions"
    | "connect"
    | "shape"
    | "safe-mode"
    | "accept-revision"
    | "reject-revision"
    | "rollback-revision";
}

export interface DividerNode {
  readonly id: string;
  readonly type: "divider";
}

export interface AgentPanelNode {
  readonly id: string;
  readonly type: "agent-panel";
  readonly title: string;
}

export type InterfaceNode =
  | StackNode
  | TextNode
  | PromptNode
  | ButtonNode
  | DividerNode
  | AgentPanelNode;

export const StackNode: Schema.Codec<StackNode> = Schema.Struct({
  id: NodeId,
  type: Schema.Literal("stack"),
  direction: Schema.Literals(["row", "column"]),
  gap: Schema.Literals(["sm", "md", "lg"]),
  children: Schema.Array(
    Schema.suspend((): Schema.Codec<InterfaceNode> => InterfaceNode),
  ).check(Schema.isMaxLength(30)),
});

export const TextNode: Schema.Codec<TextNode> = Schema.Struct({
  id: NodeId,
  type: Schema.Literal("text"),
  text: DisplayText(2_000),
  style: Schema.Literals(["headline", "body", "muted"]),
});

export const PromptNode: Schema.Codec<PromptNode> = Schema.Struct({
  id: NodeId,
  type: Schema.Literal("prompt"),
  placeholder: DisplayText(120),
});

export const ButtonNode: Schema.Codec<ButtonNode> = Schema.Struct({
  id: NodeId,
  type: Schema.Literal("button"),
  label: DisplayText(80),
  action: Schema.Literals([
    "open",
    "extensions",
    "connect",
    "shape",
    "safe-mode",
    "accept-revision",
    "reject-revision",
    "rollback-revision",
  ]),
});

export const DividerNode: Schema.Codec<DividerNode> = Schema.Struct({
  id: NodeId,
  type: Schema.Literal("divider"),
});

export const AgentPanelNode: Schema.Codec<AgentPanelNode> = Schema.Struct({
  id: NodeId,
  type: Schema.Literal("agent-panel"),
  title: DisplayText(80),
});

export const InterfaceNode: Schema.Codec<InterfaceNode> = Schema.Union([
  StackNode,
  TextNode,
  PromptNode,
  ButtonNode,
  DividerNode,
  AgentPanelNode,
]);

export class InterfaceDocument extends Schema.Class<InterfaceDocument>(
  "InterfaceDocument",
)({
  version: Schema.Literal(2),
  name: DisplayText(80),
  root: InterfaceNode,
}) {}

export class InvalidInterfaceDocument extends Schema.TaggedErrorClass<InvalidInterfaceDocument>()(
  "InvalidInterfaceDocument",
  {
    message: Schema.Literal("The interface document is invalid."),
  },
) {}

const invalidDocument = () =>
  InvalidInterfaceDocument.make({
    message: "The interface document is invalid.",
  });

const decodeCurrentDocument = Schema.decodeUnknownEffect(
  InterfaceDocument,
  strictOptions,
);

class LegacyInterfaceDocument extends Schema.Class<LegacyInterfaceDocument>(
  "LegacyInterfaceDocument",
)({
  version: Schema.Literal(1),
  headline: DisplayText(80),
  placeholder: DisplayText(120),
  secondaryActions: Schema.Array(
    Schema.Literals(["open", "extensions", "connect"]),
  ).check(Schema.isMaxLength(3)),
}) {}

const decodeLegacyDocument = Schema.decodeUnknownEffect(
  LegacyInterfaceDocument,
  strictOptions,
);

const buttonForLegacyAction = (
  action: "open" | "extensions" | "connect",
): ButtonNode => ({
  id: `action-${action}`,
  type: "button",
  label:
    action === "open"
      ? "Open"
      : action === "extensions"
        ? "Extensions"
        : "Connect",
  action,
});

const migrateLegacyDocument = Effect.fn(
  "Flect.InterfaceDocument.migrateLegacy",
)(function* (input: unknown) {
  const legacy = yield* decodeLegacyDocument(input);
  return InterfaceDocument.make({
    version: 2,
    name: legacy.headline,
    root: {
      id: "root",
      type: "stack",
      direction: "column",
      gap: "lg",
      children: [
        {
          id: "headline",
          type: "text",
          text: legacy.headline,
          style: "headline",
        },
        {
          id: "prompt",
          type: "prompt",
          placeholder: legacy.placeholder,
        },
        {
          id: "secondary-actions",
          type: "stack",
          direction: "row",
          gap: "sm",
          children: legacy.secondaryActions.map(buttonForLegacyAction),
        },
      ],
    },
  });
});

export const defaultInterfaceDocument: InterfaceDocument = Object.freeze(
  InterfaceDocument.make({
    version: 2,
    name: "Flect",
    root: {
      id: "root",
      type: "stack",
      direction: "column",
      gap: "lg",
      children: [
        {
          id: "headline",
          type: "text",
          text: "What should we shape?",
          style: "headline",
        },
        {
          id: "prompt",
          type: "prompt",
          placeholder: "Build, change, or connect anything",
        },
        {
          id: "secondary-actions",
          type: "stack",
          direction: "row",
          gap: "sm",
          children: [
            buttonForLegacyAction("open"),
            buttonForLegacyAction("extensions"),
            buttonForLegacyAction("connect"),
            {
              id: "shape-interface",
              type: "button",
              label: "Shape interface",
              action: "shape",
            },
          ],
        },
      ],
    },
  }),
);

const validateTree = Effect.fn("Flect.InterfaceDocument.validateTree")(
  function* (root: InterfaceNode) {
    const identifiers = new Set<string>();
    const pending: Array<readonly [InterfaceNode, number]> = [[root, 1]];
    let count = 0;

    while (pending.length > 0) {
      const entry = pending.pop();
      if (entry === undefined) {
        continue;
      }
      const [node, depth] = entry;
      count += 1;

      if (depth > 10 || count > 100 || identifiers.has(node.id)) {
        return yield* Effect.fail(invalidDocument());
      }
      identifiers.add(node.id);

      if (node.type === "stack") {
        for (const child of node.children) {
          pending.push([child, depth + 1]);
        }
      }
    }
  },
);

export const validateInterfaceDocument = Effect.fn(
  "Flect.InterfaceDocument.validate",
)(function* (input: unknown) {
  const document = yield* decodeCurrentDocument(input).pipe(
    Effect.mapError(invalidDocument),
  );
  yield* validateTree(document.root);
  return document;
});

export const decodeInterfaceDocument = Effect.fn(
  "Flect.InterfaceDocument.decodeStored",
)(function* (raw: string | null | undefined) {
  if (raw === null || raw === undefined) {
    return defaultInterfaceDocument;
  }

  const input = yield* Effect.try({
    try: (): unknown => JSON.parse(raw),
    catch: invalidDocument,
  }).pipe(Effect.orElseSucceed(() => undefined));

  if (input === undefined) {
    return defaultInterfaceDocument;
  }

  return yield* validateInterfaceDocument(input).pipe(
    Effect.catch(() =>
      migrateLegacyDocument(input).pipe(
        Effect.flatMap(validateInterfaceDocument),
      ),
    ),
    Effect.orElseSucceed(() => defaultInterfaceDocument),
  );
});
