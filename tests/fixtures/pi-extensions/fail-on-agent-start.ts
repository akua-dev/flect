import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function failOnAgentStart(pi: ExtensionAPI) {
  pi.on("agent_start", () => {
    throw new Error("FLECT_PRIVATE_EXTENSION_FIXTURE_FAILURE");
  });
}
