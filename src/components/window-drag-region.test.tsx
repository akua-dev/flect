// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowDragRegion } from "./window-drag-region";

afterEach(() => {
  vi.clearAllMocks();
});

describe("WindowDragRegion", () => {
  it("starts the native drag operation on primary pointer press", () => {
    const { container } = render(<WindowDragRegion />);
    const region = container.querySelector(".window-drag-region");
    expect(region).not.toBeNull();
    if (region === null) return;
    const dragRequested = vi.fn();
    globalThis.addEventListener("flect:start-window-drag", dragRequested, {
      once: true,
    });

    fireEvent.pointerDown(region, { button: 0 });

    expect(dragRequested).toHaveBeenCalledOnce();
  });

  it("does not take over a secondary pointer press", () => {
    const { container } = render(<WindowDragRegion />);
    const region = container.querySelector(".window-drag-region");
    expect(region).not.toBeNull();
    if (region === null) return;
    const dragRequested = vi.fn();
    globalThis.addEventListener("flect:start-window-drag", dragRequested, {
      once: true,
    });

    fireEvent.pointerDown(region, { button: 2 });

    expect(dragRequested).not.toHaveBeenCalled();
  });
});
