import { Effect, Schema } from "effect";

export const PORTABLE_TAR_BLOCK_BYTES = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface PortableTarEntry {
  readonly path: string;
  readonly contents: Uint8Array;
}

export interface PortableTarLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly minimumArchiveBytes: number;
}

export class PortableTarFailure extends Schema.TaggedErrorClass<PortableTarFailure>()(
  "PortableTarFailure",
  {},
) {}

const failure = () => PortableTarFailure.make({});

const write = (
  target: Uint8Array,
  offset: number,
  length: number,
  value: string,
) => target.set(encoder.encode(value).subarray(0, length), offset);

const octal = (value: number, length: number) =>
  `${value.toString(8).padStart(length - 1, "0")}\0`;

const isSafePath = (path: string) => {
  const parts = path.split("/");
  return (
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
};

export const encodePortableTar = Effect.fn("Flect.PortableTar.encode")(
  function* (
    entries: ReadonlyArray<PortableTarEntry>,
    limits: PortableTarLimits,
  ) {
    const chunks: Array<Uint8Array> = [];
    const paths = new Set<string>();
    let totalBytes = PORTABLE_TAR_BLOCK_BYTES * 2;
    if (entries.length === 0 || entries.length > limits.maxEntries) {
      return yield* Effect.fail(failure());
    }
    for (const entry of entries) {
      if (
        entry.path.length === 0 ||
        !isSafePath(entry.path) ||
        encoder.encode(entry.path).byteLength > 100 ||
        paths.has(entry.path) ||
        entry.contents.byteLength > limits.maxEntryBytes
      ) {
        return yield* Effect.fail(failure());
      }
      paths.add(entry.path);
      const header = new Uint8Array(PORTABLE_TAR_BLOCK_BYTES);
      write(header, 0, 100, entry.path);
      write(header, 100, 8, octal(0o644, 8));
      write(header, 108, 8, octal(0, 8));
      write(header, 116, 8, octal(0, 8));
      write(header, 124, 12, octal(entry.contents.byteLength, 12));
      write(header, 136, 12, octal(0, 12));
      header.fill(0x20, 148, 156);
      write(header, 156, 1, "0");
      write(header, 257, 6, "ustar\0");
      write(header, 263, 2, "00");
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      write(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
      const payload = new Uint8Array(
        Math.ceil(entry.contents.byteLength / PORTABLE_TAR_BLOCK_BYTES) *
          PORTABLE_TAR_BLOCK_BYTES,
      );
      payload.set(entry.contents);
      chunks.push(header, payload);
      totalBytes += header.byteLength + payload.byteLength;
      if (totalBytes > limits.maxArchiveBytes) {
        return yield* Effect.fail(failure());
      }
    }
    const archive = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      archive.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return archive;
  },
);

const readText = (header: Uint8Array, start: number, length: number) =>
  Effect.try({
    try: () =>
      decoder
        .decode(header.subarray(start, start + length))
        .replace(/\0.*$/, ""),
    catch: failure,
  });

export const decodePortableTar = Effect.fn("Flect.PortableTar.decode")(
  function* (archive: Uint8Array, limits: PortableTarLimits) {
    if (
      archive.byteLength > limits.maxArchiveBytes ||
      archive.byteLength < limits.minimumArchiveBytes ||
      archive.byteLength % PORTABLE_TAR_BLOCK_BYTES !== 0
    ) {
      return yield* Effect.fail(failure());
    }
    const entries: Array<PortableTarEntry> = [];
    const paths = new Set<string>();
    let ended = false;
    for (
      let offset = 0;
      offset + PORTABLE_TAR_BLOCK_BYTES <= archive.byteLength;
    ) {
      const header = archive.subarray(
        offset,
        offset + PORTABLE_TAR_BLOCK_BYTES,
      );
      if (header.every((byte) => byte === 0)) {
        if (
          offset + PORTABLE_TAR_BLOCK_BYTES * 2 > archive.byteLength ||
          !archive
            .subarray(offset, offset + PORTABLE_TAR_BLOCK_BYTES * 2)
            .every((byte) => byte === 0) ||
          !archive
            .subarray(offset + PORTABLE_TAR_BLOCK_BYTES * 2)
            .every((byte) => byte === 0)
        ) {
          return yield* Effect.fail(failure());
        }
        ended = true;
        break;
      }
      const [path, sizeText, checksumText, magic, version, prefix] =
        yield* Effect.all([
          readText(header, 0, 100),
          readText(header, 124, 12),
          readText(header, 148, 8),
          readText(header, 257, 6),
          readText(header, 263, 2),
          readText(header, 345, 155),
        ]);
      const size = Number.parseInt(sizeText.trim(), 8);
      const storedChecksum = Number.parseInt(checksumText.trim(), 8);
      const checksum = header.reduce(
        (sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte),
        0,
      );
      if (
        path.length === 0 ||
        !isSafePath(path) ||
        encoder.encode(path).byteLength > 100 ||
        paths.has(path) ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > limits.maxEntryBytes ||
        storedChecksum !== checksum ||
        magic !== "ustar" ||
        version !== "00" ||
        prefix.length > 0 ||
        header[156] !== 0x30
      ) {
        return yield* Effect.fail(failure());
      }
      paths.add(path);
      offset += PORTABLE_TAR_BLOCK_BYTES;
      if (offset + size > archive.byteLength) {
        return yield* Effect.fail(failure());
      }
      entries.push({
        path,
        contents: archive.slice(offset, offset + size),
      });
      if (entries.length > limits.maxEntries) {
        return yield* Effect.fail(failure());
      }
      const paddedSize =
        Math.ceil(size / PORTABLE_TAR_BLOCK_BYTES) * PORTABLE_TAR_BLOCK_BYTES;
      if (
        !archive
          .subarray(offset + size, offset + paddedSize)
          .every((byte) => byte === 0)
      ) {
        return yield* Effect.fail(failure());
      }
      offset += paddedSize;
    }
    if (!ended) {
      return yield* Effect.fail(failure());
    }
    return entries;
  },
);
