import { Context, type Effect } from "effect";
import type {
  BunCommandFailed,
  BunCommandResult,
} from "../../shared/bun-command";

export type FlectAgentRole = "app" | "shaper";

export interface SandboxedShellExecuteOptions {
  readonly signal?: AbortSignal;
}

export interface SandboxedShellShape {
  readonly role: FlectAgentRole;
  readonly execute: (
    line: string,
    options?: SandboxedShellExecuteOptions,
  ) => Effect.Effect<BunCommandResult, BunCommandFailed>;
}

export class SandboxedShell extends Context.Service<
  SandboxedShell,
  SandboxedShellShape
>()("flect/SandboxedShell") {}
