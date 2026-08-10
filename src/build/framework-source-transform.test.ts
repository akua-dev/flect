import { describe, expect, it } from "vitest";
import { transformFrameworkSource } from "./framework-source-transform";

const encode = (source: string) => new TextEncoder().encode(source);

describe("framework source transform", () => {
  it("compiles a Vue SFC into an ordinary browser module and CSS", async () => {
    const transformed = await transformFrameworkSource(
      "src/App.vue",
      encode(`<script setup lang="ts">
import { ref } from "vue";
const count = ref(0);
</script>
<template><button @click="count += 1">Vue count {{ count }}</button></template>
<style scoped>button { color: rgb(20, 30, 40); }</style>`),
    );

    expect(transformed?.code).toContain('from "vue"');
    expect(transformed?.code).toContain("__flect_component__.render = render");
    expect(transformed?.code).toContain("export default __flect_component__");
    expect(transformed?.css).toContain("rgb(20, 30, 40)");
  });

  it("compiles a Svelte component with its CSS injected on demand", async () => {
    const transformed = await transformFrameworkSource(
      "src/App.svelte",
      encode(`<script>let count = 0;</script>
<button onclick={() => count += 1}>Svelte count {count}</button>
<style>button { color: rgb(40, 30, 20); }</style>`),
    );

    expect(transformed?.code).toContain("svelte/internal/client");
    expect(transformed?.code).toContain("rgb(40, 30, 20)");
    expect(transformed?.css).toBe("");
  });

  it("rejects non-portable Vue style preprocessors explicitly", async () => {
    await expect(
      transformFrameworkSource(
        "src/App.vue",
        encode(
          `<template><main>App</main></template><style lang="scss">main { color: red; }</style>`,
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "FrameworkSourceTransformFailure",
      message: expect.stringContaining("portable CSS"),
    });
  });
});
