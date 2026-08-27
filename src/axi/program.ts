import { Effect, Option, Result, Stream } from "effect";
import {
  type FlectCommandError,
  type FlectCommandReceipt,
  type FlectWorkspaceSnapshot,
  InvokeInterfaceAction,
  InvokePortableExtension,
  InvokeProductOperation,
  RevokeProductCapability,
  RollbackRevision,
  SubmitAppPrompt,
  SubmitShaperInstruction,
} from "../../shared/control";
import {
  findInterfaceAction,
  projectInterfaceActions,
} from "../../shared/interface-actions";
import {
  AgentIntegration,
  type AgentIntegrationError,
} from "../lib/agent-integration";
import { ShellLink, type ShellLinkError } from "../lib/shell-link";
import { Uninstall, type UninstallError } from "../lib/uninstall";
import {
  type AxiReadCommand,
  FLECT_COMMAND_METADATA,
  type ParsedAxiArguments,
  parseAxiArguments,
} from "./command";
import {
  type AxiFormat,
  type AxiFormatError,
  AxiPublicError,
  AxiRunResult,
} from "./contracts";
import {
  FlectCommandGateway,
  type FlectCommandGatewayShape,
  FlectGatewayError,
  FlectInterfaceCommandGateway,
} from "./gateway";
import { renderAxiFailure, renderAxiSuccess } from "./output";

const publicError = (
  code: string,
  message: string,
  help: ReadonlyArray<string> = [],
) => AxiPublicError.make({ code, message, help: [...help].slice(0, 4) });

const requestedFormat = (argv: ReadonlyArray<string>): AxiFormat => {
  for (const value of argv) {
    if (value === "--json") {
      return "json";
    }
    if (value !== "--full") {
      break;
    }
  }
  return "toon";
};

const fallbackFailure = (format: AxiFormat) =>
  AxiRunResult.make({
    exitCode: 1,
    stdout:
      format === "json"
        ? '{"error":{"code":"output-failed","message":"Flect output could not be encoded safely."}}\n'
        : "error:\n  code: output-failed\n  message: Flect output could not be encoded safely.\n",
    stderr: "",
  });

const interfaceAuthoringContract = {
  version: 2,
  strict: true,
  document: {
    required: ["version", "name", "root"],
    version: 2,
    name: "non-empty string, at most 80 characters",
    root: "one interface node",
  },
  commonNode: {
    required: ["id", "type"],
    id: "unique lowercase identifier matching ^[a-z][a-z0-9-]*$, at most 64 characters",
  },
  nodes: {
    stack: {
      required: ["id", "type", "direction", "gap", "children"],
      direction: ["row", "column"],
      gap: ["sm", "md", "lg"],
      children: "0 to 30 interface nodes",
    },
    text: {
      required: ["id", "type", "text", "style"],
      text: "non-empty string, at most 2000 characters",
      style: ["headline", "body", "muted"],
    },
    prompt: {
      required: ["id", "type", "placeholder"],
      placeholder: "non-empty string, at most 120 characters",
    },
    button: {
      required: ["id", "type", "label", "action"],
      label: "non-empty string, at most 80 characters",
      action: [
        "shape",
        "safe-mode",
        "accept-revision",
        "reject-revision",
        "rollback-revision",
      ],
    },
    divider: { required: ["id", "type"] },
    "agent-panel": {
      required: ["id", "type", "title"],
      title: "non-empty string, at most 80 characters",
    },
  },
  limits: { treeDepth: 10, treeNodes: 100 },
  example: {
    version: 2,
    name: "Example",
    root: {
      id: "root",
      type: "stack",
      direction: "column",
      gap: "md",
      children: [
        {
          id: "headline",
          type: "text",
          text: "Example",
          style: "headline",
        },
      ],
    },
  },
  next: "Write strict JSON, then run `flect interface validate <path>` before proposing it.",
};

const failure = (error: AxiPublicError, format: AxiFormat, exitCode: 1 | 2) =>
  renderAxiFailure(error, format, exitCode).pipe(
    Effect.orElseSucceed(() => fallbackFailure(format)),
  );

type AxiExecutionError =
  | AgentIntegrationError
  | AxiFormatError
  | FlectCommandError
  | FlectGatewayError
  | ShellLinkError
  | UninstallError;

