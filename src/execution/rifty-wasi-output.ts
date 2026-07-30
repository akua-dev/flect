export const WASI_OUTPUT_LIMIT = 1_048_576;

export class WasiOutputLimitExceeded extends Error {
  readonly stream: "stdout" | "stderr";

  constructor(stream: "stdout" | "stderr") {
    super(`WASI ${stream} output exceeded its limit.`);
    this.name = "WasiOutputLimitExceeded";
    this.stream = stream;
  }
}

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

const makeStream = (
  stream: "stdout" | "stderr",
  encoder: TextEncoder,
): BoundedOutputStream => {
  const chunks: Array<string> = [];
  let byteLength = 0;

  return {
    write: (chunk) => {
      const nextByteLength = byteLength + encoder.encode(chunk).byteLength;
      if (nextByteLength > WASI_OUTPUT_LIMIT) {
        throw new WasiOutputLimitExceeded(stream);
      }
      byteLength = nextByteLength;
      chunks.push(chunk);
    },
    text: () => chunks.join(""),
  };
};

export const makeBoundedWasiOutput = (): BoundedWasiOutput => {
  const encoder = new TextEncoder();
  const stdout = makeStream("stdout", encoder);
  const stderr = makeStream("stderr", encoder);

  return {
    stdout: stdout.write,
    stderr: stderr.write,
    stdoutText: stdout.text,
    stderrText: stderr.text,
  };
};
