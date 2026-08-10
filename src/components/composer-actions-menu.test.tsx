// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitRepositoryStatus } from "../../shared/git-workspace";
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
  onExportRepository: vi.fn(() => Promise.resolve()),
  onOpenSafeMode: vi.fn(),
  externalExtensionsEnabled: false,
  onToggleExternalExtensions: vi.fn(() => Promise.resolve()),
  ...overrides,
});

describe("ComposerActionsMenu", () => {
  it("exposes implemented protected and extension actions", async () => {
    const user = userEvent.setup();
    render(<ComposerActionsMenu {...props()} />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Undo last change" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Open safe mode" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Enable trusted Pi extensions" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Export source and history" }),
    ).toBeVisible();
  });

  it("exports the complete source repository", async () => {
    const user = userEvent.setup();
    const onExportRepository = vi.fn(() => Promise.resolve());
    render(<ComposerActionsMenu {...props({ onExportRepository })} />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Export source and history" }),
    );

    expect(onExportRepository).toHaveBeenCalledOnce();
  });

  it("opens shared URLs or local archives from the protected actions menu", async () => {
    const user = userEvent.setup();
    const onOpenShareSource = vi.fn();
    const onOpenShareFile = vi.fn();
    const onManageSharedSources = vi.fn();
    const { rerender } = render(
      <ComposerActionsMenu
        {...props({
          onManageSharedSources,
          onOpenShareFile,
          onOpenShareSource,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Review shared source" }),
    );
    expect(onOpenShareSource).toHaveBeenCalledOnce();

    rerender(
      <ComposerActionsMenu
        {...props({ onOpenShareFile, onOpenShareSource })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Open shared file" }),
    );
    expect(onOpenShareFile).toHaveBeenCalledOnce();

    rerender(
      <ComposerActionsMenu
        {...props({
          onManageSharedSources,
          onOpenShareFile,
          onOpenShareSource,
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Manage shared sources" }),
    );
    expect(onManageSharedSources).toHaveBeenCalledOnce();
  });

  it("shows accepted and isolated candidate object IDs", async () => {
    const user = userEvent.setup();
    render(
      <ComposerActionsMenu
        {...props({
          repository: GitRepositoryStatus.make({
            type: "status",
            acceptedCommit: "a".repeat(40),
            lastKnownGoodCommit: "b".repeat(40),
            proposalBranch: "flect/proposal/revision-1",
            proposalCommit: "c".repeat(40),
            dirty: false,
            conflictPaths: [],
          }),
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "External change waiting for activation",
    );
  });

  it("toggles trusted Pi extensions for the active role", async () => {
    const user = userEvent.setup();
    const onToggleExternalExtensions = vi.fn(() => Promise.resolve());
    render(<ComposerActionsMenu {...props({ onToggleExternalExtensions })} />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Enable trusted Pi extensions" }),
    );

    expect(onToggleExternalExtensions).toHaveBeenCalledOnce();
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
      screen.getByRole("menuitem", { name: "Undo last change" }),
    ).toBeDisabled();

    rerender(
      <ComposerActionsMenu
        {...props({ onRollback, rollbackAvailable: true })}
      />,
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Undo last change" }),
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

  it("dismisses from the modal backdrop and restores the trigger", async () => {
    const user = userEvent.setup();
    render(<ComposerActionsMenu {...props()} />);

    const trigger = screen.getByRole("button", { name: "Actions" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Flect actions" });
    expect(dialog).toHaveAttribute("open");
    fireEvent.pointerDown(dialog);

    expect(
      screen.queryByRole("menu", { name: "Flect actions" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
