import { encode } from "@toon-format/toon";
import { Effect } from "effect";
import {
  type AxiFormat,
  AxiFormatError,
  type AxiPublicError,
  AxiRunResult,
} from "./contracts";

export const AXI_DEFAULT_TEXT_LIMIT = 1_000;
export const AXI_DEFAULT_OUTPUT_LIMIT = 256 * 1_024;

const truncationSuffix = (length: number) =>
  `… (truncated, ${length} chars total — use --full)`;

const truncateText = (value: string) => {
  if (value.length <= AXI_DEFAULT_TEXT_LIMIT) {
    return value;
  }
  return `${value.slice(0, AXI_DEFAULT_TEXT_LIMIT)}${truncationSuffix(value.length)}`;
};

const projectBounded = (value: unknown, full: boolean, depth = 0): unknown => {
  if (full) {
    return value;
  }
  if (typeof value === "string") {
    return truncateText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= 32) {
    return "[nested output omitted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => projectBounded(item, false, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      projectBounded(item, false, depth + 1),
    ]),
  );
};

const formatError = (message: AxiFormatError["message"]) =>
  AxiFormatError.make({ message });

const encodeOutput = Effect.fn("Flect.Axi.encodeOutput")(function* (
  value: unknown,
  format: AxiFormat,
  maxBytes: number,
) {
  const encoded = yield* Effect.try({
    try: () => (format === "toon" ? encode(value) : JSON.stringify(value)),
    catch: () => formatError("Flect output could not be encoded safely."),
  });
  if (encoded === undefined) {
    return yield* Effect.fail(
      formatError("Flect output could not be encoded safely."),
    );
  }
  const stdout = `${encoded}\n`;
  if (new TextEncoder().encode(stdout).byteLength > maxBytes) {
    return yield* Effect.fail(
      formatError("Flect output exceeded its safe size limit."),
    );
  }
  return stdout;
});

export interface RenderAxiSuccessOptions {
  readonly format: AxiFormat;
  readonly value: unknown;
  readonly full?: boolean;
  readonly maxBytes?: number;
}

export const renderAxiSuccess = Effect.fn("Flect.Axi.renderSuccess")(function* (
  options: RenderAxiSuccessOptions,
) {
  const stdout = yield* encodeOutput(
    projectBounded(options.value, options.full === true),
    options.format,
    options.maxBytes ?? AXI_DEFAULT_OUTPUT_LIMIT,
  );
  return AxiRunResult.make({ exitCode: 0, stdout, stderr: "" });
});

export const renderAxiFailure = Effect.fn("Flect.Axi.renderFailure")(function* (
  error: AxiPublicError,
  format: AxiFormat,
  exitCode: 1 | 2,
) {
  const value = {
    error: {
      code: error.code,
      message: error.message,
    },
    ...(error.help.length === 0 ? {} : { help: error.help }),
  };
  const stdout = yield* encodeOutput(value, format, AXI_DEFAULT_OUTPUT_LIMIT);
  return AxiRunResult.make({ exitCode, stdout, stderr: "" });
});
