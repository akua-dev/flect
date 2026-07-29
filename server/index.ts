import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { makeFlectHttpApp } from "./app";
import { FlectRuntimeLive, PiSdkLive } from "./pi-runtime";
import { FlectTestRuntimeLive } from "./test-runtime";

registerBunOAuthFlows();

const RuntimeLive =
  process.env.FLECT_TEST_MODE === "1"
    ? FlectTestRuntimeLive
    : FlectRuntimeLive.pipe(Layer.provide(PiSdkLive));

const ApplicationLive = makeFlectHttpApp().pipe(
  HttpRouter.provideRequest(RuntimeLive),
);

const ServerLive = HttpRouter.serve(ApplicationLive).pipe(
  Layer.provide(
    BunHttpServer.layer({
      hostname: "127.0.0.1",
      port: 3210,
    }),
  ),
);

Layer.launch(ServerLive).pipe(BunRuntime.runMain);
