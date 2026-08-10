import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

export const flectIntegration = (): AstroIntegration => ({
  name: "flect:activation",
  hooks: {
    "astro:config:setup": ({ addClientDirective }) => {
      addClientDirective({
        name: "flect",
        entrypoint: fileURLToPath(
          new URL("./flect-client-directive.ts", import.meta.url),
        ),
      });
    },
  },
});
