import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { makeFlectHttpApp } from "./app";
import { FlectRuntimeLive, PiSdkLive } from "./pi-runtime";

const RuntimeLive = FlectRuntimeLive.pipe(Layer.provide(PiSdkLive));

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
