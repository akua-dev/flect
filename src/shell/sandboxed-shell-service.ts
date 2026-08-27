import { Context, type Effect } from 'effect';
import type { BunCommandFailed, BunCommandResult } from '../../shared/bun-command';
import type { InteractiveAgentRole } from '../../shared/contracts';

export type FlectAgentRole = InteractiveAgentRole;
export type SandboxedShellWorkspace = FlectAgentRole | 'previewApp';

export interface SandboxedAgentContext {
	readonly sessionId: string;
	readonly parentOperationId: string;
	readonly requestId: string;
	readonly binding?: 'accepted' | 'candidate';
}

export interface SandboxedShellExecuteOptions {
	readonly signal?: AbortSignal;
	readonly agentContext?: SandboxedAgentContext;
}

export interface SandboxedShellShape {
	readonly replaceTree: (
		workspace: SandboxedShellWorkspace,
		root: string,
		files: ReadonlyArray<{
			readonly path: string;
			readonly contents: Uint8Array;
		}>
	) => Effect.Effect<void, BunCommandFailed>;
	readonly execute: (
		workspace: SandboxedShellWorkspace,
		line: string,
		options?: SandboxedShellExecuteOptions
	) => Effect.Effect<BunCommandResult, BunCommandFailed>;
	readonly stop: (workspace: SandboxedShellWorkspace) => Effect.Effect<void, BunCommandFailed>;
}

export class SandboxedShell extends Context.Service<SandboxedShell, SandboxedShellShape>()(
	'flect/SandboxedShell'
) {}
