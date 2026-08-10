import { assert, describe, it } from "@effect/vitest";
import {
  collectRestrictedCss,
  resolveRestrictedCssImport,
} from "./restricted-css";

const encoder = new TextEncoder();

describe("restricted CSS build adapter", () => {
  it("resolves only local mirrored CSS imports", () => {
    const root = "/flect/build-test";
    const files = new Set([
      `${root}/src/main.tsx`,
      `${root}/src/styles/theme.css`,
    ]);

    assert.strictEqual(
      resolveRestrictedCssImport(
        "./styles/theme.css",
        `${root}/src/main.tsx`,
        root,
        files,
      ),
      `${root}/src/styles/theme.css`,
    );
    assert.isUndefined(
      resolveRestrictedCssImport(
        "https://example.com/theme.css",
        `${root}/src/main.tsx`,
        root,
        files,
      ),
    );
    assert.isUndefined(
      resolveRestrictedCssImport(
        "../../../outside.css",
        `${root}/src/main.tsx`,
        root,
        files,
      ),
    );
  });

  it("emits deterministic UTF-8 CSS from mirrored inputs", () => {
    assert.strictEqual(
      new TextDecoder().decode(
        collectRestrictedCss([
          { path: "src/z.css", contents: encoder.encode(".z {}") },
          { path: "src/a.css", contents: encoder.encode(".a {}") },
          { path: "src/main.tsx", contents: encoder.encode("export {}") },
        ]),
      ),
      "/* src/a.css */\n.a {}\n/* src/z.css */\n.z {}\n",
    );
  });
});
