import { Data } from 'effect';

export const WASI_OUTPUT_LIMIT = 1_048_576;

export class WasiOutputLimitExceeded extends Data.TaggedError('WasiOutputLimitExceeded')<{
	readonly stream: 'stdout' | 'stderr';
	readonly message: string;
}> {}

const wasiOutputLimitExceeded = (stream: 'stdout' | 'stderr') =>
	new WasiOutputLimitExceeded({ stream, message: `WASI ${stream} output exceeded its limit.` });

interface BoundedOutputStream {
	readonly write: (chunk: string) => void;
	readonly text: () => string;
}

export interface BoundedWasiOutput {
	readonly stdout: (chunk: string) => void;
	readonly stderr: (chunk: string) => void;
	readonly stdoutText: () => string;
	readonly stderrText: () => string;
}

const makeStream = (stream: 'stdout' | 'stderr', encoder: TextEncoder): BoundedOutputStream => {
	const chunks: Array<string> = [];
	let byteLength = 0;

	return {
		write: (chunk) => {
			const nextByteLength = byteLength + encoder.encode(chunk).byteLength;
			if (nextByteLength > WASI_OUTPUT_LIMIT) {
				throw wasiOutputLimitExceeded(stream);
			}
			byteLength = nextByteLength;
			chunks.push(chunk);
		},
		text: () => chunks.join('')
	};
};

export const makeBoundedWasiOutput = (): BoundedWasiOutput => {
	const encoder = new TextEncoder();
	const stdout = makeStream('stdout', encoder);
	const stderr = makeStream('stderr', encoder);

	return {
		stdout: stdout.write,
		stderr: stderr.write,
		stdoutText: stdout.text,
		stderrText: stderr.text
	};
};
