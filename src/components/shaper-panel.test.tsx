// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShaperPanel } from "./shaper-panel";

afterEach(cleanup);

describe("ShaperPanel", () => {
  it("submits an instruction and exposes explicit preview decisions", async () => {
    const user = userEvent.setup();
    const request = vi.fn(() => Promise.resolve());
    const accept = vi.fn(() => Promise.resolve());
    const controller = {
      status: "idle" as const,
      isolation: "ready" as const,
      verifyIsolation: () => Promise.resolve(),
      request,
      accept,
      reject: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
    const { rerender } = render(
      <ShaperPanel
        controller={controller}
        agentStatus="ready"
        onClose={() => undefined}
      />,
    );

    await user.type(
      screen.getByLabelText("Describe the interface change"),
      "Make the workspace more focused",
    );
    await user.click(screen.getByRole("button", { name: "Propose change" }));
    rerender(
      <ShaperPanel
        controller={{ ...controller, status: "preview" }}
        agentStatus="ready"
        onClose={() => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Keep change" }));

    expect(request).toHaveBeenCalledWith("Make the workspace more focused");
    expect(accept).toHaveBeenCalledOnce();
    expect(
      screen.getByText("Previewing a validated proposal"),
    ).toBeInTheDocument();
  });

  it("does not replace a proposal while its preview awaits a decision", async () => {
    const user = userEvent.setup();
    const request = vi.fn(() => Promise.resolve());
    render(
      <ShaperPanel
        controller={{
          status: "preview",
          isolation: "ready",
          verifyIsolation: () => Promise.resolve(),
          request,
          accept: () => Promise.resolve(),
          reject: () => Promise.resolve(),
          rollback: () => Promise.resolve(),
        }}
        agentStatus="ready"
        onClose={() => undefined}
      />,
    );

    expect(
      screen.getByLabelText("Describe the interface change"),
    ).toBeDisabled();
    const propose = screen.getByRole("button", { name: "Propose change" });
    expect(propose).toBeDisabled();
    await user.click(propose);
    expect(request).not.toHaveBeenCalled();
  });

  it("hides rollback in the explicit read-only safe launcher", () => {
    render(
      <ShaperPanel
        controller={{
          status: "idle",
          isolation: "ready",
          rollbackAvailable: false,
          verifyIsolation: () => Promise.resolve(),
          request: () => Promise.resolve(),
          accept: () => Promise.resolve(),
          reject: () => Promise.resolve(),
          rollback: () => Promise.resolve(),
        }}
        agentStatus="ready"
        onClose={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Roll back last change" }),
    ).not.toBeInTheDocument();
  });

  it("restores focus to the instruction after a preview decision", async () => {
    const user = userEvent.setup();
    const controller = {
      status: "preview" as const,
      isolation: "ready" as const,
      verifyIsolation: () => Promise.resolve(),
      request: () => Promise.resolve(),
      accept: () => Promise.resolve(),
      reject: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
    const { container, rerender } = render(
      <ShaperPanel
        agentStatus="ready"
        controller={controller}
        onClose={() => undefined}
      />,
    );

    await user.click(within(container).getByRole("button", { name: "Reject" }));
    rerender(
      <ShaperPanel
        agentStatus="ready"
        controller={{ ...controller, status: "shaping" }}
        onClose={() => undefined}
      />,
    );
    rerender(
      <ShaperPanel
        agentStatus="ready"
        controller={{ ...controller, status: "idle" }}
        onClose={() => undefined}
      />,
    );

    expect(
      within(container).getByLabelText("Describe the interface change"),
    ).toHaveFocus();
  });

  it("prevents shaping and rollback while a prompt is active", async () => {
    const user = userEvent.setup();
    const request = vi.fn(() => Promise.resolve());
    const rollback = vi.fn(() => Promise.resolve());
    render(
      <ShaperPanel
        agentStatus="streaming"
        controller={{
          status: "idle",
          isolation: "ready",
          verifyIsolation: () => Promise.resolve(),
          request,
          accept: () => Promise.resolve(),
          reject: () => Promise.resolve(),
          rollback,
        }}
        onClose={() => undefined}
      />,
    );

    const instruction = screen.getByLabelText("Describe the interface change");
    expect(instruction).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Propose change" }),
    ).toBeDisabled();
    const rollbackButton = screen.getByRole("button", {
      name: "Roll back last change",
    });
    expect(rollbackButton).toBeDisabled();

    await user.click(rollbackButton);

    expect(request).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("prevents rollback while a proposal is running", () => {
    const rollback = vi.fn(() => Promise.resolve());
    render(
      <ShaperPanel
        agentStatus="ready"
        controller={{
          status: "shaping",
          isolation: "ready",
          verifyIsolation: () => Promise.resolve(),
          request: () => Promise.resolve(),
          accept: () => Promise.resolve(),
          reject: () => Promise.resolve(),
          rollback,
        }}
        onClose={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Roll back last change" }),
    ).toBeDisabled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("prevents preview decisions while a prompt is active", async () => {
    const user = userEvent.setup();
    const accept = vi.fn(() => Promise.resolve());
    const reject = vi.fn(() => Promise.resolve());
    render(
      <ShaperPanel
        agentStatus="streaming"
        controller={{
          status: "preview",
          isolation: "ready",
          verifyIsolation: () => Promise.resolve(),
          request: () => Promise.resolve(),
          accept,
          reject,
          rollback: () => Promise.resolve(),
        }}
        onClose={() => undefined}
      />,
    );

    const keepButton = screen.getByRole("button", { name: "Keep change" });
    const rejectButton = screen.getByRole("button", { name: "Reject" });
    expect(keepButton).toBeDisabled();
    expect(rejectButton).toBeDisabled();

    await user.click(keepButton);
    await user.click(rejectButton);

    expect(accept).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });
});
