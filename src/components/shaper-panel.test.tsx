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
    render(
      <ShaperPanel
        controller={{
          status: "preview",
          isolation: "ready",
          verifyIsolation: () => Promise.resolve(),
          request,
          accept,
          reject: () => Promise.resolve(),
          rollback: () => Promise.resolve(),
        }}
        onClose={() => undefined}
      />,
    );

    await user.type(
      screen.getByLabelText("Describe the interface change"),
      "Make the workspace more focused",
    );
    await user.click(screen.getByRole("button", { name: "Propose change" }));
    await user.click(screen.getByRole("button", { name: "Keep change" }));

    expect(request).toHaveBeenCalledWith("Make the workspace more focused");
    expect(accept).toHaveBeenCalledOnce();
    expect(
      screen.getByText("Previewing a validated proposal"),
    ).toBeInTheDocument();
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
      <ShaperPanel controller={controller} onClose={() => undefined} />,
    );

    await user.click(
      within(container).getByRole("button", { name: "Keep change" }),
    );
    rerender(
      <ShaperPanel
        controller={{ ...controller, status: "idle" }}
        onClose={() => undefined}
      />,
    );

    expect(
      within(container).getByLabelText("Describe the interface change"),
    ).toHaveFocus();
  });
});
