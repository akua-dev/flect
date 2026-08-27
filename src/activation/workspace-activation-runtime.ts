import { type Duration, Effect, Schema } from 'effect';

export class WorkspaceActivationError extends Schema.TaggedErrorClass<WorkspaceActivationError>()(
	'WorkspaceActivationError',
	{
		reason: Schema.Literals(['hydration-failed', 'timed-out'])
	}
) {}

interface WorkspaceClientModule {
	readonly mountFlect: (root: HTMLElement) => Promise<void>;
}

interface ActivateWorkspaceOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly load?: () => Promise<WorkspaceClientModule>;
	readonly onReady: () => void;
	readonly onError: () => void;
}

export const waitForAstroIsland = (document: Document, timeout: Duration.Input = '20 seconds') =>
	Effect.callback<void, WorkspaceActivationError>((resume) => {
		const ready = () => resume(Effect.void);
		const failed = () =>
			resume(Effect.fail(WorkspaceActivationError.make({ reason: 'hydration-failed' })));
		document.addEventListener('flect:workspace-ready', ready, { once: true });
		document.addEventListener('flect:workspace-error', failed, { once: true });
		document.documentElement.dataset.flectOpenRequested = 'true';
		document.dispatchEvent(new CustomEvent('flect:workspace-open'));
		return Effect.sync(() => {
			document.removeEventListener('flect:workspace-ready', ready);
			document.removeEventListener('flect:workspace-error', failed);
		});
	}).pipe(
		Effect.timeout(timeout),
		Effect.catchTag('TimeoutError', () =>
			Effect.fail(WorkspaceActivationError.make({ reason: 'timed-out' }))
		)
	);

export const activateWorkspace = ({
	document,
	root,
	load,
	onReady,
	onError
}: ActivateWorkspaceOptions) =>
	Effect.runPromise(
		(load === undefined
			? waitForAstroIsland(document)
			: Effect.tryPromise({
					try: async () => {
						const { mountFlect } = await load();
						await mountFlect(root);
					},
					catch: () => WorkspaceActivationError.make({ reason: 'hydration-failed' })
				})
		).pipe(
			Effect.tap(() => Effect.sync(onReady)),
			Effect.tapError(() => Effect.sync(onError))
		)
	);
