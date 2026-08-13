// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ConversationMessage,
  ToolActivity,
  UserCommandSource,
} from "../../shared/control";
import { ConversationTimeline } from "./conversation-timeline";

describe("ConversationTimeline", () => {
  it("keeps compact tool work inside the turn that produced it", async () => {
    render(
      <ConversationTimeline
        activities={[
          ToolActivity.make({
            version: 1,
            id: "activity-timeline-read-1",
            callId: "tool-call-timeline-read-1",
            operationId: "operation-timeline-read-1",
            role: "app",
            toolName: "flect",
            phase: "succeeded",
            startedAt: 20,
            updatedAt: 21,
          }),
          ToolActivity.make({
            version: 1,
            id: "activity-timeline-build-1",
            callId: "tool-call-timeline-build-1",
            operationId: "operation-timeline-build-1",
            role: "app",
            toolName: "bash",
            phase: "succeeded",
            startedAt: 22,
            updatedAt: 23,
          }),
        ]}
        label="Flect"
        messages={[
          ConversationMessage.make({
            version: 1,
            id: "message-user",
            role: "user",
            content: "Make it calmer",
            createdAt: 10,
            source: UserCommandSource.make({ kind: "user" }),
          }),
          ConversationMessage.make({
            version: 1,
            id: "message-assistant",
            role: "assistant",
            content: "I softened the interface.",
            createdAt: 30,
            source: UserCommandSource.make({ kind: "user" }),
          }),
        ]}
        status="ready"
        onFixFailure={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("region", { name: "2 tool calls" }),
    ).toBeVisible();
    expect(screen.getByText("Worked")).toBeVisible();
    expect(screen.getByText("2 tools")).toBeVisible();

    const userMessage = screen.getByText("Make it calmer");
    const work = screen.getByRole("region", { name: "2 tool calls" });
    const assistantMessage = screen.getByText("I softened the interface.");
    expect(
      userMessage.compareDocumentPosition(work) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      work.compareDocumentPosition(assistantMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      await screen.findAllByRole("button", { name: /details/i }),
    ).toHaveLength(2);
  });

  it("only asks for attention when the complete turn failed", async () => {
    const activity = ToolActivity.make({
      version: 1,
      id: "activity-timeline-failed-1",
      callId: "tool-call-timeline-failed-1",
      operationId: "operation-timeline-failed-1",
      role: "app",
      toolName: "bash",
      phase: "failed",
      startedAt: 20,
      updatedAt: 21,
    });
    const { rerender } = render(
      <ConversationTimeline
        activities={[activity]}
        label="Flect"
        messages={[]}
        status="ready"
      />,
    );

    const work = await screen.findByRole("region", { name: "1 tool call" });
    expect(within(work).getByText("Worked")).toBeVisible();
    expect(within(work).queryByText("Needs attention")).not.toBeInTheDocument();

    rerender(
      <ConversationTimeline
        activities={[activity]}
        label="Flect"
        messages={[]}
        status="error"
      />,
    );
    expect(within(work).getByText("Needs attention")).toBeVisible();
  });
});
