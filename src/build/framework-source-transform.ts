import { Schema } from "effect";

const decoder = new TextDecoder("utf-8", { fatal: true });

export class FrameworkSourceTransformFailure extends Schema.TaggedErrorClass<FrameworkSourceTransformFailure>()(
  "FrameworkSourceTransformFailure",
  { message: Schema.String.check(Schema.isMaxLength(500)) },
) {}

const failure = (message: string) =>
  FrameworkSourceTransformFailure.make({ message: message.slice(0, 500) });

const sourceText = (path: string, contents: Uint8Array) => {
  try {
    return decoder.decode(contents);
  } catch {
    throw failure(`${path} is not valid UTF-8 source.`);
  }
};

const vueSource = async (path: string, contents: Uint8Array) => {
  const { compileScript, compileStyle, compileTemplate, parse } = await import(
    "@vue/compiler-sfc"
  );
  const parsed = parse(sourceText(path, contents), { filename: path });
  if (parsed.errors.length > 0) {
    throw failure(`${path} is not a valid Vue component.`);
  }
  const descriptor = parsed.descriptor;
  if (descriptor.template === null) {
    throw failure(`${path} needs one Vue template.`);
  }
  if (descriptor.styles.some((style) => style.src !== undefined)) {
    throw failure(
      `${path} uses an external Vue style source. Import the stylesheet from the project entrypoint instead.`,
    );
  }
  if (descriptor.template.src !== undefined) {
    throw failure(
      `${path} uses an external Vue template source, which is not portable.`,
    );
  }
  const id = `flect-${path.replaceAll(/[^a-z0-9]/gi, "-").slice(0, 120)}`;
  const script =
    descriptor.script === null && descriptor.scriptSetup === null
      ? undefined
      : compileScript(descriptor, { id, genDefaultAs: "__flect_component__" });
  const scoped = descriptor.styles.some((style) => style.scoped);
  const template = compileTemplate({
    id,
    filename: path,
    source: descriptor.template.content,
    scoped,
    compilerOptions: {
      ...(script === undefined ? {} : { bindingMetadata: script.bindings }),
    },
  });
  if (template.errors.length > 0) {
    throw failure(`${path} has an invalid Vue template.`);
  }
  const styles = descriptor.styles.map((style) => {
    if (style.lang !== undefined && style.lang !== "css") {
      throw failure(
        `${path} uses ${style.lang} styles. Flect accepts portable CSS in Vue components.`,
      );
    }
    const compiled = compileStyle({
      id,
      filename: path,
      source: style.content,
      scoped: style.scoped,
    });
    if (compiled.errors.length > 0) {
      throw failure(`${path} has invalid Vue component CSS.`);
    }
    return compiled.code;
  });
  return {
    code: [
      script?.content ?? "const __flect_component__ = {};",
      template.code,
      scoped ? `__flect_component__.__scopeId = "data-v-${id}";` : "",
      "__flect_component__.render = render;",
      "export default __flect_component__;",
    ].join("\n"),
    css: styles.join("\n"),
  };
};

const svelteSource = async (path: string, contents: Uint8Array) => {
  const { compile } = await import("svelte/compiler");
  const compiled = compile(sourceText(path, contents), {
    filename: path,
    generate: "client",
    css: "injected",
    dev: false,
  });
  return { code: compiled.js.code, css: "" };
};

export const transformFrameworkSource = async (
  path: string,
  contents: Uint8Array,
) => {
  try {
    if (path.toLowerCase().endsWith(".vue")) {
      return await vueSource(path, contents);
    }
    if (path.toLowerCase().endsWith(".svelte")) {
      return await svelteSource(path, contents);
    }
    return undefined;
  } catch (error) {
    if (Schema.is(FrameworkSourceTransformFailure)(error)) throw error;
    throw failure(
      `${path} could not be compiled safely: ${error instanceof Error ? error.message : "unknown compiler failure"}`,
    );
  }
};
