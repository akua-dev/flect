import { BrowserHttpClient } from "@effect/platform-browser";
import { isTauri } from "@tauri-apps/api/core";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  CapabilityAdapter,
  SandboxCapabilityBrokerLive,
} from "../sandbox/capability-broker";
import { ExtensionExecutionLive } from "../sandbox/extension-execution";
import { ExtensionSandboxLive } from "../sandbox/extension-sandbox";
import {
  type FlectClient,
  type FlectUnavailableError,
  makeFlectClientLayer,
} from "./api";
import { makeInterfaceRepositoryLayer } from "./interface-repository";
import { type InterfaceStorage, InterfaceStorageLive } from "./interface-store";
import { makePersistentShapingKernelLayer } from "./shaping-kernel";
import { makeTauriFlectClientLayer, TauriBridgeLive } from "./tauri-transport";

const ClientLive = isTauri()
  ? makeTauriFlectClientLayer().pipe(Layer.provide(TauriBridgeLive))
  : makeFlectClientLayer().pipe(Layer.provide(BrowserHttpClient.layerFetch));

const BrowserLive = Layer.merge(ClientLive, InterfaceStorageLive);

export type FlectBrowserServices = FlectClient | InterfaceStorage;
export type FlectBrowserRuntime = ManagedRuntime.ManagedRuntime<
  FlectBrowserServices,
  FlectUnavailableError
>;

export const browserRuntime: FlectBrowserRuntime =
  ManagedRuntime.make(BrowserLive);

const CapabilityAdapterLive = Layer.succeed(CapabilityAdapter)({
  setText: () => Effect.void,
});

const CapabilityBrokerLive = SandboxCapabilityBrokerLive.pipe(
  Layer.provide(CapabilityAdapterLive),
);

const safeMode =
  new URLSearchParams(globalThis.location.search).get("safe") === "1";

const InterfaceRepositoryLive = makeInterfaceRepositoryLayer({
  safeMode,
}).pipe(Layer.provide(InterfaceStorageLive));

const PersistentShapingKernelLive = makePersistentShapingKernelLayer().pipe(
  Layer.provide(InterfaceRepositoryLive),
);

const ExtensionDependencies = Layer.mergeAll(
  PersistentShapingKernelLive,
  ExtensionSandboxLive,
  CapabilityBrokerLive,
);

const ShapingAndExtensionLive = ExtensionExecutionLive.pipe(
  Layer.provideMerge(ExtensionDependencies),
);

export const shapingRuntime = ManagedRuntime.make(ShapingAndExtensionLive);
