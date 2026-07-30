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
import type { ShapingController } from "./shaper-panel";

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

function shaping(
  overrides: Partial<ShapingController> = {},
): ShapingController {
  return {
    status: "idle",
    isolation: "ready",
    verifyIsolation: vi.fn(() => Promise.resolve()),
    request: vi.fn(() => Promise.resolve()),
    accept: vi.fn(() => Promise.resolve()),
    reject: vi.fn(() => Promise.resolve()),
    rollback: vi.fn(() => Promise.resolve()),
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
        shaping={shaping()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "What should we shape?" }),
    ).toBeVisible();
    const prompt = screen.getByRole("textbox", {
      name: "Message Flect",
    });
    expect(prompt).toHaveAttribute(
      "placeholder",
      "Build, change, or connect anything",
    );
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toHaveAccessibleDescription("Enter a message to enable Send.");

    await user.type(prompt, "Create a focused project overview");
    await user.keyboard("{Enter}");

    expect(session.submit).toHaveBeenCalledWith(
      "Create a focused project overview",
    );
  });

  it("disables the composer while an interface proposal is running", () => {
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={controller()}
        shaping={shaping({ status: "shaping" })}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Message Flect" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("selects an explicit Pi model", async () => {
    const session = controller();
    const user = userEvent.setup();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={session}
        shaping={shaping()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Model: Auto via Pi" }),
    );
    await user.click(
      screen.getByRole("menuitemradio", {
        name: "GPT-5.6 by openai-codex",
      }),
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
        shaping={shaping()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Stop response" }));
    expect(session.cancel).toHaveBeenCalledOnce();
  });

  it("opens the protected Interface Shaper from the composer actions", async () => {
    const user = userEvent.setup();
    const shapingController = shaping();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={controller()}
        shaping={shapingController}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Shape interface" }));

    expect(
      screen.getByRole("complementary", { name: "Interface Shaper" }),
    ).toBeVisible();
    expect(shapingController.verifyIsolation).toHaveBeenCalledOnce();
  });

  it("rolls back through the protected composer actions", async () => {
    const user = userEvent.setup();
    const rollback = vi.fn(() => Promise.resolve());
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={controller()}
        shaping={shaping({ rollback, rollbackAvailable: true })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Roll back last change" }),
    );

    expect(rollback).toHaveBeenCalledOnce();
  });

  it("opens the compiled safe launcher through the composer actions", async () => {
    const user = userEvent.setup();
    const onOpenSafeMode = vi.fn();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        onOpenSafeMode={onOpenSafeMode}
        safeMode={false}
        session={controller()}
        shaping={shaping()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Open safe mode" }));

    expect(onOpenSafeMode).toHaveBeenCalledOnce();
  });

  it("prevents opening a shaping operation while a prompt is streaming", async () => {
    const user = userEvent.setup();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={controller({ status: "streaming" })}
        shaping={shaping()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Shape interface" }));

    expect(
      screen.getByRole("textbox", { name: "Describe the interface change" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Propose change" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Roll back last change" }),
    ).toBeDisabled();
  });

  it("keeps shaping disabled while a prompt cancellation is pending", async () => {
    const user = userEvent.setup();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={controller({ status: "cancelling" })}
        shaping={shaping()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Shape interface" }));

    expect(
      screen.getByRole("button", { name: "Propose change" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Roll back last change" }),
    ).toBeDisabled();
  });

  it("shows cancellation failure feedback without unlocking shaping", async () => {
    const user = userEvent.setup();
    const session = controller({
      status: "cancelling",
      error: "The response could not be stopped. Try again.",
    });
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={session}
        shaping={shaping()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The response could not be stopped. Try again.",
    );
    expect(screen.getByText("Response is still stopping")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(session.cancel).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Shape interface" }));
    expect(
      screen.getByRole("button", { name: "Propose change" }),
    ).toBeDisabled();
  });

  it("does not present a completed empty assistant turn as still responding", () => {
    const session = controller({
      status: "ready",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
        },
      ],
    });

    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={session}
        shaping={shaping()}
      />,
    );

    expect(screen.queryByText("Flect is responding")).not.toBeInTheDocument();
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
        shaping={shaping()}
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
        shaping={shaping()}
      />,
    );

    expect(screen.getByText("Local runtime offline")).toBeVisible();
    expect(
      screen.getByText("Start the local Flect runtime to continue."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(session.refresh).toHaveBeenCalledOnce();
  });

  it("guides Pi setup and disables the composer without authenticated models", async () => {
    const session = controller({
      status: "setup-required",
      models: [],
      error: "Sign in to a Pi provider, then try again.",
    });
    const user = userEvent.setup();
    render(
      <Launcher
        document={defaultInterfaceDocument}
        safeMode={false}
        session={session}
        shaping={shaping()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Pi setup needed");
    expect(
      screen.getByText("Sign in to a Pi provider, then try again."),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Message Flect" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(session.refresh).toHaveBeenCalledOnce();
  });

  it("identifies the protected shell and uses safe default copy", () => {
    const unsafeDocument = InterfaceDocument.make({
      version: 2,
      name: "Customized",
      root: {
        id: "custom-root",
        type: "stack",
        direction: "column",
        gap: "md",
        children: [
          {
            id: "custom-headline",
            type: "text",
            text: "Customized",
            style: "headline",
          },
          {
            id: "custom-prompt",
            type: "prompt",
            placeholder: "Customized prompt",
          },
        ],
      },
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
        shaping={shaping()}
      />,
    );

    expect(screen.getByText("Safe mode")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "What should we shape?" }),
    ).toBeVisible();
  });

  it("keeps a protected composer when a shaped document omits its prompt", () => {
    const documentWithoutPrompt = InterfaceDocument.make({
      version: 2,
      name: "Read-only dashboard",
      root: {
        id: "dashboard-root",
        type: "stack",
        direction: "column",
        gap: "md",
        children: [
          {
            id: "dashboard-headline",
            type: "text",
            text: "Read-only dashboard",
            style: "headline",
          },
        ],
      },
    });

    render(
      <Launcher
        document={documentWithoutPrompt}
        safeMode={false}
        session={controller()}
        shaping={shaping()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Message Flect" }),
    ).toHaveAttribute("placeholder", "Build, change, or connect anything");
  });
});
