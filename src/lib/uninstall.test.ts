import { assert, describe, it } from '@effect/vitest';
import { Effect, Layer, Ref } from 'effect';
import { AgentIntegrationStatus, ShellLinkStatus } from '../../shared/setup';
import { AgentIntegration, type AgentIntegrationShape } from './agent-integration';
import { ShellLink, type ShellLinkShape } from './shell-link';
import { flectApplicationPathFromExecutable, makeUninstallLayer, Uninstall } from './uninstall';

const shellStatus = (state: ShellLinkStatus['state']) =>
	ShellLinkStatus.make({
		state,
		path: '/fixture/home/.local/bin/flect',
		changed: false
	});

const agentStatus = (
	host: AgentIntegrationStatus['host'],
	state: AgentIntegrationStatus['state']
) =>
	AgentIntegrationStatus.make({
		host,
		state,
		path: `/fixture/home/.${host}/flect-owned`,
		changed: false
	});

describe('Uninstall', () => {
	it('derives only the fixed app bundle from a packaged public executable', () => {
		assert.strictEqual(
			flectApplicationPathFromExecutable('/Applications/Flect.app/Contents/MacOS/flect'),
			'/Applications/Flect.app'
		);
		assert.isUndefined(flectApplicationPathFromExecutable('/usr/local/bin/flect'));
		assert.isUndefined(
			flectApplicationPathFromExecutable('/Applications/Other.app/Contents/MacOS/flect')
		);
	});

	it.effect('classifies owned, foreign, absent, and retained state', () =>
		Effect.gen(function* () {
			const removed = yield* Ref.make<ReadonlyArray<string>>([]);
			const shell: ShellLinkShape = {
				status: Effect.succeed(shellStatus('installed')),
				install: Effect.succeed(shellStatus('installed')),
				remove: Ref.update(removed, (current) => [...current, 'shell']).pipe(
					Effect.as(shellStatus('absent'))
				)
			};
			const statuses = [
				agentStatus('codex', 'stale'),
				agentStatus('claude', 'conflict'),
				agentStatus('opencode', 'absent')
			];
			const agents: AgentIntegrationShape = {
				status: (host) =>
					Effect.succeed(statuses.find((status) => status.host === host) ?? statuses[0]),
				statusAll: Effect.succeed(statuses),
				install: (host) => Effect.succeed(agentStatus(host, 'installed')),
				remove: (host) =>
					Ref.update(removed, (current) => [...current, host]).pipe(
						Effect.as(agentStatus(host, 'absent'))
					)
			};

			const result = yield* Effect.gen(function* () {
				const uninstall = yield* Uninstall;
				const plan = yield* uninstall.inspect;
				const prepared = yield* uninstall.prepare;
				return { plan, prepared };
			}).pipe(
				Effect.provide(
					makeUninstallLayer({
						applicationPath: '/fixture/Applications/Flect.app'
					}).pipe(
						Layer.provide(
							Layer.merge(Layer.succeed(ShellLink)(shell), Layer.succeed(AgentIntegration)(agents))
						)
					)
				)
			);

			assert.strictEqual(result.plan.application.action, 'move-to-trash');
			assert.deepStrictEqual(
				result.plan.ownedIntegrations.map((item) => [item.kind, item.host, item.result]),
				[
					['shell-link', undefined, 'pending'],
					['agent-integration', 'codex', 'pending'],
					['agent-integration', 'claude', 'preserved-conflict'],
					['agent-integration', 'opencode', 'absent']
				]
			);
			assert.deepStrictEqual(
				result.plan.retained.map((item) => item.kind),
				['workspace-data', 'provider-authentication', 'exports']
			);
			assert.deepStrictEqual(yield* Ref.get(removed), ['shell', 'codex']);
			assert.deepStrictEqual(
				result.prepared.ownedIntegrations.map((item) => item.result),
				['removed', 'removed', 'preserved-conflict', 'absent']
			);
		})
	);

	it.effect('rejects a path that is not the fixed Flect application bundle', () =>
		Effect.gen(function* () {
			const shell: ShellLinkShape = {
				status: Effect.succeed(shellStatus('absent')),
				install: Effect.succeed(shellStatus('installed')),
				remove: Effect.succeed(shellStatus('absent'))
			};
			const agents: AgentIntegrationShape = {
				status: (host) => Effect.succeed(agentStatus(host, 'absent')),
				statusAll: Effect.succeed([
					agentStatus('codex', 'absent'),
					agentStatus('claude', 'absent'),
					agentStatus('opencode', 'absent')
				]),
				install: (host) => Effect.succeed(agentStatus(host, 'installed')),
				remove: (host) => Effect.succeed(agentStatus(host, 'absent'))
			};

			const result = yield* Effect.result(
				Effect.gen(function* () {
					const uninstall = yield* Uninstall;
					return yield* uninstall.inspect;
				}).pipe(
					Effect.provide(
						makeUninstallLayer({ applicationPath: '/fixture/home' }).pipe(
							Layer.provide(
								Layer.merge(
									Layer.succeed(ShellLink)(shell),
									Layer.succeed(AgentIntegration)(agents)
								)
							)
						)
					)
				)
			);

			assert.strictEqual(result._tag, 'Failure');
			if (result._tag === 'Failure') {
				assert.strictEqual(result.failure.reason, 'invalid-application');
			}
		})
	);
});
