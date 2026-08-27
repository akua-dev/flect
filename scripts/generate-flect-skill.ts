import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect, FileSystem, Layer, Path, Schema } from 'effect';
import { FLECT_COMMAND_METADATA, type FlectCommandMetadata } from '../src/axi/command';

export class FlectSkillGenerationError extends Schema.TaggedErrorClass<FlectSkillGenerationError>()(
	'FlectSkillGenerationError',
	{
		reason: Schema.Literals(['io', 'stale']),
		message: Schema.String
	}
) {}

const audience = (values: ReadonlyArray<string>) =>
	values
		.map((value) => {
			switch (value) {
				case 'app':
					return 'App Agent';
				case 'shaper':
					return 'Shaper';
				default:
					return 'outside agent';
			}
		})
		.join(', ');

const tableValue = (value: string) => value.replaceAll('|', '\\|');

export const renderFlectSkill = (commands: ReadonlyArray<FlectCommandMetadata>) => `---
name: flect
description: Operate and inspect a running Flect interface through its bounded agent-first command surface. Use when an agent needs to inspect Flect state, read operation evidence, invoke visible actions, shape an interface, manage revisions or models, debug a Flect workspace, or configure explicit native Flect integrations.
---

# Flect

Use the public \`flect\` command. Treat it as the authoritative command surface for the running interface; do not drive React, storage, broker internals, or private runtime binaries directly.

## Start with discovery

1. Run \`flect\` with no arguments for content-first discovery and relevant next actions.
2. Run \`flect inspect\` only when more workspace detail is needed.
3. Run \`flect action list\` before invoking a product action.
4. Prefer default bounded TOON output. Add \`--json\` only for a consumer that requires JSON and \`--full\` only when complete authorized text is necessary.

## Respect authority

- App Agent uses the accepted product and its projected actions. It does not shape or accept revisions.
- Shaper changes interface candidates inside its disposable sandbox. Run \`flect interface validate <path>\` before \`flect interface propose <path>\`; proposal acceptance remains a user decision.
- Outside agents require the user's explicit local-control grant before live workspace operations become available.
- Help visibility is not authorization. Treat structured \`unauthorized\`, \`conflict\`, \`rejected\`, and \`unavailable\` results as definitive.

## Command map

| Command | Purpose | Intended caller |
| --- | --- | --- |
${commands
	.map(
		(command) =>
			`| \`${tableValue(command.usage)}\` | ${tableValue(command.summary)} | ${audience(command.audiences)} |`
	)
	.join('\n')}

## Keep the boundary safe

- Never request or print model credentials, the local-control capability, private runtime flags, or unbounded logs.
- Use explicit set-shaped commands instead of inventing toggles or raw payload escape hatches.
- Read the returned receipt and resulting workspace state before deciding whether another command is needed.
- Use \`flect logs --limit 20\` for bounded failure evidence and safe mode for deterministic recovery.
`;

export interface GenerateFlectSkillOptions {
	readonly check: boolean;
	readonly outputPath?: string;
	readonly commands?: ReadonlyArray<FlectCommandMetadata>;
}

export const generateFlectSkill = Effect.fn('Flect.Skill.generate')(function* (
	options: GenerateFlectSkillOptions
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const outputPath =
		options.outputPath ??
		(yield* path.fromFileUrl(new URL('../.agents/skills/flect/SKILL.md', import.meta.url)));
	const expected = renderFlectSkill(options.commands ?? FLECT_COMMAND_METADATA);
	if (options.check) {
		const current = yield* fs.readFileString(outputPath).pipe(
			Effect.mapError(() =>
				FlectSkillGenerationError.make({
					reason: 'stale',
					message: 'The checked-in Flect skill is missing or stale.'
				})
			)
		);
		if (current !== expected) {
			return yield* Effect.fail(
				FlectSkillGenerationError.make({
					reason: 'stale',
					message: 'The checked-in Flect skill is missing or stale.'
				})
			);
		}
		return;
	}
	yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true }).pipe(
		Effect.andThen(fs.writeFileString(outputPath, expected, { mode: 0o644 })),
		Effect.mapError(() =>
			FlectSkillGenerationError.make({
				reason: 'io',
				message: 'Flect could not write the generated skill.'
			})
		)
	);
});

if (import.meta.main) {
	generateFlectSkill({ check: process.argv.includes('--check') }).pipe(
		Effect.provide(Layer.merge(BunFileSystem.layer, BunPath.layer)),
		BunRuntime.runMain
	);
}
