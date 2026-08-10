import { Schema } from "effect";

const BoundedText = (minimum: number, maximum: number) =>
  Schema.Trim.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum));

const Coordinate = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(-100_000),
  Schema.isLessThanOrEqualTo(100_000),
);

const Dimension = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(100_000),
);

export class CanvasSelectionRect extends Schema.Class<CanvasSelectionRect>(
  "CanvasSelectionRect",
)({
  x: Coordinate,
  y: Coordinate,
  width: Dimension,
  height: Dimension,
}) {}

export class CanvasSelectionStyles extends Schema.Class<CanvasSelectionStyles>(
  "CanvasSelectionStyles",
)({
  display: BoundedText(1, 80),
  position: BoundedText(1, 80),
  color: BoundedText(1, 120),
  backgroundColor: BoundedText(1, 120),
  fontSize: BoundedText(1, 80),
  fontWeight: BoundedText(1, 80),
  gap: BoundedText(1, 80),
  padding: BoundedText(1, 160),
  margin: BoundedText(1, 160),
}) {}

export class CanvasSelection extends Schema.Class<CanvasSelection>(
  "CanvasSelection",
)({
  version: Schema.Literal(1),
  semanticId: BoundedText(1, 240),
  tag: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(40),
    Schema.isPattern(/^[a-z][a-z0-9-]*$/),
  ),
  label: BoundedText(1, 240),
  role: Schema.optionalKey(BoundedText(1, 80)),
  text: Schema.optionalKey(BoundedText(1, 500)),
  sourcePath: Schema.optionalKey(
    Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(240),
      Schema.isPattern(
        /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/,
      ),
    ),
  ),
  sourceLine: Schema.optionalKey(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(1_000_000),
    ),
  ),
  rect: CanvasSelectionRect,
  styles: CanvasSelectionStyles,
}) {}

export const canvasSelectionSummary = (selection: CanvasSelection) =>
  [
    `Selected element: ${selection.label}`,
    `Semantic identity: ${selection.semanticId}`,
    `Element: <${selection.tag}>${selection.role === undefined ? "" : `, role ${selection.role}`}`,
    ...(selection.text === undefined
      ? []
      : [`Visible text: ${selection.text}`]),
    ...(selection.sourcePath === undefined
      ? []
      : [
          `Source: ${selection.sourcePath}${selection.sourceLine === undefined ? "" : `:${selection.sourceLine}`}`,
        ]),
    `Layout: ${Math.round(selection.rect.width)} × ${Math.round(selection.rect.height)} at ${Math.round(selection.rect.x)}, ${Math.round(selection.rect.y)}`,
    `Computed: display ${selection.styles.display}; position ${selection.styles.position}; font ${selection.styles.fontSize}/${selection.styles.fontWeight}; gap ${selection.styles.gap}; padding ${selection.styles.padding}; margin ${selection.styles.margin}; color ${selection.styles.color}; background ${selection.styles.backgroundColor}`,
  ].join("\n");
