import { installRiftyCapabilityBoundary } from "./rifty-capability-boundary";

const postMessage = globalThis.postMessage.bind(globalThis);
function forwardPostMessage(
  message: unknown,
  targetOrigin: string,
  transfer?: Transferable[],
): void;
function forwardPostMessage(
  message: unknown,
  options?: WindowPostMessageOptions,
): void;
function forwardPostMessage(message: unknown, transfer: Transferable[]): void;
function forwardPostMessage(
  message: unknown,
  optionsOrTarget?: string | Transferable[] | WindowPostMessageOptions,
  transfer?: Transferable[],
): void {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "ready"
  ) {
    installRiftyCapabilityBoundary();
  }
  if (typeof optionsOrTarget === "string") {
    postMessage(message, optionsOrTarget, transfer);
  } else if (Array.isArray(optionsOrTarget)) {
    postMessage(message, optionsOrTarget);
  } else {
    postMessage(message, optionsOrTarget);
  }
}

globalThis.postMessage = forwardPostMessage;
await import("@riftydev/runtime-js/worker");
