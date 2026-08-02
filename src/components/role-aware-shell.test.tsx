// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterfaceDocument } from "../../shared/interface-document";
import { ShellPreferencesValue } from "../../shared/shell-preferences";
import type {
  AgentSessionStatus,
  AgentWorkspaceController,
} from "../hooks/use-agent-session";
import type { ShellPreferencesController } from "../hooks/use-shell-preferences";
import type { ShapingController } from "./agent-rail";
import { RoleAwareShell } from "./role-aware-shell";

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const documentWithoutPrompt = InterfaceDocument.make({
  version: 2,
  name: "Projects",
  root: {
    id: "root",
    type: "stack",
    direction: "column",
    gap: "lg",
    children: [
      {
        id: "headline",
        type: "text",
        text: "Projects",
        style: "headline",
      },
    ],
  },
});

const conversation = (status: AgentSessionStatus = "ready") => ({
  status,
  messages: [],
  lastPrompt: "",
  error: undefined,
  cancel: vi.fn(() => Promise.resolve()),
});

const appRole = (status: AgentSessionStatus = "ready") => ({
  role: "app" as const,
  ...conversation(status),
});

const shaperRole = (status: AgentSessionStatus = "ready") => ({
  role: "shaper" as const,
  ...conversation(status),
});

const workspace = (
  overrides: Partial<AgentWorkspaceController> = {},
): AgentWorkspaceController => ({
  models: [],
  selectedModel: undefined,
  selectModel: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
  externalExtensions: { app: false, shaper: false },
  toggleExternalExtensions: vi.fn(() => Promise.resolve()),
  app: {
    ...appRole(),
    submit: vi.fn(() => Promise.resolve()),
  },
  shaper: {
    ...shaperRole(),
    shape: vi.fn(() => Promise.resolve(documentWithoutPrompt)),
  },
  diagnoseRecovery: vi.fn(() =>
    Promise.resolve({
      version: 1 as const,
      message: "Protected recovery is available.",
    }),
  ),
  ...overrides,
});

const shaping = (
  overrides: Partial<ShapingController> = {},
): ShapingController => ({
  status: "idle",
  rollbackAvailable: false,
  isolation: "ready",
  verifyIsolation: vi.fn(() => Promise.resolve()),
  request: vi.fn(() => Promise.resolve()),
  accept: vi.fn(() => Promise.resolve()),
  reject: vi.fn(() => Promise.resolve()),
  rollback: vi.fn(() => Promise.resolve()),
  ...overrides,
});

function ShellHarness({
  initialCollapsed = false,
  initialWidth = 400,
  phase = "accepted",
  workspaceController = workspace(),
  shapingController = shaping(),
}: {
  readonly initialCollapsed?: boolean;
  readonly initialWidth?: number;
  readonly phase?: "blank" | "preview" | "accepted" | "safe";
  readonly workspaceController?: AgentWorkspaceController;
  readonly shapingController?: ShapingController;
}) {
  const [value, setValue] = useState(
    ShellPreferencesValue.make({
      version: 1,
      railWidth: initialWidth,
      railCollapsed: initialCollapsed,
      modelFavorites: [],
    }),
  );
  const preferences: ShellPreferencesController = {
    value,
    setRailWidth: async (width) =>
      setValue((current) =>
        ShellPreferencesValue.make({
          ...current,
          railWidth: Math.max(340, Math.min(520, Math.round(width))),
        }),
      ),
    setRailCollapsed: async (railCollapsed) =>
      setValue((current) =>
        ShellPreferencesValue.make({ ...current, railCollapsed }),
      ),
    toggleModelFavorite: async () => undefined,
  };
  return (
    <RoleAwareShell
      document={documentWithoutPrompt}
      onOpenSafeMode={vi.fn()}
      onRestoreSafeMode={vi.fn(() => Promise.resolve())}
      phase={phase}
      preferences={preferences}
      preview={phase === "preview"}
      shaping={shapingController}
      workspace={workspaceController}
    />
  );
}

