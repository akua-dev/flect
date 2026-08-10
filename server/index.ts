import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { makeFlectHttpApp } from "./app";
import { FlectRuntimeWithPiLive } from "./pi-services";
import { FlectTestRuntimeLive } from "./test-runtime";

registerBunOAuthFlows();

const RuntimeLive =
  process.env.FLECT_TEST_MODE === "1"
    ? FlectTestRuntimeLive
    : FlectRuntimeWithPiLive;

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
