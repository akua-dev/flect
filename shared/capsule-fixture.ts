import { Effect } from "effect";
import { encodeCapsule } from "./capsule";

export const capsuleHostFixture = encodeCapsule({
  manifest: {
    formatVersion: 1,
    id: "dev.akua.host-contract",
    name: "Host contract",
    version: "1.0.0",
    entrypoints: [{ id: "main", path: "ui/index.html" }],
    capabilities: [],
    compatibility: {
      flect: ">=0.2.0 <1.0.0",
      schemaVersion: 1,
      platforms: ["browser", "macos"],
    },
    provenance: {
      publisher: "akua-dev",
      source: "https://github.com/akua-dev/flect",
      revision: "fixture",
      builder: "test",
    },
    signatures: [],
  },
  files: [
    {
      path: "ui/index.html",
      contents: new TextEncoder().encode("<!doctype html><title>Flect</title>"),
    },
  ],
}).pipe(Effect.orDie);
