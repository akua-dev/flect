import { createApp } from "./app";
import { createPiRuntime } from "./pi-runtime";

const runtime = await createPiRuntime();

Bun.serve({
  hostname: "127.0.0.1",
  port: 3210,
  fetch: createApp(runtime),
});

console.info("Flect runtime listening on http://127.0.0.1:3210");
