import { Effect, Schema, type SchemaAST } from "effect";
import { InterfaceDocument } from "./interface-document";

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const IdentifierText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
);

export const RevisionId = IdentifierText.pipe(Schema.brand("RevisionId"));
export type RevisionId = typeof RevisionId.Type;

export class InterfaceRevision extends Schema.Class<InterfaceRevision>(
  "InterfaceRevision",
)({
  version: Schema.Literal(1),
  id: RevisionId,
  parentId: Schema.optionalKey(RevisionId),
  status: Schema.Literals(["proposed", "previewed", "accepted", "rejected"]),
  source: Schema.Literals(["built-in", "user", "shaper", "recovery"]),
  document: InterfaceDocument,
  createdAt: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
}) {}

export class ShapingEvent extends Schema.Class<ShapingEvent>("ShapingEvent")({
  version: Schema.Literal(1),
  sequence: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
  type: Schema.Literals([
    "initialized",
    "revision-proposed",
    "revision-previewed",
    "revision-accepted",
    "revision-rejected",
    "revision-rolled-back",
    "extension-failed",
    "recovery-requested",
    "safe-mode-entered",
  ]),
  revisionId: Schema.optionalKey(RevisionId),
  extensionId: Schema.optionalKey(IdentifierText),
}) {}

export class ShapingSnapshot extends Schema.Class<ShapingSnapshot>(
  "ShapingSnapshot",
)({
  version: Schema.Literal(1),
  active: InterfaceRevision,
  lastKnownGood: InterfaceRevision,
  proposal: Schema.optionalKey(InterfaceRevision),
  safeMode: Schema.Boolean,
  disabledExtensions: Schema.Array(IdentifierText),
  lastEvent: ShapingEvent,
}) {}

export class InvalidRevision extends Schema.TaggedErrorClass<InvalidRevision>()(
  "InvalidRevision",
  {
    message: Schema.Literal("The interface revision is invalid."),
  },
) {}

export class RevisionNotFound extends Schema.TaggedErrorClass<RevisionNotFound>()(
  "RevisionNotFound",
  {
    id: RevisionId,
    message: Schema.Literal("The interface revision was not found."),
  },
) {}

export class InvalidRevisionTransition extends Schema.TaggedErrorClass<InvalidRevisionTransition>()(
  "InvalidRevisionTransition",
  {
    id: RevisionId,
    message: Schema.Literal(
      "The interface revision cannot make that transition.",
    ),
  },
) {}

const invalidRevision = () =>
  InvalidRevision.make({
    message: "The interface revision is invalid.",
  });

export const validateInterfaceRevision = Effect.fn(
  "Flect.InterfaceRevision.validate",
)((input: unknown) =>
  Schema.decodeUnknownEffect(
    InterfaceRevision,
    strictOptions,
  )(input).pipe(Effect.mapError(invalidRevision)),
);
