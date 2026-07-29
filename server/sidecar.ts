import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import { FlectRpcs } from "../shared/rpc";
import { BunCompiledStdioLive } from "./compiled-stdio";
import { FlectRuntimeLive, PiSdkLive } from "./pi-runtime";
import { makeFlectRpcHandlers } from "./rpc-handlers";

registerBunOAuthFlows();

const RuntimeLive = FlectRuntimeLive.pipe(Layer.provide(PiSdkLive));

const SidecarLive = RpcServer.layer(FlectRpcs).pipe(
  Layer.provide(makeFlectRpcHandlers()),
  Layer.provide(RuntimeLive),
  Layer.provide(RpcServer.layerProtocolStdio),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(BunCompiledStdioLive),
);

BunRuntime.runMain(Layer.launch(SidecarLive));
