import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { checkEffect } from './prepare-effect';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);

// Workaround, not a design choice: this runs the exact same `checkEffect`
// Effect the `check:effect` package.json script's `if (import.meta.main)`
// block invokes (bare `bun run check:effect`) -- just through Vitest's
// module loader instead of bun's native `bun run <file>.ts` execution.
// Under Bazel on ubuntu-latest, bun's native execution fails to resolve
// `@effect/platform-bun/BunFileSystem` (a real, installed, on-disk wildcard
// `exports` subpath -- `require.resolve` of the exact same specifier
// succeeds moments earlier in the same process/sandbox), while the
// identical import resolves fine under Vitest. Root-caused and filed
// upstream: https://github.com/oven-sh/bun/issues/40785. Revert this
// (point //:check_effect back at `bun_check(script = "check:effect")`)
// once that's fixed and confirmed on a real ubuntu-latest run.
it.effect('the pinned Effect checkout matches or is legitimately skipped', () =>
	checkEffect.pipe(Effect.provide(platform))
);
