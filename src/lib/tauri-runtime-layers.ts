import { Layer } from "effect";
import { makeTauriNativePlatformLayer } from "./tauri-native-platform";
import {
  makeTauriFlectClientLayer,
  makeTauriWorkspaceControlTransportLayer,
  TauriBridgeLive,
  TauriNativeHostLive,
} from "./tauri-transport";

export const TauriClientLive = makeTauriFlectClientLayer().pipe(
  Layer.provide(TauriBridgeLive),
);

export const TauriNativePlatformLive = makeTauriNativePlatformLayer().pipe(
  Layer.provide(TauriNativeHostLive),
);

export const TauriControlTransportLive =
  makeTauriWorkspaceControlTransportLayer().pipe(
    Layer.provide(TauriBridgeLive),
  );
