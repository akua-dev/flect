import { lazy, Suspense } from "react";
import type { ToolActivity } from "../../shared/control";
import type {
  AgentWorkspaceController,
  ConversationMessage,
} from "../hooks/use-agent-session";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import {
  MessageContent as AIMessageContent,
  Message,
} from "./ai-elements/message";

const ActivityCard = lazy(() =>
  import("./activity-card").then((module) => ({
    default: module.ActivityCard,
  })),
);
const MessageContent = lazy(() =>
  import("./message-content").then((module) => ({
    default: module.MessageContent,
  })),
);
const StreamingReasoning = lazy(() =>
  import("./streaming-reasoning").then((module) => ({
    default: module.StreamingReasoning,
  })),
);

const SurfaceFallback = ({ label }: { readonly label: string }) => (
  <span className="sr-only" role="status">
    {label}
  </span>
);

export function ConversationTimeline({
  messages,
  activities,
  status,
  label,
  onFixFailure,
}: {
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly activities: NonNullable<
    AgentWorkspaceController["app"]["activities"]
  >;
  readonly status: AgentWorkspaceController["app"]["status"];
  readonly label: string;
  readonly onFixFailure?: (activity: ToolActivity) => void;
}) {
  return (
    <Conversation
      aria-label={`${label} conversation`}
      className="conversation conversation-shell"
    >
      <ConversationContent
        className="conversation__content"
        scrollClassName="conversation__scroll"
      >
        {messages.map((message, index) => {
          const isLatest = index === messages.length - 1;
          return (
            <Message
              className={`message message--${message.role}`}
              from={message.role === "user" ? "user" : "assistant"}
              key={message.id}
            >
              <AIMessageContent>
                <span className="sr-only">
                  {message.role === "user"
                    ? "You"
                    : message.role === "activity"
                      ? "Activity"
                      : label}
                </span>
                {message.content ? (
                  <Suspense fallback={<span>{message.content}</span>}>
                    <MessageContent
                      content={message.content}
                      messageRole={message.role}
                      streaming={
                        message.role === "assistant" &&
                        isLatest &&
                        status === "streaming"
                      }
                    />
                  </Suspense>
                ) : (
                  isLatest &&
                  (status === "submitting" || status === "streaming") && (
                    <Suspense
                      fallback={<span>{`${label} is responding`}</span>}
                    >
                      <StreamingReasoning label={label} />
                    </Suspense>
                  )
                )}
              </AIMessageContent>
            </Message>
          );
        })}
        {activities.map((activity) => (
          <div key={activity.id}>
            <Suspense
              fallback={<SurfaceFallback label="Opening activity details" />}
            >
              <ActivityCard
                activity={activity}
                {...(onFixFailure === undefined
                  ? {}
                  : { onFixInShape: onFixFailure })}
              />
            </Suspense>
          </div>
        ))}
      </ConversationContent>
      <ConversationScrollButton aria-label="Jump to latest" />
    </Conversation>
  );
}
