import { parse } from "acorn";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";

describe("Vite development browser entry", () => {
  let server: ViteDevServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("serves the React app as a valid JavaScript module", async () => {
    server = await createServer({
      appType: "custom",
      server: { middlewareMode: true },
    });

    const transformed = await server.transformRequest("/src/app.tsx");
    expect(transformed).not.toBeNull();
    if (transformed === null) {
      return;
    }

    expect(() =>
      parse(transformed.code, {
        ecmaVersion: "latest",
        sourceType: "module",
      }),
    ).not.toThrow();
  });
});
