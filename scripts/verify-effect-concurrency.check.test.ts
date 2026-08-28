import { it } from '@effect/vitest';
import { verifyEffectConcurrency } from './verify-effect-concurrency';

// Workaround, not a design choice: this runs the exact same
// `verifyEffectConcurrency` Effect the `check:effect-concurrency`
// package.json script's `if (import.meta.main)` block invokes (bare
// `bun run check:effect-concurrency`) -- just through Vitest's module
// loader instead of bun's native `bun run <file>.ts` execution. Under
// Bazel on ubuntu-latest, bun's native execution fails to resolve
// `@effect/platform-bun/BunRuntime` (a real, installed, on-disk wildcard
// `exports` subpath -- `require.resolve` of the exact same specifier
// succeeds moments earlier in the same process/sandbox), while the
// identical import resolves fine under Vitest. Root-caused and filed
// upstream: https://github.com/oven-sh/bun/issues/40785. Revert this
// (point //:check_effect_concurrency back at
// `bun_check(script = "check:effect-concurrency")`) once that's fixed
// and confirmed on a real ubuntu-latest run.
it.effect(
	'flect source uses Effect concurrency, not ad hoc promises',
	() => verifyEffectConcurrency
);
