import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect, Schema, type SchemaAST } from "effect";
import { ControlDescriptor } from "../shared/control-channel";

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

export class ControlDescriptorError extends Schema.TaggedErrorClass<ControlDescriptorError>()(
  "ControlDescriptorError",
  {
    message: Schema.Literal("The Flect control descriptor is unavailable."),
  },
) {}

const descriptorError = () =>
  ControlDescriptorError.make({
    message: "The Flect control descriptor is unavailable.",
  });

export const defaultControlStateDirectory = () => {
  const explicit = process.env.FLECT_CONTROL_STATE_DIR;
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg !== undefined && xdg.length > 0) {
    return join(xdg, "flect");
  }
  const userDirectory = process.env.HOME;
  if (userDirectory === undefined || userDirectory.length === 0) {
    return join(process.cwd(), ".flect-state");
  }
  return process.platform === "darwin"
    ? join(userDirectory, "Library", "Application Support", "Flect")
    : join(userDirectory, ".local", "state", "flect");
};

export const controlDescriptorPath = (
  stateDirectory = defaultControlStateDirectory(),
) => join(stateDirectory, "control.json");

export const makeControlToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
};

export const writeControlDescriptor = Effect.fn(
  "Flect.ControlDescriptor.write",
)(function* (
  descriptor: ControlDescriptor,
  stateDirectory = defaultControlStateDirectory(),
) {
  const target = controlDescriptorPath(stateDirectory);
  const temporary = `${target}.tmp-${crypto.randomUUID()}`;
  const encoded = yield* Schema.encodeEffect(
    Schema.fromJsonString(ControlDescriptor),
  )(descriptor).pipe(Effect.mapError(descriptorError));
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await chmod(dirname(target), 0o700);
      await writeFile(temporary, `${encoded}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await chmod(temporary, 0o600);
      await rename(temporary, target);
      await chmod(target, 0o600);
    },
    catch: descriptorError,
  });
});

export const removeControlDescriptor = Effect.fn(
  "Flect.ControlDescriptor.remove",
)((stateDirectory = defaultControlStateDirectory()) =>
  Effect.tryPromise({
    try: () => unlink(controlDescriptorPath(stateDirectory)),
    catch: descriptorError,
  }).pipe(Effect.catch(() => Effect.void)),
);

const processExists = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const readControlDescriptor = Effect.fn("Flect.ControlDescriptor.read")(
  function* (
    stateDirectory = defaultControlStateDirectory(),
    verifyProcess = true,
  ) {
    const source = yield* Effect.tryPromise({
      try: () => readFile(controlDescriptorPath(stateDirectory), "utf8"),
      catch: descriptorError,
    });
    const descriptor = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(ControlDescriptor),
      strictOptions,
    )(source).pipe(Effect.mapError(descriptorError));
    if (verifyProcess && !processExists(descriptor.pid)) {
      yield* removeControlDescriptor(stateDirectory);
      return yield* Effect.fail(descriptorError());
    }
    return descriptor;
  },
);
