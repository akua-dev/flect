import { Effect } from "effect";
import {
  decodeCapsule,
  InvalidCapsule,
  MAX_CAPSULE_BYTES,
} from "../../shared/capsule";

export const loadBrowserCapsule = Effect.fn("Flect.Capsule.loadBrowser")(
  (file: Blob) =>
    Effect.tryPromise({
      try: async () => new Uint8Array(await file.arrayBuffer()),
      catch: () =>
        InvalidCapsule.make({ message: "The capsule file could not be read." }),
    }).pipe(Effect.flatMap(decodeCapsule)),
);

const downloadFailed = (message: string) => InvalidCapsule.make({ message });

export const loadBrowserCapsuleArchiveFromUrl = Effect.fn(
  "Flect.Capsule.loadBrowserUrl",
)((input: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const url = new URL(input);
      const localHttp =
        url.protocol === "http:" &&
        (url.hostname === "localhost" ||
          url.hostname === "127.0.0.1" ||
          url.hostname === "::1" ||
          url.hostname === "[::1]");
      if (url.protocol !== "https:" && !localHttp) {
        throw new Error("unsupported capsule URL");
      }
      const response = await fetch(url.href, {
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        signal,
      });
      if (!response.ok) throw new Error("capsule download failed");
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_CAPSULE_BYTES
      ) {
        throw new Error("capsule response is too large");
      }
      if (response.body === null) {
        throw new Error("capsule response has no body");
      }
      const reader = response.body.getReader();
      const chunks: Array<Uint8Array> = [];
      let total = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > MAX_CAPSULE_BYTES) {
          await reader.cancel();
          throw new Error("capsule response is too large");
        }
        chunks.push(next.value);
      }
      const archive = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        archive.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return archive;
    },
    catch: () =>
      downloadFailed(
        "The capsule URL could not be downloaded safely. Check HTTPS, CORS, and the 32 MiB limit.",
      ),
  }).pipe(
    Effect.timeout("20 seconds"),
    Effect.mapError(() =>
      downloadFailed(
        "The capsule URL could not be downloaded safely. Check HTTPS, CORS, and the 32 MiB limit.",
      ),
    ),
    Effect.tap(decodeCapsule),
  ),
);
