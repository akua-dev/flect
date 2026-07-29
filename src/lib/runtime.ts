import { BrowserHttpClient } from "@effect/platform-browser";
import { Layer, ManagedRuntime } from "effect";
import { type FlectClient, makeFlectClientLayer } from "./api";
import { type InterfaceStorage, InterfaceStorageLive } from "./interface-store";

const ClientLive = makeFlectClientLayer().pipe(
  Layer.provide(BrowserHttpClient.layerFetch),
);

const BrowserLive = Layer.merge(ClientLive, InterfaceStorageLive);

export type FlectBrowserServices = FlectClient | InterfaceStorage;
export type FlectBrowserRuntime = ManagedRuntime.ManagedRuntime<
  FlectBrowserServices,
  never
>;

export const browserRuntime: FlectBrowserRuntime =
  ManagedRuntime.make(BrowserLive);
