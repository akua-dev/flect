import { Reasoning, ReasoningTrigger } from "./ai-elements/reasoning";

export function StreamingReasoning({ label }: { readonly label: string }) {
  return (
    <Reasoning isStreaming>
      <ReasoningTrigger getThinkingMessage={() => `${label} is responding`} />
    </Reasoning>
  );
}
