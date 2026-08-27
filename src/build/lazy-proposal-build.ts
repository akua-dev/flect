import { Effect, Layer } from 'effect';
import { ProposalBuildFailure } from '../../shared/browser-build';
import { GitWorkspace } from '../git/git-workspace';
import { ProposalBuild, type ProposalBuildShape } from './proposal-build-service';

type LiveProposalBuildHandle = {
	readonly service: ProposalBuildShape;
	readonly dispose: () => Promise<void>;
};

type LiveProposalBuildLoader = (input: {
	readonly git: typeof GitWorkspace.Service;
}) => Promise<LiveProposalBuildHandle>;

const unavailable = () =>
	ProposalBuildFailure.make({
		reason: 'build',
		message: 'The on-demand browser build runtime could not start safely.'
	});

export const makeLazyProposalBuildLayer = (options?: { readonly load?: LiveProposalBuildLoader }) =>
	Layer.effect(
		ProposalBuild,
		Effect.gen(function* () {
			const git = yield* GitWorkspace;
			let handle: Promise<LiveProposalBuildHandle> | undefined;
			const load = () => {
				handle ??=
					options?.load?.({ git }) ??
					import('./live-proposal-build-runtime').then((module) =>
						module.makeLiveProposalBuild({ git })
					);
				return handle;
			};
			const service = Effect.tryPromise({ try: load, catch: unavailable }).pipe(
				Effect.map((loaded) => loaded.service)
			);
			yield* Effect.addFinalizer(() => {
				const current = handle;
				return current === undefined
					? Effect.void
					: Effect.promise(() => current.then((loaded) => loaded.dispose()).catch(() => undefined));
			});
			return {
				resolvePackageLock: (request) =>
					service.pipe(Effect.flatMap((build) => build.resolvePackageLock(request))),
				compile: (request) => service.pipe(Effect.flatMap((build) => build.compile(request)))
			} satisfies ProposalBuildShape;
		})
	);

export const LazyProposalBuildLive = makeLazyProposalBuildLayer();
