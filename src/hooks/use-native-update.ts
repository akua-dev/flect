import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";
import {
  NativeUpdateProgress,
  NativeUpdateSnapshot,
} from "../../shared/native-update";
import {
  type NativeUpdateRuntime,
  nativeUpdateRuntime,
} from "../lib/native-runtimes";
import { NativeUpdate } from "../lib/native-update";

export interface NativeUpdateClient {
  readonly status: () => Promise<NativeUpdateSnapshot>;
  readonly check: () => Promise<NativeUpdateSnapshot>;
  readonly install: (token: string) => Promise<NativeUpdateSnapshot>;
  readonly relaunch: () => Promise<void>;
}

const clientFromRuntime = (
  runtime: NativeUpdateRuntime,
): NativeUpdateClient => ({
  status: () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const updates = yield* NativeUpdate;
        return yield* updates.status;
      }),
    ),
  check: () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const updates = yield* NativeUpdate;
        return yield* updates.check;
      }),
    ),
  install: (token) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const updates = yield* NativeUpdate;
        return yield* updates.install(token);
      }),
    ),
  relaunch: () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const updates = yield* NativeUpdate;
        return yield* updates.relaunch;
      }),
    ),
});

const defaultClient = clientFromRuntime(nativeUpdateRuntime);

export function useNativeUpdate(client: NativeUpdateClient = defaultClient) {
  const [snapshot, setSnapshot] = useState<NativeUpdateSnapshot | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setSnapshot(await client.status());
    } catch {
      setError("Native update state could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (operation: () => Promise<NativeUpdateSnapshot | undefined>) => {
      setLoading(true);
      setError(undefined);
      try {
        const next = await operation();
        if (next !== undefined) {
          setSnapshot(next);
        }
      } catch {
        setError("Flect could not complete the requested update action.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return {
    snapshot,
    loading,
    ...(error === undefined ? {} : { error }),
    refresh,
    check: () => mutate(client.check),
    install: (token: string) =>
      mutate(async () => {
        setSnapshot((current) =>
          current?.state === "available" && current.candidate.token === token
            ? NativeUpdateSnapshot.make({
                version: 1,
                state: "downloading",
                installedVersion: current.installedVersion,
                candidate: current.candidate,
                progress: NativeUpdateProgress.make({
                  downloadedBytes: 0,
                  ...(current.candidate.contentLength === undefined
                    ? {}
                    : { totalBytes: current.candidate.contentLength }),
                }),
              })
            : current,
        );
        return await client.install(token);
      }),
    relaunch: () =>
      mutate(async () => {
        await client.relaunch();
        return undefined;
      }),
  };
}
