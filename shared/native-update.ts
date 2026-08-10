import { Schema } from "effect";

const SemanticVersion = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(40),
  Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
);
const CandidateToken = Schema.String.check(
  Schema.isMinLength(16),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
);
const ByteCount = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);

export class NativeUpdateCandidate extends Schema.Class<NativeUpdateCandidate>(
  "NativeUpdateCandidate",
)({
  version: SemanticVersion,
  token: CandidateToken,
  notes: Schema.String.check(Schema.isMaxLength(4_096)),
  target: Schema.Literal("darwin-aarch64"),
  contentLength: Schema.optionalKey(ByteCount),
}) {}

export class NativeUpdateProgress extends Schema.Class<NativeUpdateProgress>(
  "NativeUpdateProgress",
)({
  downloadedBytes: ByteCount,
  totalBytes: Schema.optionalKey(ByteCount),
}) {}

const NativeUpdateUnavailable = Schema.Struct({
  version: Schema.Literal(1),
  state: Schema.Literal("unavailable"),
  installedVersion: SemanticVersion,
  reason: Schema.Literals(["browser", "development", "misconfigured"]),
});

const NativeUpdateCurrent = Schema.Struct({
  version: Schema.Literal(1),
  state: Schema.Literal("current"),
  installedVersion: SemanticVersion,
  checkedAtMillis: Timestamp,
});

const NativeUpdateAvailable = Schema.Struct({
  version: Schema.Literal(1),
  state: Schema.Literal("available"),
  installedVersion: SemanticVersion,
  candidate: NativeUpdateCandidate,
});

const NativeUpdateActive = Schema.Struct({
  version: Schema.Literal(1),
  state: Schema.Literals(["downloading", "installing", "ready-to-relaunch"]),
  installedVersion: SemanticVersion,
  candidate: NativeUpdateCandidate,
  progress: NativeUpdateProgress,
});

export const NativeUpdateSnapshot = Schema.Union([
  NativeUpdateUnavailable,
  NativeUpdateCurrent,
  NativeUpdateAvailable,
  NativeUpdateActive,
]);
export type NativeUpdateSnapshot = typeof NativeUpdateSnapshot.Type;

export class NativeUpdateError extends Schema.TaggedErrorClass<NativeUpdateError>()(
  "NativeUpdateError",
  {
    reason: Schema.Literals([
      "unavailable",
      "offline",
      "invalid-manifest",
      "incompatible",
      "invalid-signature",
      "stale",
      "install-failed",
    ]),
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(300),
    ),
  },
) {}
