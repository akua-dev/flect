// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InterfaceDocument } from "../../shared/interface-document";
import { ShellPreferencesValue } from "../../shared/shell-preferences";
import type { AgentWorkspaceController } from "../hooks/use-agent-session";
import { AgentRail, type ShapingController } from "./agent-rail";

afterEach(cleanup);

const document = InterfaceDocument.make({
  version: 2,
  name: "Focused project overview",
  root: { id: "root", type: "text", text: "Projects", style: "headline" },
});

const workspace: AgentWorkspaceController = {
  models: [],
  selectedModel: undefined,
  selectModel: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
  externalExtensions: { app: false, shaper: false },
  toggleExternalExtensions: vi.fn(() => Promise.resolve()),
  app: {
    role: "app",
    status: "ready",
    messages: [{ id: "a", role: "assistant", content: "App only" }],
    lastPrompt: "",
    error: undefined,
    submit: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
  },
  shaper: {
    role: "shaper",
    status: "ready",
    messages: [{ id: "s", role: "assistant", content: "Shaper only" }],
    lastPrompt: "",
    error: undefined,
    shape: vi.fn(() => Promise.resolve(document)),
    cancel: vi.fn(() => Promise.resolve()),
  },
  diagnoseRecovery: vi.fn(() =>
    Promise.resolve({ version: 1 as const, message: "Recovery ready." }),
  ),
};

const shaping: ShapingController = {
  status: "idle",
  rollbackAvailable: false,
  isolation: "ready",
  verifyIsolation: vi.fn(() => Promise.resolve()),
  request: vi.fn(() => Promise.resolve()),
  accept: vi.fn(() => Promise.resolve()),
  reject: vi.fn(() => Promise.resolve()),
  rollback: vi.fn(() => Promise.resolve()),
};

const preferences = {
  value: ShellPreferencesValue.make({
    version: 1,
    railWidth: 400,
    railCollapsed: false,
    modelFavorites: [],
  }),
  setRailWidth: vi.fn(() => Promise.resolve()),
  setRailCollapsed: vi.fn(() => Promise.resolve()),
  toggleModelFavorite: vi.fn(() => Promise.resolve()),
};

describe("AgentRail", () => {
  it("renders only the selected role history", () => {
    const { rerender } = render(
      <AgentRail
        document={document}
        mode="run"
        onCollapse={vi.fn()}
        onModeChange={vi.fn()}
        onOpenSafeMode={vi.fn()}
        onRestoreSafeMode={vi.fn(() => Promise.resolve())}
        preferences={preferences}
        shaping={shaping}
        workspace={workspace}
      />,
    );
    expect(screen.getByText("App only")).toBeVisible();
    expect(screen.queryByText("Shaper only")).not.toBeInTheDocument();

    rerender(
      <AgentRail
        document={document}
        mode="edit"
        onCollapse={vi.fn()}
        onModeChange={vi.fn()}
        onOpenSafeMode={vi.fn()}
        onRestoreSafeMode={vi.fn(() => Promise.resolve())}
        preferences={preferences}
        shaping={shaping}
        workspace={workspace}
      />,
    );
    expect(screen.getByText("Shaper only")).toBeVisible();
    expect(screen.queryByText("App only")).not.toBeInTheDocument();
  });

  it("bypasses ordinary sending in safe mode", () => {
    render(
      <AgentRail
        document={document}
        mode="safe"
        onCollapse={vi.fn()}
        onModeChange={vi.fn()}
        onOpenSafeMode={vi.fn()}
        onRestoreSafeMode={vi.fn(() => Promise.resolve())}
        preferences={preferences}
        shaping={shaping}
        workspace={workspace}
      />,
    );

    expect(
      screen.getByText("Custom interface state is bypassed."),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Message Shaper" }),
    ).toBeDisabled();
  });
});
