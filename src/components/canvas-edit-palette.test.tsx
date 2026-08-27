// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSelectionRect } from "../../shared/canvas-selection";
import {
  CanvasEditPalette,
  placeCanvasEditPalette,
} from "./canvas-edit-palette";

afterEach(cleanup);

describe("CanvasEditPalette", () => {
  it("places editing controls below a target when the viewport has room", () => {
    expect(
      placeCanvasEditPalette(
        CanvasSelectionRect.make({ x: 300, y: 80, width: 200, height: 60 }),
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 190, top: 148, placement: "below" });
  });

  it("moves above and clamps within the viewport near an edge", () => {
    expect(
      placeCanvasEditPalette(
        CanvasSelectionRect.make({ x: 760, y: 560, width: 32, height: 24 }),
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 368, top: 510, placement: "above" });
  });

  it("exposes compact semantic actions and one clear action", async () => {
    const onAction = vi.fn();
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(
      <CanvasEditPalette
        label="Project heading"
        onAction={onAction}
        onClear={onClear}
        rect={CanvasSelectionRect.make({
          x: 40,
          y: 40,
          width: 180,
          height: 52,
        })}
        viewport={{ width: 800, height: 600 }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Move later" }));
    await user.click(
      screen.getByRole("button", { name: "Clear canvas selection" }),
    );

    expect(onAction).toHaveBeenCalledWith("move-later");
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("toolbar", { name: "Edit Project heading" }),
    ).toHaveAttribute("data-placement", "below");
  });
});