const errorProjection = (error: AxiExecutionError) => {
  switch (error._tag) {
    case "FlectGatewayError":
      return publicError(error.reason, error.message, [
        "Open Flect and check Local control in Diagnostics",
      ]);
    case "ControlUnauthorized":
      return publicError("unauthorized", error.message);
    case "CommandConflict":
      return publicError("conflict", error.message, [
        "Inspect the current workspace and retry",
      ]);
    case "WorkspaceUnavailable":
      return publicError("unavailable", error.message);
    case "CommandRejected":
      return publicError("rejected", error.message);
    case "OperationFailed":
      return publicError("operation-failed", error.message);
    case "AxiFormatError":
      return publicError("output-failed", error.message);
    case "InvalidControlCommand":
      return publicError("command-failed", error.message);
    case "AgentIntegrationError":
      return publicError(
        error.reason === "io" ? "unavailable" : error.reason,
        error.message,
      );
    case "ShellLinkError":
      return publicError(
        error.reason === "io" ? "unavailable" : error.reason,
        error.message,
      );
    case "UninstallError":
      return publicError(error.reason, error.message);
  }
};

const modelName = (snapshot: FlectWorkspaceSnapshot) =>
  snapshot.agent.selectedModel === undefined
    ? "auto"
    : `${snapshot.agent.selectedModel.provider}/${snapshot.agent.selectedModel.id}`;

const compactWorkspace = (snapshot: FlectWorkspaceSnapshot) => ({
  id: snapshot.workspaceId,
  mode: snapshot.mode,
  ...(snapshot.workbench === undefined
    ? {}
    : {
        target: snapshot.workbench.target,
        binding: snapshot.workbench.binding,
      }),
  phase: snapshot.phase,
  sequence: snapshot.sequence,
});

const home = (
  bin: string,
  snapshot: FlectWorkspaceSnapshot,
  audience: "native" | "app" | "shaper",
) => ({
  bin,
  ...(audience === "native" ? {} : { runtime: "browser-embedded" }),
  description:
    audience === "native"
      ? "Inspect and operate the live Flect workspace"
      : `Inspect and operate this ${audience === "app" ? "App Agent" : "Shaper"} Flect workspace`,
  workspace: compactWorkspace(snapshot),
  agents: [
    {
      role: "app",
      state: snapshot.agent.app.status,
      model: modelName(snapshot),
    },
    {
      role: "shaper",
      state: snapshot.agent.shaper.status,
      model: modelName(snapshot),
    },
  ],
  ...(snapshot.shaping.proposal === undefined
    ? {}
    : {
        proposal: {
          revision: snapshot.shaping.proposal.id,
          status: snapshot.shaping.proposal.status,
        },
      }),
  help:
    snapshot.shaping.proposal === undefined
      ? [
          "Run `flect inspect` for workspace detail",
          "Run `flect logs --limit 20` for recent activity",
        ]
      : [
          "Run `flect proposal accept` to keep the preview",
          "Run `flect proposal reject` to discard the preview",
          "Run `flect logs --limit 20` to inspect recent activity",
        ],
});

const helpFor = (bin: string, path: ReadonlyArray<string>) => ({
  bin,
  description: "Inspect and operate the live Flect workspace",
  command: path.length === 0 ? "flect" : `flect ${path.join(" ")}`,
  usage:
    path[0] === "model"
      ? [
          "flect model list",
          "flect model select <provider/id|auto>",
          "flect model favorite <add|remove> <provider/id>",
        ]
      : path[0] === "action"
        ? [
            "flect action list",
            "flect action inspect <node-id>",
            "flect action invoke <node-id>",
          ]
        : path[0] === "product"
          ? ["flect product invoke <operation-id> [--input <json>]"]
          : path[0] === "permissions"
            ? [
                "flect permissions list",
                "flect permissions revoke <decision-id>",
              ]
            : path[0] === "extensions"
              ? [
                  "flect extensions list",
                  "flect extensions describe <extension-id>",
                  "flect extensions call <extension-id> [--input <json>]",
                ]
              : path[0] === "share"
                ? [
                    "flect share list",
                    "flect share inspect [share-id]",
                    "flect share open-url <https-url>",
                    "flect share open-git <https-url> <commit>",
                    "flect share reject",
                    "flect share export <share-id>",
                    "flect share checkpoint <share-id> --at <commit> [--write <share-path> <sandbox-path>] [--remove <share-path>] --message <text>",
                    "flect share resolve <share-id> --base <commit> --upstream <commit> --fork <commit> [--write <share-path> <sandbox-path>] [--remove <share-path>] --message <text>",
                  ]
                : [...FLECT_COMMAND_METADATA.map((command) => command.usage)],
});

