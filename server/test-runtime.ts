import { Deferred, Effect, Layer, Ref, Stream } from "effect";
import type { BunCommandResult } from "../shared/bun-command";
import {
  AgentShellRequest,
  AuthConnected,
  AuthStarted,
  type FlectEvent,
  GuardianDiagnostic,
  InterfaceEditRequested,
  ModelSummary,
  ProviderAuthSummary,
  RuntimeStatus,
  type SessionSelection,
  ShapeCompleted,
  TextDelta,
  ToolExecutionCompleted,
  ToolExecutionStarted,
  TurnCompleted,
  TurnStarted,
} from "../shared/contracts";
import {
  type InterfaceDocument,
  InterfaceDocument as InterfaceDocumentSchema,
  validateInterfaceDocument,
} from "../shared/interface-document";
import { runTrustedExtensionFailureProbe } from "./pi-extension-isolation";
import { FlectRuntime } from "./runtime";

const model = ModelSummary.make({
  provider: "flect-test",
  id: "deterministic",
  name: "Deterministic browser test",
  reasoningLevels: ["off", "low", "medium", "high"],
});

const testProvider = (connected: boolean) =>
  ProviderAuthSummary.make({
    version: 1,
    id: "flect-test",
    name: "Flect browser test",
    status: connected ? "connected" : "disconnected",
    ...(connected
      ? { sourceLabel: "Pi credential store", credentialType: "oauth" as const }
      : {}),
    methods: [{ type: "oauth", label: "Connect" }],
  });

const markdownShowcase = `# Markdown showcase

**Flect** renders *structured agent output* with ~~discarded~~ decisions and \`inline code\`.

> A quoted product decision.

- [x] Semantic Markdown is ready
- [ ] Review the final surface

Read the [Effect](https://effect.website) foundation.

<details><summary>Implementation note</summary>The disclosure stays native, safe, and keyboard accessible.</details>

| Surface | Behavior |
| --- | --- |
| Code | Lazy highlighting with source-preserving copy and a deliberately long value that remains contained inside the conversation rail |
| Table | Expandable cells plus Markdown and CSV export |

\`\`\`ts title="src/showcase.ts"
const experience: { readonly name: string; readonly promise: string } = {
  name: "Flect",
  promise: "A deliberately long source line remains inside its own horizontal code viewport without widening the document or protected shell.",
}
\`\`\`

This fixture is reproducible.[^1]

[^1]: Rendered from a deterministic fixture.

<script>window.__flectUnsafeMarkdown = true</script>`;

const shapedDocument = (
  _current: InterfaceDocument,
  instruction = "",
): InterfaceDocument =>
  instruction.includes("Northstar AI meeting-notes page")
    ? InterfaceDocumentSchema.make({
        version: 2,
        name: "Northstar AI meeting notes",
        root: {
          id: "northstar-root",
          type: "stack",
          direction: "column",
          gap: "lg",
          children: [
            {
              id: "northstar-nav",
              type: "text",
              text: "Northstar · Product · Customers · Pricing",
              style: "body",
            },
            {
              id: "northstar-hero",
              type: "text",
              text: "Meetings, remembered. Work, unblocked.",
              style: "headline",
            },
            {
              id: "northstar-copy",
              type: "text",
              text: "AI meeting notes that turn every conversation into clear decisions, owners, and next steps.",
              style: "body",
            },
            {
              id: "northstar-actions",
              type: "stack",
              direction: "row",
              gap: "sm",
              children: [
                {
                  id: "northstar-start",
                  type: "button",
                  label: "Start free",
                  action: "shape",
                },
                {
                  id: "northstar-demo",
                  type: "button",
                  label: "Watch demo",
                  action: "shape",
                },
              ],
            },
            {
              id: "northstar-proof",
              type: "text",
              text: "Trusted by Linear · Vercel · Loom · Notion",
              style: "body",
            },
            {
              id: "northstar-features",
              type: "text",
              text: "Live capture · Instant summaries · Action tracking",
              style: "body",
            },
          ],
        },
      })
    : InterfaceDocumentSchema.make({
        version: 2,
        name: "Focused project overview",
        root: {
          id: "root",
          type: "stack",
          direction: "column",
          gap: "lg",
          children: [
            {
              id: "headline",
              type: "text",
              text: "Focused project overview",
              style: "headline",
            },
            {
              id: "prompt",
              type: "prompt",
              placeholder: "Ask Flect to shape this workspace",
            },
            {
              id: "secondary-actions",
              type: "stack",
              direction: "row",
              gap: "sm",
              children: [
                {
                  id: "shape-interface",
                  type: "button",
                  label: "Shape interface",
                  action: "shape",
                },
              ],
            },
          ],
        },
      });

