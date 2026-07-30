// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSummary } from "../../shared/contracts";
import { ModelMenu } from "./model-menu";

afterEach(cleanup);

const model = new ModelSummary({
  provider: "openai-codex",
  id: "gpt-5.6",
  name: "GPT-5.6",
});

describe("ModelMenu", () => {
  it("selects an authenticated Pi model from the popover", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelMenu
        disabled={false}
        models={[model]}
        onSelect={onSelect}
        selectedModel={undefined}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Model: Auto via Pi" }),
    );
    await user.click(
      screen.getByRole("menuitemradio", { name: "GPT-5.6 by openai-codex" }),
    );

    expect(onSelect).toHaveBeenCalledWith(model);
  });

  it("returns to automatic Pi model selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelMenu
        disabled={false}
        models={[model]}
        onSelect={onSelect}
        selectedModel={model}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Model: GPT-5.6" }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "Auto via Pi" }),
    );

    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it("marks the current selection and exposes provider detail", async () => {
    const user = userEvent.setup();
    render(
      <ModelMenu
        disabled={false}
        models={[model]}
        onSelect={vi.fn()}
        selectedModel={model}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Model: GPT-5.6" }));

    expect(
      screen.getByRole("menuitemradio", {
        name: "GPT-5.6 by openai-codex",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("openai-codex")).toBeVisible();
  });

  it("explains when Pi has no authenticated models", async () => {
    const user = userEvent.setup();
    render(
      <ModelMenu
        disabled={false}
        models={[]}
        onSelect={vi.fn()}
        selectedModel={undefined}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Model: Auto via Pi" }),
    );

    expect(screen.getByText("No authenticated Pi models")).toBeVisible();
  });

  it("dismisses with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(
      <ModelMenu
        disabled={false}
        models={[model]}
        onSelect={vi.fn()}
        selectedModel={undefined}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Model: Auto via Pi",
    });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("menu", { name: "Choose model" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("cannot open while model changes are disabled", async () => {
    const user = userEvent.setup();
    render(
      <ModelMenu
        disabled
        models={[model]}
        onSelect={vi.fn()}
        selectedModel={undefined}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Model: Auto via Pi",
    });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(
      screen.queryByRole("menu", { name: "Choose model" }),
    ).not.toBeInTheDocument();
  });
});
