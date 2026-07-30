import { defineTool } from "@earendil-works/pi-coding-agent";
import { Deferred, Effect, Ref } from "effect";
import { Type } from "typebox";
import { BunCommandResult } from "../shared/bun-command";
import { AgentShellRequest, PiOperationFailed } from "../shared/contracts";

const shellFailure = () =>
  PiOperationFailed.make({
    operation: "shell",
    message: "The model runtime could not complete the request.",
  });

const shellFailureResult = (message: string, exitCode = 1) =>
  BunCommandResult.make({
    version: 1,
    exitCode,
    stdout: "",
    stderr: `${message}\n`,
  });

const formatShellResult = (result: BunCommandResult) =>
  [
    result.stdout.trimEnd(),
    result.stderr.trimEnd(),
    result.previewUrl === undefined ? "" : `Preview: ${result.previewUrl}`,
    `Exit code: ${result.exitCode}`,
  ]
    .filter((part) => part.length > 0)
    .join("\n");

export const makePiShellBridge = Effect.fn("Flect.PiShellBridge.make")(
  function* (emit: (event: AgentShellRequest) => void) {
    const pending = yield* Ref.make<
      ReadonlyMap<string, Deferred.Deferred<BunCommandResult>>
    >(new Map());

    const request = Effect.fn("Flect.PiShellBridge.request")(function* (
      command: string,
    ) {
      const requestId = `shell-${crypto.randomUUID()}`;
      const response = yield* Deferred.make<BunCommandResult>();
      yield* Ref.update(pending, (current) => {
        const next = new Map(current);
        next.set(requestId, response);
        return next;
      });
      emit(
        AgentShellRequest.make({
          type: "shell_request",
          requestId,
          command,
        }),
      );
      return yield* Deferred.await(response).pipe(
        Effect.timeoutOrElse({
          duration: "32 seconds",
          orElse: () =>
            Effect.succeed(
              shellFailureResult(
                "bash: browser sandbox response timed out",
                124,
              ),
            ),
        }),
        Effect.ensuring(
          Ref.update(pending, (current) => {
            const next = new Map(current);
            next.delete(requestId);
            return next;
          }),
        ),
      );
    });

    const complete = Effect.fn("Flect.PiShellBridge.complete")(function* (
      requestId: string,
      result: BunCommandResult,
    ) {
      const current = yield* Ref.get(pending);
      const response = current.get(requestId);
      if (response === undefined) {
        return yield* Effect.fail(shellFailure());
      }
      const accepted = yield* Deferred.succeed(response, result);
      if (!accepted) {
        return yield* Effect.fail(shellFailure());
      }
    });

    const close = Ref.getAndSet(pending, new Map()).pipe(
      Effect.flatMap((current) =>
        Effect.forEach(
          current.values(),
          (response) =>
            Deferred.succeed(
              response,
              shellFailureResult("bash: session closed", 130),
            ),
          { discard: true },
        ),
      ),
    );

    const tool = defineTool({
      name: "bash",
      label: "Bash",
      description:
        "Run Bash-compatible commands inside Flect's disposable browser workspace. Use the reserved bun command for JavaScript, TypeScript, packages, builds, and previews.",
      parameters: Type.Object(
        {
          command: Type.String({
            minLength: 1,
            maxLength: 262_144,
            description: "The shell command to run.",
          }),
        },
        { additionalProperties: false },
      ),
      executionMode: "sequential",
      execute: async (_toolCallId, params, signal) => {
        const result = await Effect.runPromise(
          request(params.command),
          signal === undefined ? undefined : { signal },
        );
        return {
          content: [{ type: "text", text: formatShellResult(result) }],
          details: {
            exitCode: result.exitCode,
            ...(result.previewUrl === undefined
              ? {}
              : { previewUrl: result.previewUrl }),
          },
        };
      },
    });

    return {
      request,
      complete,
      close,
      tool,
    };
  },
);
