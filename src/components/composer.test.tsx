// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSummary } from "../../shared/contracts";
import type { AgentSessionStatus } from "../hooks/use-agent-session";
import { Composer, type ComposerProps } from "./composer";

afterEach(cleanup);

const model = new ModelSummary({
  provider: "openai-codex",
  id: "gpt-5.6",
  name: "GPT-5.6",
  reasoningLevels: ["off", "low", "medium", "high", "xhigh"],
});

const props = (overrides: Partial<ComposerProps> = {}): ComposerProps => ({
  mode: "edit",
  placeholder: "Build, change, or connect anything",
  disabled: false,
  status: "ready",
  models: [model],
  selectedModel: undefined,
  modelFavorites: [],
  rollbackAvailable: false,
  onSelectModel: vi.fn(),
  onToggleModelFavorite: vi.fn(() => Promise.resolve()),
  onSubmit: vi.fn(() => Promise.resolve()),
  onCancel: vi.fn(() => Promise.resolve()),
  onRollback: vi.fn(() => Promise.resolve()),
  onExportRepository: vi.fn(() => Promise.resolve()),
  onOpenSafeMode: vi.fn(),
  externalExtensionsEnabled: false,
  onToggleExternalExtensions: vi.fn(() => Promise.resolve()),
  ...overrides,
});

describe("Composer", () => {
  it("sends with Enter but preserves Shift Enter and IME composition", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<Composer {...props({ onSubmit })} />);
    const input = screen.getByRole("textbox", { name: "Message Flect" });

    await user.type(input, "First line{Shift>}{Enter}{/Shift}Second line");
    expect(input).toHaveValue("First line\nSecond line");

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.compositionEnd(input);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("First line\nSecond line");
    expect(input).toHaveValue("");
  });

  it("keeps one draft while internal routing changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer {...props()} />);
    await user.type(
      screen.getByRole("textbox", { name: "Message Flect" }),
      "Continuous draft",
    );

    rerender(<Composer {...props({ mode: "run" })} />);
    expect(screen.getByRole("textbox", { name: "Message Flect" })).toHaveValue(
      "Continuous draft",
    );
    expect(
      screen.queryByRole("button", { name: /App Agent|Shaper/ }),
    ).not.toBeInTheDocument();
  });

  it("hydrates the single private draft and reports it as accepted continuity", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn(() => Promise.resolve());
    render(
      <Composer
        {...props({
          drafts: {
            acceptedUse: "Saved Flect message",
            candidateUse: "Legacy candidate draft",
            shape: "Legacy shape draft",
          },
          onDraftChange,
        })}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Message Flect" });
    expect(input).toHaveValue("Saved Flect message");
    await user.type(input, " now");
    expect(onDraftChange).toHaveBeenLastCalledWith(
      "acceptedUse",
      "Saved Flect message now",
    );
  });

  it("grows with the draft and scrolls only after the height bound", () => {
    render(<Composer {...props()} />);
    const input = screen.getByRole("textbox", { name: "Message Flect" });

    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      value: 96,
    });
    fireEvent.change(input, { target: { value: "Two\nlines" } });
    expect(input).toHaveStyle({ height: "96px", overflowY: "hidden" });

    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      value: 240,
    });
    fireEvent.change(input, {
      target: { value: "One\nTwo\nThree\nFour\nFive\nSix\nSeven" },
    });
    expect(input).toHaveStyle({ height: "168px", overflowY: "auto" });
  });

  it("exposes implemented protected actions without placeholder controls", async () => {
    const user = userEvent.setup();
    render(<Composer {...props()} />);

    expect(
      screen.queryByRole("button", { name: /voice|add context|capabilities/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Open safe mode" }),
    ).toBeVisible();
  });

  it("disables empty submission with a direct accessible reason", () => {
    render(<Composer {...props()} />);

    const send = screen.getByRole("button", { name: "Send to Flect" });
    expect(send).toHaveAccessibleDescription("Enter a message to enable Send.");
    expect(send).toBeDisabled();
  });

  it.each<readonly [AgentSessionStatus, string]>([
    ["booting", "Connecting to the local runtime."],
    ["unavailable", "Start the local runtime before sending."],
    ["setup-required", "Sign in to a Pi provider before sending."],
    ["cancelling", "Stopping the current response."],
  ])(
    "describes the %s state without exposing a false action",
    (status, help) => {
      render(<Composer {...props({ status })} />);
      const action =
        status === "cancelling"
          ? screen.getByRole("button", { name: "Stop Flect" })
          : screen.getByRole("button", { name: "Send to Flect" });
      expect(action).toHaveAccessibleDescription(help);
    },
  );

  it("keeps the first message editable while provider setup blocks sending", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn(() => Promise.resolve());
    render(
      <Composer {...props({ status: "setup-required", onDraftChange })} />,
    );

    const input = screen.getByRole("textbox", { name: "Message Flect" });
    await user.type(input, "Build my first interface");

    expect(input).toBeEnabled();
    expect(input).toHaveValue("Build my first interface");
    expect(onDraftChange).toHaveBeenLastCalledWith(
      "acceptedUse",
      "Build my first interface",
    );
    expect(
      screen.getByRole("button", { name: "Send to Flect" }),
    ).toBeDisabled();
  });

  it("turns the primary action into a single Flect stop control", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn(() => Promise.resolve());
    render(<Composer {...props({ status: "streaming", onCancel })} />);

    await user.click(screen.getByRole("button", { name: "Stop Flect" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Send to Flect" }),
    ).not.toBeInTheDocument();
  });

  it("disables protected actions and exposes no role switching while active", () => {
    render(
      <Composer
        {...props({
          status: "streaming",
          rollbackAvailable: true,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Actions" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /App Agent|Shaper/ }),
    ).not.toBeInTheDocument();
  });

  it("locks protected actions synchronously while submission starts", async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Composer {...props({ onSubmit, rollbackAvailable: true })} />);

    await user.type(
      screen.getByRole("textbox", { name: "Message Flect" }),
      "Change the interface",
    );
    await user.click(screen.getByRole("button", { name: "Send to Flect" }));

    expect(screen.getByRole("button", { name: "Actions" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Send to Flect" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Send to Flect" }),
    ).toHaveAccessibleDescription("Sending the message to Flect.");

    await act(async () => finish?.());
    expect(screen.getByRole("button", { name: "Actions" })).toBeEnabled();
  });
});
