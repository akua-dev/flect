import { Context, type Effect } from "effect";
import type {
  BunCommandFailed,
  BunCommandResult,
} from "../../shared/bun-command";
import type { InteractiveAgentRole } from "../../shared/contracts";

export type FlectAgentRole = InteractiveAgentRole;

export interface SandboxedShellExecuteOptions {
  readonly signal?: AbortSignal;
}

export interface SandboxedShellShape {
  readonly execute: (
    role: FlectAgentRole,
    line: string,
    options?: SandboxedShellExecuteOptions,
  ) => Effect.Effect<BunCommandResult, BunCommandFailed>;
  readonly stop: (
    role: FlectAgentRole,
  ) => Effect.Effect<void, BunCommandFailed>;
}

export class SandboxedShell extends Context.Service<
  SandboxedShell,
  SandboxedShellShape
>()("flect/SandboxedShell") {}
