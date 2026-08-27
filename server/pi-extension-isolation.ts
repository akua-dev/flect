import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager
} from '@earendil-works/pi-coding-agent';
import { Effect } from 'effect';
import {
	ExternalPiExtensionFailed,
	type InteractiveAgentRole,
	PiOperationFailed
} from '../shared/contracts';

/**
 * Deterministic integration probe used by Flect's browser-product proof.
 *
 * The probe loads a real extension file through Pi's public resource loader,
 * runs a real Pi turn through an in-memory faux provider, and deliberately
 * discards Pi's private extension error before returning the bounded public
 * contract used by Flect.
 */
export const runTrustedExtensionFailureProbe = Effect.fn(
	'Flect.PiExtensionIsolation.runTrustedExtensionFailureProbe'
)(function* (extensionPath: string, role: InteractiveAgentRole) {
	return yield* Effect.tryPromise({
		try: async () => {
			const provider = fauxProvider({
				provider: `flect-extension-probe-${crypto.randomUUID()}`
			});
			provider.setResponses([fauxAssistantMessage('The isolated extension probe completed.')]);

			const modelRuntime = await ModelRuntime.create({ modelsPath: null });
			modelRuntime.registerNativeProvider(provider.provider);
			const settingsManager = SettingsManager.inMemory();
			const resourceLoader = new DefaultResourceLoader({
				cwd: process.cwd(),
				agentDir: process.cwd(),
				settingsManager,
				additionalExtensionPaths: [extensionPath],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				systemPrompt: 'Run the deterministic Flect extension-isolation probe.'
			});
			await resourceLoader.reload();
			if (resourceLoader.getExtensions().errors.length > 0) {
				throw new Error('The Pi extension fixture did not load.');
			}

			const result = await createAgentSession({
				cwd: process.cwd(),
				agentDir: process.cwd(),
				modelRuntime,
				model: provider.getModel(),
				noTools: 'all',
				sessionManager: SessionManager.inMemory(),
				settingsManager,
				resourceLoader
			});
			let observed = false;
			const unsubscribe = result.session.extensionRunner.onError(() => {
				observed = true;
			});
			try {
				await result.session.prompt('Exercise the enabled extension.');
			} finally {
				unsubscribe();
				result.session.dispose();
			}
			if (!observed) {
				throw new Error('The Pi extension did not emit an isolated failure.');
			}

			return ExternalPiExtensionFailed.make({
				type: 'external_extension_failed',
				role,
				failureId: `extension-failure-${crypto.randomUUID()}`,
				stage: 'turn',
				message: 'A trusted Pi extension failed.',
				recovery: 'Disable trusted Pi extensions for this agent and retry.'
			});
		},
		catch: () =>
			PiOperationFailed.make({
				operation: 'prompt',
				message: 'The model runtime could not complete the request.'
			})
	});
});
