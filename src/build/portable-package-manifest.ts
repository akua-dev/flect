import { Effect, Schema } from 'effect';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const StringRecord = Schema.Record(Schema.String, Schema.String);

export class PortablePackageManifestFailure extends Schema.TaggedErrorClass<PortablePackageManifestFailure>()(
	'PortablePackageManifestFailure',
	{ message: Schema.String }
) {}

const failure = (message: string) => PortablePackageManifestFailure.make({ message });

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const portablePackageManifest = Effect.fn('Flect.PortablePackageManifest.decode')(function* (
	source: Uint8Array
) {
	const parsed = yield* Effect.try({
		try: (): unknown => JSON.parse(decoder.decode(source)),
		catch: () => failure('The project package manifest is invalid.')
	});
	if (!record(parsed)) {
		return yield* Effect.fail(failure('The project package manifest is invalid.'));
	}
	const dependencies = yield* Schema.decodeUnknownEffect(StringRecord)(
		parsed.dependencies ?? {}
	).pipe(
		Effect.mapError(() => failure('The portable build requires string runtime dependencies.'))
	);
	if (record(parsed.optionalDependencies) && Object.keys(parsed.optionalDependencies).length > 0) {
		return yield* Effect.fail(
			failure('Optional dependencies are not supported by the portable acceptance build.')
		);
	}
	const identity = yield* Effect.try({
		try: () => {
			for (const field of ['name', 'version', 'type'] as const) {
				if (parsed[field] !== undefined && typeof parsed[field] !== 'string') {
					throw new Error(field);
				}
			}
			if (parsed.private !== undefined && typeof parsed.private !== 'boolean') {
				throw new Error('private');
			}
			return {
				...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
				...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
				...(typeof parsed.private === 'boolean' ? { private: parsed.private } : {}),
				...(typeof parsed.type === 'string' ? { type: parsed.type } : {})
			};
		},
		catch: () => failure('The project package identity is invalid.')
	});
	return encoder.encode(
		JSON.stringify({
			...identity,
			dependencies
		})
	);
});
