import { Effect, Schema } from "effect";

export type SidecarMode = "rpc" | "axi" | "mcp";

export interface SidecarModeSelection {
  readonly mode: SidecarMode;
  readonly argv: ReadonlyArray<string>;
}

export class SidecarModeError extends Schema.TaggedErrorClass<SidecarModeError>()(
  "SidecarModeError",
  {
    message: Schema.Literal("Invalid private Flect runtime mode."),
  },
) {}

const markerPrefix = "--flect-private-mode=";
const invalid = () =>
  SidecarModeError.make({ message: "Invalid private Flect runtime mode." });

export const selectSidecarMode = Effect.fn("Flect.Sidecar.selectMode")(
  function* (
    argv: ReadonlyArray<string>,
  ): Effect.fn.Return<SidecarModeSelection, SidecarModeError> {
    if (argv.length === 0) {
      return { mode: "rpc", argv: [] };
    }
    const markers = argv.filter((value) => value.startsWith(markerPrefix));
    const first = argv[0];
    if (
      markers.length !== 1 ||
      first === undefined ||
      !first.startsWith(markerPrefix)
    ) {
      return yield* Effect.fail(invalid());
    }
    const mode = first.slice(markerPrefix.length);
    if (mode !== "axi" && mode !== "mcp") {
      return yield* Effect.fail(invalid());
    }
    return { mode, argv: argv.slice(1) };
  },
);
