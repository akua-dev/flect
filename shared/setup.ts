import { Schema } from 'effect';

export const AgentIntegrationHost = Schema.Literals(['codex', 'claude', 'opencode']);
export type AgentIntegrationHost = typeof AgentIntegrationHost.Type;

export const AgentIntegrationState = Schema.Literals(['absent', 'installed', 'stale', 'conflict']);
export type AgentIntegrationState = typeof AgentIntegrationState.Type;

export class AgentIntegrationStatus extends Schema.Class<AgentIntegrationStatus>(
	'AgentIntegrationStatus'
)({
	host: AgentIntegrationHost,
	state: AgentIntegrationState,
	path: Schema.String,
	changed: Schema.Boolean
}) {}

export class AgentIntegrationError extends Schema.TaggedErrorClass<AgentIntegrationError>()(
	'AgentIntegrationError',
	{
		host: AgentIntegrationHost,
		reason: Schema.Literals(['conflict', 'invalid-config', 'io']),
		message: Schema.String
	}
) {}

export const ShellLinkState = Schema.Literals(['absent', 'installed', 'stale', 'conflict']);
export type ShellLinkState = typeof ShellLinkState.Type;

export class ShellLinkStatus extends Schema.Class<ShellLinkStatus>('ShellLinkStatus')({
	state: ShellLinkState,
	path: Schema.String,
	changed: Schema.Boolean
}) {}

export class ShellLinkError extends Schema.TaggedErrorClass<ShellLinkError>()('ShellLinkError', {
	reason: Schema.Literals(['conflict', 'io']),
	message: Schema.String
}) {}
