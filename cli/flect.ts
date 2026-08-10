import { homedir } from "node:os";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, Schema } from "effect";
import { makeBrokerFlectCommandGatewayLayer } from "../src/axi/broker-gateway";
import { runFlect } from "../src/axi/program";
import { makeAgentIntegrationLayer } from "../src/lib/agent-integration";
import { makeShellLinkLayer } from "../src/lib/shell-link";
import {
  flectApplicationPathFromExecutable,
  makeUninstallLayer,
} from "../src/lib/uninstall";
import { makeFlectControlClientLayer } from "./flect-client";

export interface FlectCliIo {
  readonly readStdin: () => Promise<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly launch: () => Promise<void>;
}

export class FlectCliError extends Schema.TaggedErrorClass<FlectCliError>()(
  "FlectCliError",
  {
    operation: Schema.Literals(["stdin", "launch"]),
    message: Schema.String,
  },
) {}

const defaultIo: FlectCliIo = {
  readStdin: () => Bun.stdin.text(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  launch: async () => {
    const child = Bun.spawn(["open", "-a", "Flect"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await child.exited) !== 0) {
      throw new Error("launch failed");
    }
  },
};

const materializeStdin = Effect.fn("Flect.Cli.materializeStdin")(function* (
  argv: ReadonlyArray<string>,
  io: FlectCliIo,
) {
  const index = argv.indexOf("--stdin");
  if (index < 0) {
    return argv;
  }
  const text = yield* Effect.tryPromise({
    try: io.readStdin,
    catch: () =>
      FlectCliError.make({
        operation: "stdin",
        message: "Standard input is unavailable.",
      }),
  }).pipe(Effect.orElseSucceed(() => ""));
  return [...argv.slice(0, index), text.trim(), ...argv.slice(index + 1)];
});

const commandNoun = (argv: ReadonlyArray<string>) =>
  argv.find((value) => value !== "--json" && value !== "--full");

export const runFlectCli = Effect.fn("Flect.Cli.run")(function* (
  argv: ReadonlyArray<string>,
  io: FlectCliIo = defaultIo,
) {
  const materialized = yield* materializeStdin(argv, io);
  if (commandNoun(materialized) === "app") {
    yield* Effect.tryPromise({
      try: io.launch,
      catch: () =>
        FlectCliError.make({
          operation: "launch",
          message: "The Flect app could not be opened.",
        }),
    }).pipe(Effect.ignore);
  }
  const result = yield* runFlect(materialized);
  if (result.stdout.length > 0) {
    yield* Effect.sync(() => io.stdout(result.stdout));
  }
  if (result.stderr.length > 0) {
    yield* Effect.sync(() => io.stderr(result.stderr));
  }
  return result.exitCode;
});

interface PrivateOptions {
  readonly argv: ReadonlyArray<string>;
  readonly stateDirectory?: string;
  readonly clientName?: string;
}

export interface NativeFlectGatewayOptions {
  readonly stateDirectory?: string;
  readonly clientName?: string;
  readonly bin?: string;
  readonly configRoot?: string;
  readonly publicExecutable?: string;
}

export const makeNativeFlectGatewayLayer = (
  options: NativeFlectGatewayOptions = {},
) => {
  const client = makeFlectControlClientLayer({
    stateDirectory: options.stateDirectory,
    clientName: options.clientName ?? "flect",
  });
  const gateway = makeBrokerFlectCommandGatewayLayer({
    audience: "native",
    bin: options.bin ?? "flect",
  }).pipe(Layer.provide(client));
  const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
  const integrations = makeAgentIntegrationLayer(
    options.configRoot ?? homedir(),
  ).pipe(Layer.provide(platform));
  const publicExecutable =
    options.publicExecutable ?? process.env.FLECT_PUBLIC_EXECUTABLE;
  if (publicExecutable === undefined || !publicExecutable.startsWith("/")) {
    return Layer.merge(gateway, integrations);
  }
  const shell = makeShellLinkLayer({
    home: options.configRoot ?? homedir(),
    executable: publicExecutable,
  }).pipe(Layer.provide(platform));
  const applicationPath = flectApplicationPathFromExecutable(publicExecutable);
  if (applicationPath === undefined) {
    return Layer.mergeAll(gateway, integrations, shell);
  }
  const setup = Layer.merge(integrations, shell);
  const uninstall = makeUninstallLayer({ applicationPath }).pipe(
    Layer.provide(setup),
  );
  return Layer.mergeAll(gateway, setup, uninstall);
};

const privateOptions = (argv: ReadonlyArray<string>): PrivateOptions => {
  const publicArguments: Array<string> = [];
  let stateDirectory: string | undefined;
  let clientName: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--state-dir" || value === "--client-name") {
      const option = argv[index + 1];
      if (option !== undefined) {
        if (value === "--state-dir") {
          stateDirectory = option;
        } else {
          clientName = option;
        }
        index += 1;
      } else {
        publicArguments.push(value);
      }
    } else if (value !== undefined) {
      publicArguments.push(value);
    }
  }
  return {
    argv: publicArguments,
    ...(stateDirectory === undefined ? {} : { stateDirectory }),
    ...(clientName === undefined ? {} : { clientName }),
  };
};

export const runFlectCliMain = (
  argv: ReadonlyArray<string>,
  io: FlectCliIo = defaultIo,
  options: Omit<NativeFlectGatewayOptions, "stateDirectory"> = {},
) => {
  const parsed = privateOptions(argv);
  return runFlectCli(parsed.argv, io).pipe(
    Effect.provide(
      makeNativeFlectGatewayLayer({
        ...options,
        stateDirectory: parsed.stateDirectory,
        clientName: parsed.clientName ?? options.clientName,
      }),
    ),
  );
};

if (import.meta.main) {
  Effect.runPromise(
    runFlectCliMain(process.argv.slice(2), defaultIo, {
      bin: process.argv[1] ?? "flect",
    }),
  ).then((code) => {
    process.exitCode = code;
  });
}
