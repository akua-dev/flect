import { Context, Effect, Layer } from 'effect';
import type {
	AgentIntegrationHost,
	AgentIntegrationStatus,
	ShellLinkStatus
} from '../../shared/setup';
import {
	UninstallApplication,
	UninstallError,
	UninstallOwnedItem,
	UninstallPlan,
	UninstallRetainedItem
} from '../../shared/uninstall';
import { AgentIntegration } from './agent-integration';
import { ShellLink } from './shell-link';

export {
	UninstallApplication,
	UninstallError,
	UninstallOwnedItem,
	UninstallOwnedKind,
	UninstallOwnedResult,
	UninstallPlan,
	UninstallRetainedItem,
	UninstallRetainedKind
} from '../../shared/uninstall';

export interface UninstallShape {
	readonly inspect: Effect.Effect<UninstallPlan, UninstallError>;
	readonly prepare: Effect.Effect<UninstallPlan, UninstallError>;
}

export class Uninstall extends Context.Service<Uninstall, UninstallShape>()('flect/Uninstall') {}

export interface UninstallOptions {
	readonly applicationPath: string;
}

const inspectFailed = () =>
	UninstallError.make({
		reason: 'inspect-failed',
		message: 'Flect could not inspect its owned integrations.'
	});

const invalidApplication = () =>
	UninstallError.make({
		reason: 'invalid-application',
		message: 'Flect could not verify the installed application bundle.'
	});

const validApplicationPath = (path: string) => {
	const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
	const segments = normalized.split('/').filter((segment) => segment !== '');
	return normalized.startsWith('/') && segments.at(-1) === 'Flect.app';
};

export const flectApplicationPathFromExecutable = (executable: string) => {
	const suffix = '/Flect.app/Contents/MacOS/flect';
	return executable.startsWith('/') && executable.endsWith(suffix)
		? executable.slice(0, -'/Contents/MacOS/flect'.length)
		: undefined;
};

const resultForState = (state: ShellLinkStatus['state'] | AgentIntegrationStatus['state']) => {
	switch (state) {
		case 'installed':
		case 'stale':
			return 'pending' as const;
		case 'conflict':
			return 'preserved-conflict' as const;
		case 'absent':
			return 'absent' as const;
	}
};

const shellItem = (status: ShellLinkStatus) =>
	UninstallOwnedItem.make({
		kind: 'shell-link',
		path: status.path,
		result: resultForState(status.state)
	});

const agentItem = (status: AgentIntegrationStatus) =>
	UninstallOwnedItem.make({
		kind: 'agent-integration',
		host: status.host,
		path: status.path,
		result: resultForState(status.state)
	});

const retained = [
	UninstallRetainedItem.make({
		kind: 'workspace-data',
		reason: 'User work is retained by default.'
	}),
	UninstallRetainedItem.make({
		kind: 'provider-authentication',
		reason: 'Authentication remains with its provider owner.'
	}),
	UninstallRetainedItem.make({
		kind: 'exports',
		reason: 'Files outside Flect are never removed.'
	})
] as const;

export const makeUninstall = Effect.fn('Uninstall.make')(function* (options: UninstallOptions) {
	const shell = yield* ShellLink;
	const integrations = yield* AgentIntegration;

	const inspect = Effect.fn('Uninstall.inspect')(function* () {
		if (!validApplicationPath(options.applicationPath)) {
			return yield* Effect.fail(invalidApplication());
		}
		const [shellStatus, agentStatuses] = yield* Effect.all([
			shell.status,
			integrations.statusAll
		]).pipe(Effect.mapError(inspectFailed));
		return UninstallPlan.make({
			version: 1,
			application: UninstallApplication.make({
				path: options.applicationPath,
				action: 'move-to-trash'
			}),
			ownedIntegrations: [shellItem(shellStatus), ...agentStatuses.map(agentItem)],
			retained
		});
	});

	const removeAgent = Effect.fn('Uninstall.removeAgent')(function* (
		item: UninstallOwnedItem,
		host: AgentIntegrationHost
	) {
		const result = yield* Effect.result(integrations.remove(host));
		return UninstallOwnedItem.make({
			...item,
			result: result._tag === 'Success' ? 'removed' : 'failed'
		});
	});

	const prepare = Effect.fn('Uninstall.prepare')(function* () {
		const plan = yield* inspect();
		const ownedIntegrations = yield* Effect.forEach(
			plan.ownedIntegrations,
			(item) => {
				if (item.result !== 'pending') return Effect.succeed(item);
				if (item.kind === 'shell-link') {
					return Effect.result(shell.remove).pipe(
						Effect.map((result) =>
							UninstallOwnedItem.make({
								...item,
								result: result._tag === 'Success' ? 'removed' : 'failed'
							})
						)
					);
				}
				return item.host === undefined
					? Effect.succeed(UninstallOwnedItem.make({ ...item, result: 'failed' }))
					: removeAgent(item, item.host);
			},
			{ concurrency: 1 }
		);
		return UninstallPlan.make({ ...plan, ownedIntegrations });
	});

	return { inspect: inspect(), prepare: prepare() } satisfies UninstallShape;
});

export const makeUninstallLayer = (options: UninstallOptions) =>
	Layer.effect(Uninstall, makeUninstall(options));
