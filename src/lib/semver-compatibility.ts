import { Effect } from 'effect';

export const satisfiesVersion = Effect.fn('Semver.satisfies')((version: string, range: string) =>
	Effect.promise(async () => {
		const { satisfies } = await import('semver');
		return satisfies(version, range, { includePrerelease: true });
	})
);