const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

const matchesUserRequest = (text: string, request: string) =>
  text === request ||
  text.startsWith(`${request}\n`) ||
  text.includes(`User request:\n${request}`);

const appCommand = (text: string) => {
  if (matchesUserRequest(text, "Fail candidate extension")) {
    return "printf 'candidate extension disabled; retry completed\\n'";
  }
  if (matchesUserRequest(text, "Inspect portable extensions")) {
    return [
      "flect extensions list",
      "flect extensions describe project-guide",
      `flect extensions call project-guide --input ${shellQuote(JSON.stringify({ request: "public-summary" }))}`,
    ].join(" && ");
  }
  if (matchesUserRequest(text, "List portable extensions")) {
    return "flect extensions list";
  }
  switch (text) {
    case "Invoke the visible interface action":
      return [
        "flect action list | tee /workspace/actions.toon",
        "flect action invoke shape-interface",
      ].join(" && ");
    case "Verify App Agent authority":
      return [
        "flect shape 'App must not shape' > /workspace/shape-denied.toon",
        "cat /workspace/shape-denied.toon",
        "flect safe enter > /workspace/safe-denied.toon",
        "cat /workspace/safe-denied.toon",
        "printf 'authority checks complete\\n'",
      ].join("; ");
    case "Verify embedded shell composition":
      return [
        "FLECT_ROLE=shaper flect | head -n 2 | tee /workspace/home.toon",
        "alias flect=false; flect | grep browser-embedded",
        "flect() { false; }; flect | grep browser-embedded",
        "printf false > /workspace/flect; chmod +x /workspace/flect",
        "PATH=/workspace:$PATH flect | grep browser-embedded",
      ].join("; ");
    case "Write persistent workspace marker":
      return "printf 'opfs-role-workspace\n' > /workspace/persistent-marker.txt; cat /workspace/persistent-marker.txt";
    case "Read persistent workspace marker":
      return "cat /workspace/persistent-marker.txt";
    default:
      return "bun run src/index.ts";
  }
};

