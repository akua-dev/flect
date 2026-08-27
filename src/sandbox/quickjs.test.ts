import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { executeQuickJsExtension } from './quickjs';

describe('QuickJS extension realm', () => {
	it.effect('returns only schema-defined capability intents', () =>
		Effect.gen(function* () {
			const result = yield* executeQuickJsExtension({
				extensionId: 'weather-card',
				source: "input => ({ type: 'set-text', target: 'weather', text: input.city })",
				input: { city: 'Berlin' }
			});

			assert.strictEqual(result.intents.length, 1);
			assert.strictEqual(result.intents[0]?.type, 'set-text');
			assert.strictEqual(result.intents[0]?.target, 'weather');
			assert.strictEqual(result.intents[0]?.text, 'Berlin');
		})
	);

	it.effect('has no ambient host authority or dynamic evaluation', () =>
		Effect.gen(function* () {
			const result = yield* executeQuickJsExtension({
				extensionId: 'authority-check',
				source: `() => ({
          type: "set-text",
          target: "authority",
          text: [
            typeof fetch,
            typeof document,
            typeof localStorage,
            typeof process,
            typeof require,
            typeof Bun,
            typeof __TAURI__,
            typeof Date,
            typeof Promise,
            typeof Proxy,
            typeof eval,
            typeof Function,
            typeof AsyncFunction,
            typeof AsyncGeneratorFunction
          ].join(",")
        })`,
				input: {}
			});

			assert.strictEqual(
				result.intents[0]?.type === 'set-text' ? result.intents[0].text : '',
				Array.from({ length: 14 }, () => 'undefined').join(',')
			);
		})
	);

	it.effect('blocks every dynamic function constructor family', () =>
		Effect.gen(function* () {
			const result = yield* executeQuickJsExtension({
				extensionId: 'constructor-check',
				source: `() => {
          const attempts = [
            () => (function () {}).constructor("return 1")(),
            () => (function* () {}).constructor("return 2")().next().value,
            () => (async function () {}).constructor("return 3")(),
            () => (async function* () {}).constructor("return 4")()
          ];
          return {
            type: "set-text",
            target: "constructor-check",
            text: attempts.map((attempt) => {
              try {
                attempt();
                return "escaped";
              } catch {
                return "blocked";
              }
            }).join(",")
          };
        }`,
				input: {}
			});

			assert.strictEqual(
				result.intents[0]?.type === 'set-text' ? result.intents[0].text : '',
				'blocked,blocked,blocked,blocked'
			);
		})
	);

	it.effect('interrupts computations that exceed the inner deadline', () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				executeQuickJsExtension({
					extensionId: 'infinite-loop',
					source: '() => { while (true) {} }',
					input: {}
				})
			);

			assert.strictEqual(error._tag, 'SandboxExecutionFailed');
			assert.strictEqual(error.reason, 'deadline');
			assert.strictEqual(error.message, 'Extension execution failed safely.');
		})
	);

	it.effect('rejects malformed results without exposing their values', () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				executeQuickJsExtension({
					extensionId: 'malformed',
					source: "() => ({ secret: 'must-not-escape' })",
					input: {}
				})
			);

			assert.strictEqual(error._tag, 'SandboxExecutionFailed');
			assert.strictEqual(error.reason, 'invalid-result');
			assert.notInclude(error.message, 'must-not-escape');
		})
	);

	it.effect('enforces source, input, and output byte limits', () =>
		Effect.gen(function* () {
			const source = yield* Effect.flip(
				executeQuickJsExtension({
					extensionId: 'source-limit',
					source: `() => null /* ${'x'.repeat(256 * 1024)} */`,
					input: {}
				})
			);
			const input = yield* Effect.flip(
				executeQuickJsExtension({
					extensionId: 'input-limit',
					source: '() => null',
					input: { text: 'x'.repeat(1024 * 1024) }
				})
			);
			const output = yield* Effect.flip(
				executeQuickJsExtension({
					extensionId: 'output-limit',
					source: `() => ({
            type: "set-text",
            target: "large-output",
            text: "x".repeat(1024 * 1024)
          })`,
					input: {}
				})
			);

			assert.strictEqual(source.reason, 'source-limit');
			assert.strictEqual(input.reason, 'input-limit');
			assert.strictEqual(output.reason, 'output-limit');
		})
	);

	it.effect('enforces the stack boundary without error details', () =>
		Effect.gen(function* () {
			const stack = yield* Effect.flip(
				executeQuickJsExtension({
					extensionId: 'stack-limit',
					source: `() => ${'('.repeat(20_000)}0${')'.repeat(20_000)}`,
					input: {}
				})
			);

			assert.strictEqual(stack.reason, 'execution');
			assert.strictEqual(stack.message, 'Extension execution failed safely.');
		})
	);

	it.effect('classifies heap exhaustion without error details', () =>
		Effect.gen(function* () {
			const memory = yield* Effect.flip(
				executeQuickJsExtension({
					extensionId: 'memory-limit',
					source: "() => 'memory'.repeat(4_000_000)",
					input: {}
				})
			);

			assert.strictEqual(memory.reason, 'memory');
			assert.strictEqual(memory.message, 'Extension execution failed safely.');
		})
	);
});
