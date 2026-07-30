import { Schema } from "effect";

export const BUN_COMMANDS = [
  "run",
  "build",
  "install",
  "add",
  "remove",
  "stop",
] as const;

const Argument = Schema.String.check(Schema.isMaxLength(4_096));
const WorkspacePath = Schema.String.check(
  Schema.isPattern(/^\/workspace(?:\/(?!\.{1,2}(?:\/|$))[^/]+)*$/),
);
const Output = Schema.String.check(Schema.isMaxLength(1_048_576));

export class BunCommandRequest extends Schema.Class<BunCommandRequest>(
  "BunCommandRequest",
)({
  version: Schema.Literal(1),
  argv: Schema.Array(Argument).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
  ),
  cwd: WorkspacePath,
}) {}

export class BunCommandResult extends Schema.Class<BunCommandResult>(
  "BunCommandResult",
)({
  version: Schema.Literal(1),
  exitCode: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  stdout: Output,
  stderr: Output,
  previewUrl: Schema.optional(Schema.String.check(Schema.isMaxLength(2_048))),
}) {}

export class BunCompatibility extends Schema.Class<BunCompatibility>(
  "BunCompatibility",
)({
  version: Schema.Literal(1),
  implementation: Schema.Literal("flect-browser"),
  transpiler: Schema.Literals(["compatible", "bun-wasm"]),
  commands: Schema.Array(Schema.Literals(BUN_COMMANDS)).check(
    Schema.isMaxLength(BUN_COMMANDS.length),
  ),
}) {}

export class BunCommandFailed extends Schema.TaggedErrorClass<BunCommandFailed>()(
  "BunCommandFailed",
  {
    reason: Schema.Literals([
      "invalid-input",
      "unsupported",
      "workspace",
      "package",
      "execution",
      "preview",
      "deadline",
      "cancelled",
    ]),
    message: Schema.String.check(Schema.isMaxLength(500)),
  },
) {}

export class WorkspaceFileWrite extends Schema.Class<WorkspaceFileWrite>(
  "WorkspaceFileWrite",
)({
  operation: Schema.Literal("write"),
  path: WorkspacePath,
  content: Schema.Uint8Array,
}) {}

export class WorkspaceFileRemove extends Schema.Class<WorkspaceFileRemove>(
  "WorkspaceFileRemove",
)({
  operation: Schema.Literal("remove"),
  path: WorkspacePath,
}) {}

export const WorkspaceFileChange = Schema.Union([
  WorkspaceFileWrite,
  WorkspaceFileRemove,
]);
export type WorkspaceFileChange = typeof WorkspaceFileChange.Type;

export class WorkspaceDelta extends Schema.Class<WorkspaceDelta>(
  "WorkspaceDelta",
)({
  version: Schema.Literal(1),
  files: Schema.Array(WorkspaceFileChange).check(Schema.isMaxLength(4_096)),
  byteLength: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 67_108_864 }),
  ),
}) {}