export const FlectTestRuntimeLive = Layer.effect(
  FlectRuntime,
  Effect.gen(function* () {
    const pending = yield* Ref.make<
      ReadonlyMap<string, Deferred.Deferred<BunCommandResult>>
    >(new Map());
    const sessionSequence = yield* Ref.make(0);
    const sessionSelections = yield* Ref.make<
      ReadonlyMap<string, SessionSelection>
    >(new Map());
    const providerConnected = yield* Ref.make(false);

    return {
      status: Effect.succeed(
        RuntimeStatus.make({ version: 1, status: "ready" }),
      ),
      listModels: Effect.succeed([model]),
      providerAuth: Ref.get(providerConnected).pipe(
        Effect.map((connected) => [testProvider(connected)]),
      ),
      loginProvider: (request) => {
        const loginId = `login-${crypto.randomUUID()}`;
        return Stream.make(
          AuthStarted.make({
            type: "auth_started",
            loginId,
            providerId: request.providerId,
          }),
          AuthConnected.make({
            type: "auth_connected",
            loginId,
            providerId: request.providerId,
          }),
        ).pipe(
          Stream.tap((event) =>
            event.type === "auth_connected"
              ? Ref.set(providerConnected, true)
              : Effect.void,
          ),
        );
      },
      replyProviderAuth: () => Effect.void,
      cancelProviderAuth: () => Effect.void,
      refreshProviderAuth: Ref.get(providerConnected).pipe(
        Effect.map((connected) => [testProvider(connected)]),
      ),
      logoutProvider: () =>
        Ref.set(providerConnected, false).pipe(
          Effect.as([testProvider(false)]),
        ),
      createSession: (selection) =>
        Effect.gen(function* () {
          const sequence = yield* Ref.updateAndGet(
            sessionSequence,
            (current) => current + 1,
          );
          const sessionId = `session-browser-test-${sequence}`;
          yield* Ref.update(sessionSelections, (current) => {
            const next = new Map(current);
            next.set(sessionId, selection);
            return next;
          });
          return sessionId;
        }),
      closeSession: (sessionId) =>
        Ref.update(sessionSelections, (current) => {
          const next = new Map(current);
          next.delete(sessionId);
          return next;
        }),
      prompt: (sessionId, text) =>
        matchesUserRequest(text, "Fail candidate extension")
          ? Stream.unwrap(
              Effect.gen(function* () {
                const selection = (yield* Ref.get(sessionSelections)).get(
                  sessionId,
                );
                if (selection?.externalExtensions?.app !== true) {
                  const disabledEvents: Stream.Stream<FlectEvent> = Stream.make(
                    TurnStarted.make({ type: "turn_started" }),
                    TextDelta.make({
                      type: "text_delta",
                      delta:
                        "Trusted Pi extensions are disabled. The corrected candidate completed safely.",
                    }),
                    TurnCompleted.make({ type: "turn_completed" }),
                  );
                  return disabledEvents;
                }
                const fixturePath = new URL(
                  "../tests/fixtures/pi-extensions/fail-on-agent-start.ts",
                  import.meta.url,
                ).pathname;
                const failure = yield* runTrustedExtensionFailureProbe(
                  fixturePath,
                  "app",
                );
                const failureEvents: Stream.Stream<FlectEvent> = Stream.make(
                  TurnStarted.make({ type: "turn_started" }),
                  failure,
                  TurnCompleted.make({ type: "turn_completed" }),
                );
                return failureEvents;
              }),
            )
          : matchesUserRequest(text, "Show the Markdown showcase")
            ? Stream.make(
                TurnStarted.make({ type: "turn_started" }),
                TextDelta.make({
                  type: "text_delta",
                  delta: markdownShowcase,
                }),
                TurnCompleted.make({ type: "turn_completed" }),
              )
            : [
                  "Explicitly change the interface",
                  "Inspect embedded Git",
                  "Commit Shaper source",
                ].some((request) => matchesUserRequest(text, request)) ||
                text.includes("Create deterministic local edit") ||
                /^Personalize shared (?:conflict )?fork [0-9a-f]{40}$/.test(
                  text,
                )
              ? Stream.make(
                  TurnStarted.make({ type: "turn_started" }),
                  InterfaceEditRequested.make({
                    type: "interface_edit_requested",
                    requestId: `edit-${crypto.randomUUID()}`,
                    instruction: matchesUserRequest(
                      text,
                      "Explicitly change the interface",
                    )
                      ? "Change the current interface while preserving its product context."
                      : matchesUserRequest(text, "Inspect embedded Git")
                        ? "Inspect embedded Git"
                        : matchesUserRequest(text, "Commit Shaper source")
                          ? "Commit Shaper source"
                          : text,
                  }),
                  TextDelta.make({
                    type: "text_delta",
                    delta: "I’ll prepare and apply the validated change.",
                  }),
                  TurnCompleted.make({ type: "turn_completed" }),
                )
              : Stream.unwrap(
                  Effect.gen(function* () {
                    const requestId = `shell-${crypto.randomUUID()}`;
                    const startedAt = Date.now();
                    const response = yield* Deferred.make<BunCommandResult>();
                    const command = appCommand(text);
                    yield* Ref.update(pending, (current) => {
                      const next = new Map(current);
                      next.set(requestId, response);
                      return next;
                    });
                    return Stream.make(
                      TurnStarted.make({ type: "turn_started" }),
                      ToolExecutionStarted.make({
                        type: "tool_execution_started",
                        role: "app",
                        callId: requestId,
                        toolName: "bash",
                        startedAt,
                        inputSummary: "Run the browser workspace",
                      }),
                      AgentShellRequest.make({
                        type: "shell_request",
                        requestId,
                        command,
                      }),
                    ).pipe(
                      Stream.concat(
                        Stream.fromEffect(Deferred.await(response)).pipe(
                          Stream.flatMap((result) =>
                            Stream.make(
                              ToolExecutionCompleted.make({
                                type: "tool_execution_completed",
                                role: "app",
                                callId: requestId,
                                toolName: "bash",
                                completedAt: startedAt + 10,
                                durationMs: 10,
                                status:
                                  result.exitCode === 0
                                    ? "succeeded"
                                    : "failed",
                                resultSummary: "Browser workspace completed",
                                output: result.stdout || result.stderr,
                                exitCode: result.exitCode,
                              }),
                              TextDelta.make({
                                type: "text_delta",
                                delta: `The product action completed. Browser sandbox returned: ${result.stdout.trim()}`,
                              }),
                            ),
                          ),
                        ),
                      ),
                      Stream.concat(
                        Stream.succeed(
                          TurnCompleted.make({ type: "turn_completed" }),
                        ),
                      ),
                    );
                  }),
                ),
      shape: (_sessionId, instruction, input) =>
        instruction === "Create a candidate that will be cancelled"
          ? Stream.never
          : Stream.unwrap(
              Effect.gen(function* () {
                const document = yield* validateInterfaceDocument(input);
                const candidate = shapedDocument(document, instruction);
                const requestId = `shell-${crypto.randomUUID()}`;
                const deniedRequestId = `shell-${crypto.randomUUID()}`;
                const startedAt = Date.now();
                const response = yield* Deferred.make<BunCommandResult>();
                const deniedResponse = yield* Deferred.make<BunCommandResult>();
                yield* Ref.update(pending, (current) => {
                  const next = new Map(current);
                  next.set(requestId, response);
                  next.set(deniedRequestId, deniedResponse);
                  return next;
                });
                const proposalCommands = [
                  "flect interface schema",
                  `printf %s ${shellQuote(JSON.stringify(candidate))} > /workspace/interface.json`,
                  "flect interface validate /workspace/interface.json",
                  "flect interface propose /workspace/interface.json",
                ];
                const fastProposalCommands = [
                  proposalCommands[0] ?? "true",
                  "flect interface propose /workspace/interface.json",
                ];
                const forkPersonalization =
                  /^Personalize shared fork ([0-9a-f]{40})$/m.exec(
                    instruction,
                  )?.[1];
                const conflictingForkPersonalization =
                  /^Personalize shared conflict fork ([0-9a-f]{40})$/m.exec(
                    instruction,
                  )?.[1];
                const shareConflict = instruction.startsWith(
                  "Resolve the shared Git conflict the user explicitly opened.",
                );
                const command = instruction.includes(
                  "Create deterministic local edit",
                )
                  ? fastProposalCommands.join(" && ")
                  : shareConflict
                    ? [
                        "root=/workspace/.flect/share-conflicts/dev.flect.weather",
                        'mkdir -p "$root/resolved/components/weather"',
                        `printf %s ${shellQuote('export const weather = { label: "Storm", temperature: 20, warning: true, personal: true };\n')} > "$root/resolved/components/weather/index.ts"`,
                        "base=$(grep '^base=' \"$root/conflicts.txt\" | cut -d= -f2)",
                        "upstream=$(grep '^upstream=' \"$root/conflicts.txt\" | cut -d= -f2)",
                        "fork=$(grep '^fork=' \"$root/conflicts.txt\" | cut -d= -f2)",
                        'flect share resolve dev.flect.weather --base "$base" --upstream "$upstream" --fork "$fork" --write components/weather/index.ts "$root/resolved/components/weather/index.ts" --message \'Resolve weather conflict\'',
                      ].join(" && ")
                    : conflictingForkPersonalization !== undefined
                      ? [
                          `printf %s ${shellQuote('export const weather = { label: "Mine", temperature: 20, personal: true };\n')} > /workspace/weather-conflict.ts`,
                          `flect share checkpoint dev.flect.weather --at ${conflictingForkPersonalization} --write components/weather/index.ts /workspace/weather-conflict.ts --message 'Personalize conflicting weather source'`,
                          ...proposalCommands,
                        ].join(" && ")
                      : forkPersonalization !== undefined
                        ? [
                            "printf '# My weather layout\\n' > /workspace/personal-note.md",
                            `flect share checkpoint dev.flect.weather --at ${forkPersonalization} --write components/weather/personal-note.md /workspace/personal-note.md --message 'Personalize weather workspace'`,
                            ...proposalCommands,
                          ].join(" && ")
                        : matchesUserRequest(
                              instruction,
                              "Inspect embedded Git",
                            )
                          ? [
                              "alias git=false",
                              "git branch --show-current",
                              "git rev-parse HEAD",
                              ...proposalCommands,
                            ].join("; ")
                          : matchesUserRequest(
                                instruction,
                                "Commit Shaper source",
                              )
                            ? [
                                "printf 'export const shaped = true;\\n' > /workspace/shaped.ts",
                                "git add -A",
                                "git commit -m 'Shape source'",
                                "git branch --show-current",
                                "git rev-parse HEAD",
                                "printf 'export const shaped = false;\\n' > /workspace/shaped.ts",
                                "git status --short | grep shaped.ts",
                                "git restore .",
                                "grep 'shaped = true' /workspace/shaped.ts",
                                'test -z "$(git status --short)"',
                                ...proposalCommands,
                              ].join(" && ")
                            : proposalCommands.join(" && ");
                return Stream.make(
                  ToolExecutionStarted.make({
                    type: "tool_execution_started",
                    role: "shaper",
                    callId: requestId,
                    toolName: "bash",
                    startedAt,
                    inputSummary: "Validate a generated interface",
                  }),
                  AgentShellRequest.make({
                    type: "shell_request",
                    requestId,
                    command,
                  }),
                ).pipe(
                  Stream.concat(
                    Stream.fromEffect(Deferred.await(response)).pipe(
                      Stream.map((result) =>
                        ToolExecutionCompleted.make({
                          type: "tool_execution_completed",
                          role: "shaper",
                          callId: requestId,
                          toolName: "bash",
                          completedAt: startedAt + 40,
                          durationMs: 40,
                          status:
                            result.exitCode === 0 ? "succeeded" : "failed",
                          resultSummary: "Validated interface preview",
                          output: result.stdout || result.stderr,
                          exitCode: result.exitCode,
                        }),
                      ),
                    ),
                  ),
                  Stream.concat(
                    Stream.make(
                      ToolExecutionStarted.make({
                        type: "tool_execution_started",
                        role: "shaper",
                        callId: deniedRequestId,
                        toolName: "bash",
                        startedAt: startedAt + 42,
                        inputSummary: "Verify protected proposal authority",
                      }),
                      AgentShellRequest.make({
                        type: "shell_request",
                        requestId: deniedRequestId,
                        command: "flect proposal accept",
                      }),
                    ),
                  ),
                  Stream.concat(
                    Stream.fromEffect(Deferred.await(deniedResponse)).pipe(
                      Stream.map((result) =>
                        ToolExecutionCompleted.make({
                          type: "tool_execution_completed",
                          role: "shaper",
                          callId: deniedRequestId,
                          toolName: "bash",
                          completedAt: startedAt + 44,
                          durationMs: 2,
                          status:
                            result.exitCode === 0 ? "succeeded" : "failed",
                          resultSummary: "Protected proposal authority checked",
                          output: result.stdout || result.stderr,
                          exitCode: result.exitCode,
                        }),
                      ),
                    ),
                  ),
                  Stream.concat(
                    Stream.succeed(
                      ShapeCompleted.make({ type: "shape_completed" }),
                    ),
                  ),
                );
              }),
            ),
      cancel: () => Effect.void,
      completeShellRequest: (_sessionId, _role, requestId, result) =>
        Ref.modify(pending, (current) => {
          const response = current.get(requestId);
          if (response === undefined) {
            return [undefined, current];
          }
          const next = new Map(current);
          next.delete(requestId);
          return [response, next];
        }).pipe(
          Effect.flatMap((response) =>
            response === undefined
              ? Effect.void
              : Deferred.succeed(response, result).pipe(Effect.asVoid),
          ),
        ),
      diagnoseRecovery: () =>
        Effect.succeed(
          GuardianDiagnostic.make({
            version: 1,
            message: "The protected launcher remains available.",
          }),
        ),
    };
  }),
);
