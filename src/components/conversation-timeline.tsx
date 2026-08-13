import { ChevronDownIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
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

const formatWorkDuration = (durationMs: number | undefined) => {
  if (durationMs === undefined) return undefined;
  if (durationMs < 1_000) return `${durationMs} ms`;
  const seconds = durationMs / 1_000;
  return `${seconds < 10 ? seconds.toFixed(1).replace(/\.0$/, "") : Math.round(seconds)} s`;
};

function WorkLog({
  activities,
  needsAttention,
  onFixFailure,
}: {
  readonly activities: NonNullable<
    AgentWorkspaceController["app"]["activities"]
  >;
  readonly needsAttention: boolean;
  readonly onFixFailure?: (activity: ToolActivity) => void;
}) {
  const running = activities.some(
    (activity) => activity.phase === "queued" || activity.phase === "running",
  );
  const [expanded, setExpanded] = useState(needsAttention);
  useEffect(() => {
    if (needsAttention) setExpanded(true);
  }, [needsAttention]);
  const count = activities.length;
  const duration = formatWorkDuration(
    activities.every((activity) => activity.durationMs !== undefined)
      ? activities.reduce(
          (total, activity) => total + (activity.durationMs ?? 0),
          0,
        )
      : undefined,
  );
  const stateLabel = running
    ? "Working"
    : needsAttention
      ? "Needs attention"
      : duration === undefined
        ? "Worked"
        : `Worked for ${duration}`;
  const action = expanded ? "Hide" : "Show";
  const state = running ? "active" : needsAttention ? "failed" : "complete";

  return (
    <section
      aria-label={`${count} tool ${count === 1 ? "call" : "calls"}`}
      className={`work-log work-log--${state}`}
    >
      <button
        aria-expanded={expanded}
        aria-label={`${action} ${count} ${running ? "active" : "completed"} ${count === 1 ? "step" : "steps"}`}
        className="work-log__summary"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="work-log__mark" />
        <strong>{stateLabel}</strong>
        <span>{`${count} ${count === 1 ? "step" : "steps"}`}</span>
        <ChevronDownIcon aria-hidden="true" />
      </button>
      <div className="work-log__entries" hidden={!expanded}>
        {activities.map((activity) => (
          <Suspense
            fallback={<SurfaceFallback label="Opening activity details" />}
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
            const failed = entry.activities.some(
              (activity) => activity.phase === "failed",
            );
            const needsAttention = failed && status === "error";
            return (
              <WorkLog
                activities={entry.activities}
                key={`activities-${entry.activities[0].id}`}
                needsAttention={needsAttention}
                {...(onFixFailure === undefined ? {} : { onFixFailure })}
              />
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
