// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComposerActionsMenu,
  type ComposerActionsMenuProps,
} from "./composer-actions-menu";

afterEach(cleanup);

const props = (
  overrides: Partial<ComposerActionsMenuProps> = {},
): ComposerActionsMenuProps => ({
  disabled: false,
  rollbackAvailable: true,
  rollbackDisabled: false,
  onRollback: vi.fn(() => Promise.resolve()),
  onOpenSafeMode: vi.fn(),
  ...overrides,
});

describe("ComposerActionsMenu", () => {
  it("exposes only implemented protected actions", async () => {
    const user = userEvent.setup();
    render(<ComposerActionsMenu {...props()} />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Roll back last change" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Open safe mode" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", {
        name: /voice|attach|extensions|shape interface/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("runs rollback only when a prior revision is available", async () => {
    const user = userEvent.setup();
    const onRollback = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <ComposerActionsMenu
        {...props({ onRollback, rollbackAvailable: false })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Roll back last change" }),
    ).toBeDisabled();

    rerender(
      <ComposerActionsMenu
        {...props({ onRollback, rollbackAvailable: true })}
      />,
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Roll back last change" }),
    );

    expect(onRollback).toHaveBeenCalledOnce();
  });

  it("opens the compiled safe launcher", async () => {
    const user = userEvent.setup();
    const onOpenSafeMode = vi.fn();
    render(<ComposerActionsMenu {...props({ onOpenSafeMode })} />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Open safe mode" }));

    expect(onOpenSafeMode).toHaveBeenCalledOnce();
  });

  it("dismisses with Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<ComposerActionsMenu {...props()} />);

    const trigger = screen.getByRole("button", { name: "Actions" });
    await user.click(trigger);
    expect(screen.getByRole("menu", { name: "Flect actions" })).toBeVisible();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("menu", { name: "Flect actions" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("dismisses when focus moves outside the menu", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ComposerActionsMenu {...props()} />
        <button type="button">Outside</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(
      screen.queryByRole("menu", { name: "Flect actions" }),
    ).not.toBeInTheDocument();
  });
});
