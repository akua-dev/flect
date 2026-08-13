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

type TimelineEntry =
  | {
      readonly kind: "message";
      readonly message: ConversationMessage;
      readonly timestamp: number | undefined;
    }
  | {
      readonly activities: NonNullable<
        AgentWorkspaceController["app"]["activities"]
      >;
      readonly kind: "activities";
      readonly timestamp: number;
    };

const timelineEntries = (
  messages: ReadonlyArray<ConversationMessage>,
  activities: NonNullable<AgentWorkspaceController["app"]["activities"]>,
): ReadonlyArray<TimelineEntry> => {
  const ordered = [
    ...messages.map((message, sequence) => ({
      kind: "message" as const,
      message,
      sequence,
      timestamp: message.createdAt,
    })),
    ...activities.map((activity, sequence) => ({
      activity,
      kind: "activity" as const,
      sequence: messages.length + sequence,
      timestamp: activity.startedAt,
    })),
  ].sort((left, right) =>
    left.timestamp === undefined || right.timestamp === undefined
      ? left.sequence - right.sequence
      : left.timestamp - right.timestamp || left.sequence - right.sequence,
  );

  return ordered.reduce<Array<TimelineEntry>>((entries, entry) => {
    if (entry.kind === "message") {
      entries.push({
        kind: "message",
        message: entry.message,
        timestamp: entry.timestamp,
      });
      return entries;
    }
    const previous = entries.at(-1);
    if (previous?.kind === "activities") {
      entries[entries.length - 1] = {
        ...previous,
        activities: [...previous.activities, entry.activity],
      };
      return entries;
    }
    entries.push({
      activities: [entry.activity],
      kind: "activities",
      timestamp: entry.timestamp,
    });
    return entries;
  }, []);
};

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
  const entries = timelineEntries(messages, activities);
  const latestMessageId = messages.at(-1)?.id;
  return (
    <Conversation
      aria-label={`${label} conversation`}
      className="conversation conversation-shell"
    >
      <ConversationContent
        className="conversation__content"
        scrollClassName="conversation__scroll"
      >
        {entries.map((entry) => {
          if (entry.kind === "activities") {
            const running = entry.activities.some(
              (activity) =>
                activity.phase === "queued" || activity.phase === "running",
            );
            const failed = entry.activities.some(
              (activity) => activity.phase === "failed",
            );
            const needsAttention = failed && status === "error";
            const count = entry.activities.length;
            return (
              <section
                aria-label={`${count} tool ${count === 1 ? "call" : "calls"}`}
                className={`work-log${needsAttention ? " work-log--failed" : ""}`}
                key={`activities-${entry.activities[0].id}`}
              >
                <div className="work-log__header">
                  <span aria-hidden="true" className="work-log__mark" />
                  <strong>
                    {running
                      ? "Working"
                      : needsAttention
                        ? "Needs attention"
                        : "Worked"}
                  </strong>
                  <span>{`${count} ${count === 1 ? "tool" : "tools"}`}</span>
                </div>
                <div className="work-log__entries">
                  {entry.activities.map((activity) => (
                    <Suspense
                      fallback={
                        <SurfaceFallback label="Opening activity details" />
                      }
                      key={activity.id}
                    >
                      <ActivityCard
                        activity={activity}
                        {...(onFixFailure === undefined
                          ? {}
                          : { onFixInShape: onFixFailure })}
                      />
                    </Suspense>
                  ))}
                </div>
              </section>
            );
          }
          const { message } = entry;
          const isLatest = message.id === latestMessageId;
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
      </ConversationContent>
      <ConversationScrollButton aria-label="Jump to latest" />
    </Conversation>
  );
}
