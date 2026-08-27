import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { AxiPublicError } from './contracts';
import { AXI_DEFAULT_TEXT_LIMIT, renderAxiFailure, renderAxiSuccess } from './output';

describe('AXI output', () => {
	it.effect('renders compact TOON with a definitive empty collection', () =>
		Effect.gen(function* () {
			const result = yield* renderAxiSuccess({
				format: 'toon',
				value: { count: 0, actions: [] }
			});

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, '');
			assert.strictEqual(result.stdout, 'count: 0\nactions: []\n');
		})
	);

	it.effect('renders JSON only when explicitly selected', () =>
		Effect.gen(function* () {
			const result = yield* renderAxiSuccess({
				format: 'json',
				value: { count: 1, actions: [{ id: 'run', state: 'ready' }] }
			});

			assert.strictEqual(result.exitCode, 0);
			assert.deepStrictEqual(JSON.parse(result.stdout), {
				count: 1,
				actions: [{ id: 'run', state: 'ready' }]
			});
			assert.isTrue(result.stdout.endsWith('\n'));
		})
	);

	it.effect('puts structured usage errors on stdout with exit code 2', () =>
		Effect.gen(function* () {
			const result = yield* renderAxiFailure(
				AxiPublicError.make({
					code: 'unknown-flag',
					message: 'Unknown flag --stat for action list.',
					help: ['Run `flect action list --help`']
				}),
				'toon',
				2
			);

			assert.strictEqual(result.exitCode, 2);
			assert.strictEqual(result.stderr, '');
			assert.include(result.stdout, 'code: unknown-flag');
			assert.include(result.stdout, 'message: Unknown flag --stat');
			assert.include(result.stdout, 'help[1]:');
		})
	);

	it.effect('truncates long fields with their exact size and escape hatch', () =>
		Effect.gen(function* () {
			const body = 'x'.repeat(AXI_DEFAULT_TEXT_LIMIT + 37);
			const result = yield* renderAxiSuccess({
				format: 'toon',
				value: { item: { body } }
			});

			assert.notInclude(result.stdout, body);
			assert.include(result.stdout, `(truncated, ${body.length} chars total — use --full)`);
		})
	);

	it.effect('preserves authorized long fields in full mode', () =>
		Effect.gen(function* () {
			const body = 'x'.repeat(AXI_DEFAULT_TEXT_LIMIT + 37);
			const result = yield* renderAxiSuccess({
				format: 'toon',
				full: true,
				value: { item: { body } }
			});

			assert.include(result.stdout, body);
			assert.notInclude(result.stdout, 'truncated');
		})
	);

	it.effect('fails safely when encoded output exceeds its byte budget', () =>
		Effect.gen(function* () {
			const outcome = yield* Effect.result(
				renderAxiSuccess({
					format: 'json',
					full: true,
					maxBytes: 64,
					value: { body: 'x'.repeat(128) }
				})
			);

			assert.strictEqual(outcome._tag, 'Failure');
			if (outcome._tag === 'Failure') {
				assert.strictEqual(outcome.failure._tag, 'AxiFormatError');
				assert.strictEqual(outcome.failure.message, 'Flect output exceeded its safe size limit.');
			}
		})
	);
});
