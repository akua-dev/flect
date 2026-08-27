import { readFile } from 'node:fs/promises';
import { Effect, Schema } from 'effect';

export const RIFTY_DEPENDENCIES: ReadonlyArray<string> = [
	'@riftydev/npm-client',
	'@riftydev/runtime-js',
	'@riftydev/runtime-wasi',
	'@riftydev/vfs'
];

class PackageRepository extends Schema.Class<PackageRepository>('PackageRepository')({
	type: Schema.Literal('git'),
	url: Schema.String
}) {}

class PackageManifest extends Schema.Class<PackageManifest>('PackageManifest')({
	name: Schema.String,
	version: Schema.String,
	license: Schema.String,
	repository: PackageRepository
}) {}

export class VerifiedRiftyDependency extends Schema.Class<VerifiedRiftyDependency>(
	'VerifiedRiftyDependency'
)({
	name: Schema.String,
	version: Schema.String,
	license: Schema.String
}) {}

export class RiftyDependencyVerificationFailed extends Schema.TaggedErrorClass<RiftyDependencyVerificationFailed>()(
	'RiftyDependencyVerificationFailed',
	{
		packageName: Schema.String,
		message: Schema.String
	}
) {}

const decodeManifest = Schema.decodeUnknownEffect(PackageManifest, {
	errors: 'all',
	onExcessProperty: 'ignore'
});

type ManifestReader = (path: string) => Effect.Effect<unknown, RiftyDependencyVerificationFailed>;

const readManifest: ManifestReader = (path) =>
	Effect.tryPromise({
		try: async () => JSON.parse(await readFile(path, 'utf8')) as unknown,
		catch: () =>
			RiftyDependencyVerificationFailed.make({
				packageName: path,
				message: 'The installed Rifty package manifest could not be read.'
			})
	});

const verifyOne = (
	read: ManifestReader,
	name: string
): Effect.Effect<VerifiedRiftyDependency, RiftyDependencyVerificationFailed> =>
	Effect.gen(function* () {
		const path = `node_modules/${name}/package.json`;
		const input = yield* read(path);
		const manifest = yield* decodeManifest(input).pipe(
			Effect.mapError(() =>
				RiftyDependencyVerificationFailed.make({
					packageName: name,
					message: 'The installed Rifty package manifest is invalid.'
				})
			)
		);

		if (
			manifest.name !== name ||
			manifest.version !== '0.2.0' ||
			manifest.license !== 'MIT' ||
			!manifest.repository.url.includes('github.com/vanilla-wave/rifty')
		) {
			return yield* Effect.fail(
				RiftyDependencyVerificationFailed.make({
					packageName: name,
					message: 'The installed Rifty package does not match the approved pin.'
				})
			);
		}

		return VerifiedRiftyDependency.make({
			name,
			version: manifest.version,
			license: manifest.license
		});
	});

export const makeVerifyRiftyDependencies = (read: ManifestReader) =>
	Effect.forEach(RIFTY_DEPENDENCIES, (name) => verifyOne(read, name), {
		concurrency: 1
	});

export const verifyRiftyDependencies = makeVerifyRiftyDependencies(readManifest);

if (import.meta.main) {
	Effect.runPromise(verifyRiftyDependencies).then((entries) => {
		for (const entry of entries) {
			console.log(`${entry.name}@${entry.version} ${entry.license}`);
		}
	});
}
