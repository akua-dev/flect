import { Schema } from "effect";

const Text = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
);
const Path = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
);

export const PROJECT_IMPORT_REPORT_PATH = "metadata/import-report.json";

export class ProjectImportReport extends Schema.Class<ProjectImportReport>(
  "ProjectImportReport",
)({
  version: Schema.Literal(1),
  kind: Schema.Literals([
    "static-html",
    "vite",
    "vite-react",
    "vite-vue",
    "vite-svelte",
  ]),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  entrypoint: Path,
  source: Schema.optionalKey(
    Schema.Literals(["directory", "archive", "git", "conversation"]),
  ),
  revision: Schema.optionalKey(Text),
  includedFiles: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 256 }),
  ),
  ignoredFiles: Schema.Array(Path).check(Schema.isMaxLength(256)),
  adaptations: Schema.Array(Text).check(Schema.isMaxLength(40)),
  warnings: Schema.Array(Text).check(Schema.isMaxLength(40)),
}) {}
