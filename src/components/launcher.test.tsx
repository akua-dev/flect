// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSummary } from "../../shared/contracts";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../../shared/interface-document";
import { Launcher, type LauncherController } from "./launcher";

afterEach(cleanup);

const model = new ModelSummary({
  provider: "openai-codex",
  id: "gpt-5.6",
  name: "GPT-5.6",
});

function controller(
  overrides: Partial<LauncherController> = {},
): LauncherController {
  return {
    status: "ready",
    models: [model],
    selectedModel: undefined,
    selectModel: vi.fn(),
    messages: [],
    lastPrompt: "",
    error: undefined,
    submit: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe("Launcher", () => {
  it("presents the shaping prompt as the primary empty state", async () => {
    const session = controller();
    const user = userEvent.setup();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={session}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "What should we shape?" }),
    ).toBeVisible();
    const prompt = screen.getByRole("textbox", {
      name: "Describe what to shape",
    });
    expect(prompt).toHaveAttribute(
      "placeholder",
      "Build, change, or connect anything",
    );
    expect(
      screen.getByRole("button", { name: "Shape" }),
    ).toHaveAccessibleDescription("Enter a prompt to enable Shape.");

    await user.type(prompt, "Create a focused project overview");
    await user.keyboard("{Enter}");

    expect(session.submit).toHaveBeenCalledWith(
      "Create a focused project overview",
    );
  });

  it("selects an explicit Pi model", async () => {
    const session = controller();
    const user = userEvent.setup();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={session}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Model" }),
      "openai-codex:gpt-5.6",
    );

    expect(session.selectModel).toHaveBeenCalledWith(model);
  });

  it("turns the primary action into a labelled cancel control while streaming", async () => {
    const session = controller({ status: "streaming" });
    const user = userEvent.setup();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={session}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Stop response" }));
    expect(session.cancel).toHaveBeenCalledOnce();
  });

  it("renders fenced response code as inert, readable code", () => {
    const session = controller({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "A small example:\n\n```ts\nconst shaped = true;\n```",
        },
      ],
    });
    const { container } = render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={session}
      />,
    );

    expect(screen.getByText("A small example:")).toBeVisible();
    expect(container.querySelector("code")).toHaveTextContent(
      "const shaped = true;",
    );
    expect(container).not.toHaveTextContent("```");
  });

  it("gives an unavailable runtime a direct recovery action", async () => {
    const session = controller({
      status: "unavailable",
      models: [],
      error: "Start the local Flect runtime to continue.",
    });
    const user = userEvent.setup();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={session}
      />,
    );

    expect(screen.getByText("Local runtime offline")).toBeVisible();
    expect(
      screen.getByText("Start the local Flect runtime to continue."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(session.refresh).toHaveBeenCalledOnce();
  });

  it("identifies the protected shell and uses safe default copy", () => {
    const unsafeDocument = new InterfaceDocument({
      version: 1,
      headline: "Customized",
      placeholder: "Customized prompt",
      secondaryActions: [],
    });
    render(
      <Launcher
        document={
          unsafeDocument === defaultInterfaceDocument
            ? unsafeDocument
            : defaultInterfaceDocument
        }
        safeMode
        session={controller()}
      />,
    );

    expect(screen.getByText("Safe mode")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "What should we shape?" }),
    ).toBeVisible();
  });
});
