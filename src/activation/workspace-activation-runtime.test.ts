// @vitest-environment jsdom

import { assert, it } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { waitForAstroIsland } from './workspace-activation-runtime';

it.effect('completes when the deferred workspace reports readiness', () =>
	Effect.gen(function* () {
		const activation = yield* waitForAstroIsland(document).pipe(Effect.forkChild);
		yield* Effect.yieldNow;

		document.dispatchEvent(new CustomEvent('flect:workspace-ready'));

		yield* Fiber.join(activation);
		assert.strictEqual(document.documentElement.dataset.flectOpenRequested, 'true');
	})
);

it.effect('fails closed instead of leaving activation pending forever', () =>
	Effect.gen(function* () {
		const activation = yield* waitForAstroIsland(document, '1 second').pipe(Effect.forkChild);

		yield* TestClock.adjust('1 second');
		const failure = yield* Fiber.join(activation).pipe(Effect.flip);

		assert.strictEqual(failure._tag, 'WorkspaceActivationError');
		assert.strictEqual(failure.reason, 'timed-out');
	})
);
