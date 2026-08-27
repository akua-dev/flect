/**
 * Flect server config — parsed once at startup from `process.env`, validated
 * by an Effect Schema, and exposed as a structured object the rest of the
 * server consumes (no consumer ever touches `process.env` directly).
 *
 * Mirrors the pattern documented in the root AGENTS.md ("No raw
 * `process.env`"), modeled with Effect `Schema` per the same AGENTS.md's
 * Effect-adoption rule rather than Zod (which is banned for new code).
 */
import { Schema } from 'effect';

const env = process.env;

const FlectServerConfigSchema = Schema.Struct({
	testMode: Schema.Boolean,
	controlStateDir: Schema.optional(Schema.String),
	xdgStateHome: Schema.optional(Schema.String),
	home: Schema.optional(Schema.String)
});

export type FlectServerConfig = typeof FlectServerConfigSchema.Type;

function readEnvIntoShape(): typeof FlectServerConfigSchema.Encoded {
	return {
		testMode: env.FLECT_TEST_MODE === '1',
		controlStateDir: env.FLECT_CONTROL_STATE_DIR || undefined,
		xdgStateHome: env.XDG_STATE_HOME || undefined,
		home: env.HOME || undefined
	};
}

export const flectServerConfig: FlectServerConfig =
	Schema.decodeUnknownSync(FlectServerConfigSchema)(readEnvIntoShape());
