// dev.akua.flect-context
const MAX_CONTEXT_BYTES = 1200;

const boundedContext = async () => {
  const process = Bun.spawn(["flect", "context", "--host", "opencode"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = process.stdout.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;
  while (size < MAX_CONTEXT_BYTES) {
    const next = await reader.read();
    if (next.done) break;
    const remaining = MAX_CONTEXT_BYTES - size;
    const chunk = next.value.subarray(0, remaining);
    chunks.push(chunk);
    size += chunk.byteLength;
    if (chunk.byteLength < next.value.byteLength) {
      truncated = true;
      process.kill();
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const exitCode = await process.exited;
  if (exitCode !== 0 && !truncated) return "";
  const text = new TextDecoder().decode(bytes).trim();
  return truncated ? `${text}\n[bounded by Flect]` : text;
};

const eventValue = (envelope) => envelope?.event ?? envelope;
const eventSession = (event) =>
  event?.sessionID ?? event?.properties?.sessionID ?? event?.data?.sessionID;

export default {
  id: "dev.akua.flect-context",
  setup: async (ctx) => {
    const injected = new Set();
    const controller = new AbortController();
    const eventTask = (async () => {
      try {
        const subscription = await ctx.event.subscribe({
          signal: controller.signal,
        });
        const stream = subscription?.stream ?? subscription;
        for await (const envelope of stream) {
          const event = eventValue(envelope);
          if (event?.type === "session.compacted") {
            const sessionID = eventSession(event);
            if (typeof sessionID === "string") injected.delete(sessionID);
          }
        }
      } catch {
        // OpenCode stops or reloads the plugin by aborting the subscription.
      }
    })();

    await ctx.session.hook("request", async (event) => {
      const sessionID = eventSession(event) ?? "default";
      if (injected.has(sessionID)) return;
      injected.add(sessionID);
      const context = await boundedContext();
      if (context.length === 0) {
        injected.delete(sessionID);
        return;
      }
      event.system.push({ type: "text", text: context });
    });

    return async () => {
      controller.abort();
      await eventTask;
    };
  },
};
