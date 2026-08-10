// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  roleSwitchDisabled: false,
  status: "ready",
  models: [model],
  selectedModel: undefined,
  modelFavorites: [],
  rollbackAvailable: false,
  onModeChange: vi.fn(),
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
    const input = screen.getByRole("textbox", { name: "Message Shaper" });

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

  it("retains separate drafts for Shape, accepted Use, and candidate Use", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer {...props()} />);
    await user.type(
      screen.getByRole("textbox", { name: "Message Shaper" }),
      "Edit draft",
    );

    rerender(<Composer {...props({ mode: "run" })} />);
    const appInput = screen.getByRole("textbox", { name: "Message App Agent" });
    expect(appInput).toHaveValue("");
    await user.type(appInput, "Run draft");

    rerender(
      <Composer
        {...props({
          agentLabel: "Preview App Agent",
          conversationKey: "candidate-use",
          mode: "edit",
          target: "use",
        })}
      />,
    );
    const previewInput = screen.getByRole("textbox", {
      name: "Message Preview App Agent",
    });
    expect(previewInput).toHaveValue("");
    await user.type(previewInput, "Candidate draft");

    rerender(<Composer {...props({ mode: "edit" })} />);
    expect(screen.getByRole("textbox", { name: "Message Shaper" })).toHaveValue(
      "Edit draft",
    );
    rerender(<Composer {...props({ mode: "run" })} />);
    expect(
      screen.getByRole("textbox", { name: "Message App Agent" }),
    ).toHaveValue("Run draft");
  });

  it("hydrates private drafts and reports edits through their exact target", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <Composer
        {...props({
          drafts: {
            acceptedUse: "Saved accepted question",
            candidateUse: "Saved candidate test",
            shape: "Saved shape request",
          },
          onDraftChange,
        })}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Message Shaper" })).toHaveValue(
      "Saved shape request",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Message Shaper" }),
      " now",
    );
    expect(onDraftChange).toHaveBeenLastCalledWith(
      "shape",
      "Saved shape request now",
    );

    rerender(
      <Composer
        {...props({
          conversationKey: "candidate-use",
          drafts: {
            acceptedUse: "Saved accepted question",
            candidateUse: "Saved candidate test",
            shape: "Saved shape request now",
          },
          mode: "edit",
          onDraftChange,
          target: "use",
        })}
      />,
    );
    expect(
      screen.getByRole("textbox", { name: "Message App Agent" }),
    ).toHaveValue("Saved candidate test");
  });

  it("grows with the draft and scrolls only after the height bound", () => {
    render(<Composer {...props()} />);
    const input = screen.getByRole("textbox", { name: "Message Shaper" });

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

    const send = screen.getByRole("button", { name: "Send to Shaper" });
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
          ? screen.getByRole("button", { name: "Stop Shaper" })
          : screen.getByRole("button", { name: "Send to Shaper" });
      expect(action).toHaveAccessibleDescription(help);
    },
  );

  it("turns the primary action into a role-aware stop control", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn(() => Promise.resolve());
    render(<Composer {...props({ status: "streaming", onCancel })} />);

    await user.click(screen.getByRole("button", { name: "Stop Shaper" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Send to Shaper" }),
    ).not.toBeInTheDocument();
  });

  it("disables protected actions and role switching while active", () => {
    render(
      <Composer
        {...props({
          status: "streaming",
          rollbackAvailable: true,
          roleSwitchDisabled: true,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Actions" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Use · App Agent" }),
    ).toBeDisabled();
  });
});
