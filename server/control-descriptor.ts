import { Effect, FileSystem, Path, Schema, type SchemaAST } from 'effect';
import { ControlDescriptor } from '../shared/control-channel';
import { flectServerConfig } from './env.server';

const strictOptions: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

export class ControlDescriptorError extends Schema.TaggedErrorClass<ControlDescriptorError>()(
	'ControlDescriptorError',
	{
		message: Schema.Literal('The Flect control descriptor is unavailable.')
	}
) {}

const descriptorError = () =>
	ControlDescriptorError.make({
		message: 'The Flect control descriptor is unavailable.'
	});

export const defaultControlStateDirectory = Effect.fn(
	'Flect.ControlDescriptor.defaultControlStateDirectory'
)(function* () {
	const path = yield* Path.Path;
	const explicit = flectServerConfig.controlStateDir;
	if (explicit !== undefined && explicit.length > 0) {
		return explicit;
	}
	const xdg = flectServerConfig.xdgStateHome;
	if (xdg !== undefined && xdg.length > 0) {
		return path.join(xdg, 'flect');
	}
	const userDirectory = flectServerConfig.home;
	if (userDirectory === undefined || userDirectory.length === 0) {
		return path.join(process.cwd(), '.flect-state');
	}
	return process.platform === 'darwin'
		? path.join(userDirectory, 'Library', 'Application Support', 'Flect')
		: path.join(userDirectory, '.local', 'state', 'flect');
});

const resolveStateDirectory = (stateDirectory: string | undefined) =>
	stateDirectory !== undefined ? Effect.succeed(stateDirectory) : defaultControlStateDirectory();

export const controlDescriptorPath = Effect.fn('Flect.ControlDescriptor.path')(function* (
	stateDirectory?: string
) {
	const path = yield* Path.Path;
	return path.join(yield* resolveStateDirectory(stateDirectory), 'control.json');
});

export const makeControlToken = () => {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Buffer.from(bytes).toString('base64url');
};

export const writeControlDescriptor = Effect.fn('Flect.ControlDescriptor.write')(function* (
	descriptor: ControlDescriptor,
	stateDirectory?: string
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const resolvedStateDirectory = yield* resolveStateDirectory(stateDirectory);
	const target = yield* controlDescriptorPath(resolvedStateDirectory);
	const temporary = `${target}.tmp-${crypto.randomUUID()}`;
	const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(ControlDescriptor))(
		descriptor
	).pipe(Effect.mapError(descriptorError));
	yield* Effect.gen(function* () {
		const directory = path.dirname(target);
		yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
		yield* fs.chmod(directory, 0o700);
		yield* fs.writeFileString(temporary, `${encoded}\n`, { mode: 0o600, flag: 'wx' });
		yield* fs.chmod(temporary, 0o600);
		yield* fs.rename(temporary, target);
		yield* fs.chmod(target, 0o600);
	}).pipe(Effect.mapError(descriptorError));
});

export const removeControlDescriptor = Effect.fn('Flect.ControlDescriptor.remove')(function* (
	stateDirectory?: string
) {
	const fs = yield* FileSystem.FileSystem;
	const resolvedStateDirectory = yield* resolveStateDirectory(stateDirectory);
	const target = yield* controlDescriptorPath(resolvedStateDirectory);
	yield* fs.remove(target).pipe(
		Effect.mapError(descriptorError),
		Effect.catch(() => Effect.void)
	);
});

const processExists = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

export const readControlDescriptor = Effect.fn('Flect.ControlDescriptor.read')(function* (
	stateDirectory?: string,
	verifyProcess = true
) {
	const fs = yield* FileSystem.FileSystem;
	const resolvedStateDirectory = yield* resolveStateDirectory(stateDirectory);
	const target = yield* controlDescriptorPath(resolvedStateDirectory);
	const source = yield* fs.readFileString(target).pipe(Effect.mapError(descriptorError));
	const descriptor = yield* Schema.decodeUnknownEffect(
		Schema.fromJsonString(ControlDescriptor),
		strictOptions
	)(source).pipe(Effect.mapError(descriptorError));
	if (verifyProcess && !processExists(descriptor.pid)) {
		yield* removeControlDescriptor(resolvedStateDirectory);
		return yield* Effect.fail(descriptorError());
	}
	return descriptor;
});