describe("RoleAwareShell", () => {
  it("moves the same focused composer from blank Edit into the rail", async () => {
    const user = userEvent.setup();
    const request = vi.fn((_instruction: string) => Promise.resolve());

    function MovingHarness() {
      const [status, setStatus] = useState<ShapingController["status"]>("idle");
      return (
        <ShellHarness
          phase="blank"
          shapingController={shaping({
            status,
            request: async (instruction) => {
              request(instruction);
              setStatus("shaping");
            },
          })}
        />
      );
    }

    const { container } = render(<MovingHarness />);
    const input = screen.getByRole("textbox", { name: "Message Shaper" });
    const originalComposer = input.closest(".composer");
    expect(screen.getByText("What should we shape?")).toBeVisible();
    expect(
      container.querySelector(".role-shell--centered"),
    ).toBeInTheDocument();

    await user.type(input, "Create a project overview{Enter}");

    expect(request).toHaveBeenCalledWith("Create a project overview");
    await waitFor(() =>
      expect(container.querySelector(".role-shell--split")).toBeInTheDocument(),
    );
    expect(
      screen
        .getByRole("textbox", { name: "Message Shaper" })
        .closest(".composer"),
    ).toBe(originalComposer);
    expect(
      screen.getByRole("textbox", { name: "Message Shaper" }),
    ).toHaveFocus();
  });

  it("starts an accepted experience in Run and submits only to App Agent", async () => {
    const user = userEvent.setup();
    const appSubmit = vi.fn(() => Promise.resolve());
    const shaperRequest = vi.fn(() => Promise.resolve());
    render(
      <ShellHarness
        phase="accepted"
        shapingController={shaping({ request: shaperRequest })}
        workspaceController={workspace({
          app: { ...appRole(), submit: appSubmit },
        })}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Message App Agent" });
    await user.type(input, "Open the latest project{Enter}");

    expect(appSubmit).toHaveBeenCalledWith("Open the latest project");
    expect(shaperRequest).not.toHaveBeenCalled();
  });

  it("shows separate histories and blocks role changes during work", async () => {
    const user = userEvent.setup();
    const controller = workspace({
      app: {
        ...appRole(),
        messages: [{ id: "app-1", role: "assistant", content: "App history" }],
        submit: vi.fn(() => Promise.resolve()),
      },
      shaper: {
        ...shaperRole(),
        messages: [
          { id: "shape-1", role: "assistant", content: "Shaper history" },
        ],
        shape: vi.fn(() => Promise.resolve(documentWithoutPrompt)),
      },
    });
    const { rerender } = render(
      <ShellHarness phase="accepted" workspaceController={controller} />,
    );

    expect(screen.getByText("App history")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit · Shaper" }));
    expect(screen.getByText("Shaper history")).toBeVisible();
    expect(screen.queryByText("App history")).not.toBeInTheDocument();

    rerender(
      <ShellHarness
        phase="accepted"
        workspaceController={workspace({
          app: {
            ...appRole("streaming"),
            submit: vi.fn(() => Promise.resolve()),
          },
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Run · App Agent" }),
    ).toBeDisabled();
  });

  it("keeps preview decisions next to the protected composer", async () => {
    const user = userEvent.setup();
    const accept = vi.fn(() => Promise.resolve());
    const reject = vi.fn(() => Promise.resolve());
    render(
      <ShellHarness
        phase="preview"
        shapingController={shaping({
          status: "preview",
          accept,
          reject,
        })}
      />,
    );

    expect(screen.getByText("Validated preview")).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Revision decision" }),
      ).getByText("Projects"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep change" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(accept).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledOnce();
  });

  it("keeps the protected rail when the interface has no prompt node", () => {
    render(<ShellHarness phase="accepted" />);
    expect(
      screen.getByRole("complementary", { name: "Flect agent" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Message App Agent" }),
    ).toBeVisible();
  });

  it("collapses, restores focus, and reopens the rail", async () => {
    const user = userEvent.setup();
    render(<ShellHarness phase="accepted" />);

    await user.click(screen.getByRole("button", { name: "Collapse agent" }));
    const reopen = await screen.findByRole("button", {
      name: "Open Flect agent",
    });
    await waitFor(() => expect(reopen).toHaveFocus());
    await user.click(reopen);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Collapse agent" }),
      ).toHaveFocus(),
    );
  });

  it("resizes from the keyboard within protected bounds", async () => {
    const user = userEvent.setup();
    render(<ShellHarness initialWidth={400} phase="accepted" />);
    const separator = screen.getByRole("separator", {
      name: "Resize agent panel",
    });

    await user.click(separator);
    await user.keyboard("{ArrowLeft}{End}{ArrowRight}{Home}");

    expect(separator).toHaveAttribute("aria-valuenow", "340");
  });
});
