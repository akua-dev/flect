import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";
import type {
  AgentIntegrationHost,
  AgentIntegrationStatus,
  ShellLinkStatus,
} from "../../shared/setup";
import type { UninstallPlan } from "../../shared/uninstall";
import { AgentIntegration } from "../lib/agent-integration";
import {
  type NativeSetupRuntime,
  nativeSetupRuntime,
} from "../lib/native-runtimes";
import { ShellLink } from "../lib/shell-link";
import { Uninstall } from "../lib/uninstall";

export interface NativeSetupSnapshot {
  readonly shell: ShellLinkStatus;
  readonly agents: ReadonlyArray<AgentIntegrationStatus>;
  readonly uninstall: UninstallPlan;
}

export interface NativeSetupClient {
  readonly status: () => Promise<NativeSetupSnapshot>;
  readonly installShell: () => Promise<void>;
  readonly removeShell: () => Promise<void>;
  readonly installAgent: (host: AgentIntegrationHost) => Promise<void>;
  readonly removeAgent: (host: AgentIntegrationHost) => Promise<void>;
  readonly prepareUninstall: () => Promise<UninstallPlan>;
}

const clientFromRuntime = (runtime: NativeSetupRuntime): NativeSetupClient => ({
  status: () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const shell = yield* ShellLink;
        const integrations = yield* AgentIntegration;
        const uninstall = yield* Uninstall;
        return {
          shell: yield* shell.status,
          agents: yield* integrations.statusAll,
          uninstall: yield* uninstall.inspect,
        };
      }),
    ),
  installShell: () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const shell = yield* ShellLink;
        yield* shell.install;
      }),
    ),
  removeShell: () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const shell = yield* ShellLink;
        yield* shell.remove;
      }),
    ),
  installAgent: (host) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const integrations = yield* AgentIntegration;
        yield* integrations.install(host);
      }),
    ),
  removeAgent: (host) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const integrations = yield* AgentIntegration;
        yield* integrations.remove(host);
      }),
    ),
  prepareUninstall: () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const uninstall = yield* Uninstall;
        return yield* uninstall.prepare;
      }),
    ),
});

const defaultClient =
  nativeSetupRuntime === undefined
    ? undefined
    : clientFromRuntime(nativeSetupRuntime);

export function useNativeSetup(
  client: NativeSetupClient | undefined = defaultClient,
) {
  const [snapshot, setSnapshot] = useState<NativeSetupSnapshot | undefined>();
  const [loading, setLoading] = useState(client !== undefined);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    if (client === undefined) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      setSnapshot(await client.status());
    } catch {
      setError("Native setup state could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (operation: () => Promise<void>) => {
      setLoading(true);
      setError(undefined);
      try {
        await operation();
        if (client !== undefined) {
          setSnapshot(await client.status());
        }
      } catch {
        setError("Native setup could not apply the requested change.");
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  return {
    available: client !== undefined,
    loading,
    ...(snapshot?.shell === undefined ? {} : { shell: snapshot.shell }),
    agents: snapshot?.agents ?? [],
    ...(snapshot?.uninstall === undefined
      ? {}
      : { uninstall: snapshot.uninstall }),
    ...(error === undefined ? {} : { error }),
    refresh,
    installShell: () =>
      client === undefined ? Promise.resolve() : mutate(client.installShell),
    removeShell: () =>
      client === undefined ? Promise.resolve() : mutate(client.removeShell),
    installAgent: (host: AgentIntegrationHost) =>
      client === undefined
        ? Promise.resolve()
        : mutate(() => client.installAgent(host)),
    removeAgent: (host: AgentIntegrationHost) =>
      client === undefined
        ? Promise.resolve()
        : mutate(() => client.removeAgent(host)),
    prepareUninstall: async () => {
      if (client === undefined) return;
      setLoading(true);
      setError(undefined);
      try {
        const uninstall = await client.prepareUninstall();
        setSnapshot((current) =>
          current === undefined ? current : { ...current, uninstall },
        );
      } catch {
        setError("Flect-owned integrations could not be prepared for removal.");
      } finally {
        setLoading(false);
      }
    },
  };
}