const unsupported = (message: string) =>
  Effect.fail(FlectGatewayError.make({ reason: "unsupported", message }));

const gatewayFailure = (reason: FlectGatewayError["reason"], message: string) =>
  Effect.fail(FlectGatewayError.make({ reason, message }));

const inspectAfterReceipt = Effect.fn("Flect.Axi.inspectAfterReceipt")(
  function* (gateway: FlectCommandGatewayShape, receipt: FlectCommandReceipt) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const snapshot = yield* gateway.inspect;
      if (snapshot.sequence >= receipt.sequence) {
        return snapshot;
      }
      yield* Effect.yieldNow;
    }
    return yield* gatewayFailure(
      "unavailable",
      "Flect completed the command but its resulting workspace state was not observed.",
    );
  },
);

const execute = Effect.fn("Flect.Axi.execute")(function* (
  parsed: ParsedAxiArguments,
) {
  const gateway = yield* FlectCommandGateway;
  const command: AxiReadCommand = parsed.command;
  switch (command.kind) {
    case "help":
      return helpFor(gateway.bin, command.path);
    case "home": {
      const statusResult = yield* Effect.result(gateway.status);
      if (Result.isFailure(statusResult)) {
        return {
          bin: gateway.bin,
          description: "Inspect and operate the live Flect workspace",
          control: "unavailable",
          workspace: "unavailable",
          help: [
            "Open Flect and enable Local control in Diagnostics",
            "Run `flect app` to open Flect",
          ],
        };
      }
      const status = statusResult.success;
      if (!status.enabled || !status.connected) {
        return {
          bin: gateway.bin,
          description: "Inspect and operate the live Flect workspace",
          control: status.enabled ? "enabled" : "disabled",
          workspace: "unavailable",
          help: [
            "Open Flect and enable Local control in Diagnostics",
            "Run `flect app` to open Flect",
          ],
        };
      }
      return home(gateway.bin, yield* gateway.inspect, gateway.audience);
    }
    case "app":
      return {
        bin: gateway.bin,
        status: "open-requested",
        help: ["Open the Flect application"],
      };
    case "status":
    case "control-status":
      return yield* gateway.status;
    case "inspect": {
      const snapshot = yield* gateway.inspect;
      if (command.fields.length === 0) {
        return snapshot;
      }
      const all: Readonly<Record<string, unknown>> = {
        workspace: snapshot.workspaceId,
        mode: snapshot.mode,
        phase: snapshot.phase,
        sequence: snapshot.sequence,
        agents: snapshot.agent,
        proposal: snapshot.shaping.proposal ?? null,
        workbench: snapshot.workbench ?? null,
        control: snapshot.control,
        repository: snapshot.repository ?? null,
        document: snapshot.document,
        extensions: snapshot.extensions ?? null,
        shares: snapshot.shares ?? null,
        "share-review": snapshot.shareReview ?? null,
      };
      return Object.fromEntries(
        command.fields.map((field) => [field, all[field]]),
      );
    }
    case "logs": {
      const logs = yield* gateway.logs;
      const operations = logs.operations
        .filter(
          (operation) =>
            command.role === undefined || operation.role === command.role,
        )
        .filter(
          (operation) =>
            command.operationId === undefined ||
            operation.operationId === command.operationId,
        )
        .slice(-command.limit);
      return {
        count: operations.length,
        total: logs.operations.length,
        operations,
      };
    }
    case "watch": {
      const event = yield* gateway.events(command.after).pipe(Stream.runHead);
      return Option.match(event, {
        onNone: () => ({ count: 0, events: [] }),
        onSome: (value) => ({ count: 1, events: [value] }),
      });
    }
    case "model-list": {
      const snapshot = yield* gateway.inspect;
      return {
        count: snapshot.agent.models.length,
        models: snapshot.agent.models,
      };
    }
    case "action-list": {
      const snapshot = yield* gateway.inspect;
      const actions = projectInterfaceActions(
        snapshot.document,
        snapshot.shaping,
      );
      return { count: actions.length, actions };
    }
    case "action-inspect": {
      const snapshot = yield* gateway.inspect;
      const action = findInterfaceAction(
        projectInterfaceActions(snapshot.document, snapshot.shaping),
        command.nodeId,
      );
      return action === undefined
        ? yield* gatewayFailure(
            "not-found",
            `Interface action ${command.nodeId} was not found.`,
          )
        : action;
    }
    case "action-invoke": {
      if (gateway.audience === "shaper") {
        return yield* gatewayFailure(
          "unauthorized",
          "Shaper cannot invoke product interface actions.",
        );
      }
      const before = yield* gateway.inspect;
      const action = findInterfaceAction(
        projectInterfaceActions(before.document, before.shaping),
        command.nodeId,
      );
      if (action === undefined) {
        return yield* gatewayFailure(
          "not-found",
          `Interface action ${command.nodeId} was not found.`,
        );
      }
      if (!action.available) {
        return yield* gatewayFailure(
          "rejected",
          action.unavailableReason ?? "The interface action is unavailable.",
        );
      }
      const receipt = yield* gateway.command(
        InvokeInterfaceAction.make({
          type: "invoke-interface-action",
          nodeId: command.nodeId,
        }),
      );
      const after = yield* inspectAfterReceipt(gateway, receipt);
      return {
        action:
          findInterfaceAction(
            projectInterfaceActions(after.document, after.shaping),
            command.nodeId,
          ) ?? action,
        receipt,
        workspace: compactWorkspace(after),
      };
    }
    case "product-invoke": {
      if (gateway.audience === "shaper") {
        return yield* gatewayFailure(
          "unauthorized",
          "Shaper cannot invoke product operations.",
        );
      }
      const receipt = yield* gateway.command(
        InvokeProductOperation.make({
          type: "invoke-product-operation",
          operationId: command.operationId,
          input: command.input,
        }),
      );
      if (receipt.result === undefined) {
        return yield* gatewayFailure(
          "invalid-response",
          "The product operation returned no result.",
        );
      }
      return {
        operationId: command.operationId,
        result: receipt.result,
        receipt,
      };
    }
    case "permissions-list": {
      const permissions = (yield* gateway.inspect).permissions ?? [];
      return { count: permissions.length, permissions };
    }
    case "permissions-revoke": {
      const snapshot = yield* gateway.inspect;
      const permission = (snapshot.permissions ?? []).find(
        (candidate) => candidate.decisionId === command.decisionId,
      );
      if (permission === undefined) {
        return yield* gatewayFailure(
          "not-found",
          `Permission decision ${command.decisionId} was not found.`,
        );
      }
      const receipt = yield* gateway.command(
        RevokeProductCapability.make({
          type: "revoke-product-capability",
          decisionId: command.decisionId,
        }),
      );
      const after = yield* inspectAfterReceipt(gateway, receipt);
      return {
        permission: (after.permissions ?? []).find(
          (candidate) => candidate.decisionId === command.decisionId,
        ),
        receipt,
      };
    }
    case "portable-extension-list": {
      const snapshot = yield* gateway.inspect;
      const entries = snapshot.extensions?.entries ?? [];
      const filtered =
        gateway.audience === "native"
          ? entries
          : entries.filter(
              (entry) =>
                entry.role === gateway.audience &&
                entry.binding ===
                  (gateway.binding ??
                    (gateway.audience === "app" ? "accepted" : "candidate")),
            );
      return {
        count: filtered.length,
        extensions: filtered,
      };
    }
    case "portable-extension-describe": {
      const snapshot = yield* gateway.inspect;
      const entries = (snapshot.extensions?.entries ?? []).filter(
        (entry) =>
          entry.extensionId === command.extensionId &&
          (gateway.audience === "native" ||
            (entry.role === gateway.audience &&
              entry.binding ===
                (gateway.binding ??
                  (gateway.audience === "app" ? "accepted" : "candidate")))),
      );
      if (entries.length === 0) {
        return yield* gatewayFailure(
          "not-found",
          `Portable extension ${command.extensionId} was not found for this role and binding.`,
        );
      }
      return { count: entries.length, extensions: entries };
    }
    case "portable-extension-call": {
      const snapshot = yield* gateway.inspect;
      const role =
        gateway.audience === "native"
          ? snapshot.workbench?.target === "shape"
            ? "shaper"
            : "app"
          : gateway.audience;
      const binding =
        gateway.binding ??
        snapshot.workbench?.binding ??
        (role === "app" ? "accepted" : "candidate");
      const matches = (snapshot.extensions?.entries ?? []).filter(
        (entry) =>
          entry.extensionId === command.extensionId &&
          entry.role === role &&
          entry.binding === binding &&
          entry.state === "enabled",
      );
      if (matches.length !== 1) {
        return yield* gatewayFailure(
          matches.length === 0 ? "not-found" : "rejected",
          matches.length === 0
            ? `Enabled portable extension ${command.extensionId} was not found for this role and binding.`
            : `Portable extension ${command.extensionId} is ambiguous for this role and binding.`,
        );
      }
      const selected = matches[0];
      if (selected === undefined) {
        return yield* gatewayFailure(
          "not-found",
          `Enabled portable extension ${command.extensionId} was not found for this role and binding.`,
        );
      }
      const receipt = yield* gateway.command(
        InvokePortableExtension.make({
          type: "invoke-portable-extension",
          capsuleId: selected.capsuleId,
          extensionId: selected.extensionId,
          role,
          binding,
          input: command.input,
        }),
      );
      if (receipt.result === undefined) {
        return yield* gatewayFailure(
          "invalid-response",
          "The portable extension returned no result.",
        );
      }
      return {
        extensionId: command.extensionId,
        result: receipt.result,
        receipt,
      };
    }
    case "interface-inspect":
      return (yield* gateway.inspect).document;
    case "interface-schema":
      return interfaceAuthoringContract;
    case "revision-list": {
      const shaping = (yield* gateway.inspect).shaping;
      const revisions = [
        shaping.active,
        shaping.lastKnownGood,
        shaping.proposal,
      ].filter((revision) => revision !== undefined);
      return { count: revisions.length, revisions };
    }
    case "repository-status": {
      const repository = (yield* gateway.inspect).repository;
      return repository === undefined
        ? yield* gatewayFailure(
            "unavailable",
            "The canonical Git repository is still opening.",
          )
        : repository;
    }
    case "share-list": {
      const entries = (yield* gateway.inspect).shares?.entries ?? [];
      const shares = entries.map((entry) => ({
        shareId: entry.shareId,
        version: entry.version,
        installedArtifactIds: entry.installedArtifactIds,
        artifacts: entry.artifacts,
        ...(entry.pending === undefined
          ? {}
          : { pending: { lineage: entry.pending.lineage } }),
      }));
      return { count: shares.length, shares };
    }
    case "share-inspect": {
      const snapshot = yield* gateway.inspect;
      if (command.shareId === undefined) {
        return {
          review: snapshot.shareReview ?? null,
          installations: snapshot.shares?.entries ?? [],
        };
      }
      const installation = snapshot.shares?.entries.find(
        (entry) => entry.shareId === command.shareId,
      );
      const review =
        snapshot.shareReview?.shareId === command.shareId
          ? snapshot.shareReview
          : undefined;
      if (installation === undefined && review === undefined) {
        return yield* gatewayFailure(
          "not-found",
          `Shared source ${command.shareId} was not found.`,
        );
      }
      return {
        ...(installation === undefined ? {} : { installation }),
        ...(review === undefined ? {} : { review }),
      };
    }
    case "prompt": {
      if (command.fromStdin) {
        return yield* unsupported(
          "Standard input requires the native CLI adapter.",
        );
      }
      const value =
        command.role === "app"
          ? SubmitAppPrompt.make({
              type: "submit-app-prompt",
              text: command.text,
            })
          : SubmitShaperInstruction.make({
              type: "submit-shaper-instruction",
              instruction: command.text,
            });
      const receipt = yield* gateway.command(value);
      const snapshot = yield* inspectAfterReceipt(gateway, receipt);
      return { receipt, workspace: compactWorkspace(snapshot) };
    }
    case "revision-rollback": {
      if (command.revisionId !== undefined) {
        return yield* unsupported(
          "Targeted revision rollback is not available yet.",
        );
      }
      const receipt = yield* gateway.command(
        RollbackRevision.make({ type: "rollback-revision" }),
      );
      const snapshot = yield* inspectAfterReceipt(gateway, receipt);
      return { receipt, workspace: compactWorkspace(snapshot) };
    }
    case "command": {
      const receipt = yield* gateway.command(command.command);
      if (command.command.type === "disable-control") {
        return { receipt, control: "disabled" };
      }
      const snapshot = yield* inspectAfterReceipt(gateway, receipt);
      return { receipt, workspace: compactWorkspace(snapshot) };
    }
    case "interface-validate":
    case "interface-propose": {
      const maybeInterface = yield* Effect.serviceOption(
        FlectInterfaceCommandGateway,
      );
      if (Option.isNone(maybeInterface)) {
        return yield* unsupported(
          "Interface files require the role-scoped sandbox adapter.",
        );
      }
      if (command.kind === "interface-propose") {
        return yield* maybeInterface.value.propose(command.path);
      }
      const document = yield* maybeInterface.value.validate(command.path);
      return {
        status: "valid",
        name: document.name,
        version: document.version,
      };
    }
    case "app-validate":
    case "app-propose": {
      if (gateway.audience !== "shaper") {
        return yield* gatewayFailure(
          "unauthorized",
          "Only Shaper can author app source.",
        );
      }
      const maybeInterface = yield* Effect.serviceOption(
        FlectInterfaceCommandGateway,
      );
      if (Option.isNone(maybeInterface)) {
        return yield* unsupported(
          "App source requires the role-scoped sandbox adapter.",
        );
      }
      if (command.kind === "app-propose") {
        return yield* maybeInterface.value.proposeApp(
          command.path,
          command.name,
        );
      }
      const summary = yield* maybeInterface.value.validateApp(
        command.path,
        command.name,
      );
      return { status: "valid", ...summary };
    }
    case "context": {
      const status = yield* Effect.result(gateway.status);
      const base = {
        host: command.host,
        discovery:
          "Flect is an adaptive interface shell with a live agent-first command surface.",
        suggestions: [
          "Run `flect` for content-first discovery",
          "Run `flect inspect` for current workspace state",
          "Run `flect action list` before invoking a visible product action",
        ],
      };
      if (
        Result.isFailure(status) ||
        !status.success.enabled ||
        !status.success.connected
      ) {
        return { ...base, workspace: "unavailable" };
      }
      const inspected = yield* Effect.result(gateway.inspect);
      if (Result.isFailure(inspected)) {
        return { ...base, workspace: "unavailable" };
      }
      const snapshot = inspected.success;
      const actions = projectInterfaceActions(
        snapshot.document,
        snapshot.shaping,
      );
      return {
        ...base,
        workspace: compactWorkspace(snapshot),
        roles: {
          app: "Uses the visible product interface and its available actions.",
          shaper:
            "Changes interface revisions in Edit mode; acceptance remains a user decision.",
        },
        actions: actions.slice(0, 8).map((action) => ({
          nodeId: action.nodeId,
          label: action.label,
          available: action.available,
        })),
      };
    }
    case "setup-status": {
      const shell = yield* Effect.serviceOption(ShellLink);
      const agents = yield* Effect.serviceOption(AgentIntegration);
      if (Option.isNone(shell) || Option.isNone(agents)) {
        return yield* unsupported(
          "Setup commands require the native Flect adapter.",
        );
      }
      return {
        shell: yield* shell.value.status,
        agents: yield* agents.value.statusAll,
      };
    }
    case "setup-shell": {
      const shell = yield* Effect.serviceOption(ShellLink);
      if (Option.isNone(shell)) {
        return yield* unsupported(
          "Shell setup requires the native Flect adapter.",
        );
      }
      return yield* command.action === "install"
        ? shell.value.install
        : shell.value.remove;
    }
    case "setup-agent": {
      const agents = yield* Effect.serviceOption(AgentIntegration);
      if (Option.isNone(agents)) {
        return yield* unsupported(
          "Agent setup requires the native Flect adapter.",
        );
      }
      return yield* command.action === "install"
        ? agents.value.install(command.agent)
        : agents.value.remove(command.agent);
    }
    case "setup-uninstall": {
      const uninstall = yield* Effect.serviceOption(Uninstall);
      if (Option.isNone(uninstall)) {
        return yield* unsupported(
          "Uninstall preparation requires the native Flect adapter.",
        );
      }
      return yield* command.action === "inspect"
        ? uninstall.value.inspect
        : uninstall.value.prepare;
    }
    case "mcp":
      return yield* unsupported(
        "MCP mode is selected by the native Flect process adapter.",
      );
  }
});

export const runFlect = Effect.fn("Flect.Axi.run")(function* (
  argv: ReadonlyArray<string>,
) {
  const gateway = yield* FlectCommandGateway;
  const format = requestedFormat(argv);
  const parsed = yield* Effect.result(
    parseAxiArguments(argv, gateway.audience),
  );
  if (Result.isFailure(parsed)) {
    return yield* failure(
      publicError(
        parsed.failure.code,
        parsed.failure.message,
        parsed.failure.help,
      ),
      format,
      2,
    );
  }
  return yield* execute(parsed.success).pipe(
    Effect.flatMap((value) =>
      renderAxiSuccess({
        format: parsed.success.format,
        full: parsed.success.full,
        value,
      }),
    ),
    Effect.catch((error) =>
      failure(errorProjection(error), parsed.success.format, 1),
    ),
  );
});
