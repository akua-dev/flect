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
import { ControlStateSnapshot } from "../../shared/control";
import { InterfaceDocument } from "../../shared/interface-document";
import { ShellPreferencesValue } from "../../shared/shell-preferences";
import type {
  AgentSessionStatus,
  AgentWorkspaceController,
} from "../hooks/use-agent-session";
import type { ShellPreferencesController } from "../hooks/use-shell-preferences";
import type { ShapingController } from "./agent-rail";
import { RoleAwareShell, type RoleAwareShellProps } from "./role-aware-shell";

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
  reasoningLevel: undefined,
  providers: [],
  authEvent: undefined,
  selectModel: vi.fn(),
  selectReasoning: vi.fn(),
  loginProvider: vi.fn(),
  replyProviderAuth: vi.fn(() => Promise.resolve()),
  cancelProviderAuth: vi.fn(() => Promise.resolve()),
  refreshProviderAuth: vi.fn(() => Promise.resolve()),
  logoutProvider: vi.fn(() => Promise.resolve()),
  refresh: vi.fn(() => Promise.resolve()),
  externalExtensions: { app: false, shaper: false },
  toggleExternalExtensions: vi.fn(() => Promise.resolve()),
  app: {
    ...appRole(),
    submit: vi.fn(() => Promise.resolve()),
  },
  previewApp: {
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
  fixFailure: vi.fn(() => Promise.resolve()),
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
  controlledMode,
  onModeChange,
  diagnostics,
}: {
  readonly initialCollapsed?: boolean;
  readonly initialWidth?: number;
  readonly phase?: "blank" | "preview" | "accepted" | "safe";
  readonly workspaceController?: AgentWorkspaceController;
  readonly shapingController?: ShapingController;
  readonly controlledMode?: "edit" | "run";
  readonly onModeChange?: (mode: "edit" | "run") => Promise<void>;
  readonly diagnostics?: RoleAwareShellProps["diagnostics"];
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
      controlledMode={controlledMode}
      document={documentWithoutPrompt}
      diagnostics={diagnostics}
      onOpenSafeMode={vi.fn()}
      onModeChange={onModeChange}
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
  it("opens Settings across the canvas instead of inside the agent rail", async () => {
    const user = userEvent.setup();
    render(
      <ShellHarness
        diagnostics={{
          control: ControlStateSnapshot.make({ enabled: false, clients: [] }),
          onToggleControl: vi.fn(() => Promise.resolve()),
          operations: [],
        }}
      />,
    );

    const [trigger] = screen.getAllByRole("button", {
      name: "Open settings",
    });
    await user.click(trigger);

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    expect(document.querySelector(".workspace-canvas")).toHaveClass(
      "workspace-canvas--settings",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close settings" }),
      ).toHaveFocus(),
    );

    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(
      screen.queryByRole("heading", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("announces the active agent and protected workbench state atomically", () => {
    const { rerender } = render(<ShellHarness phase="accepted" />);

    expect(
      screen.getByRole("status", { name: "Workbench status" }),
    ).toHaveTextContent(
      "Flect is ready. Build, change, or use the product in one conversation.",
    );

    rerender(
      <ShellHarness
        phase="preview"
        shapingController={shaping({ status: "preview" })}
      />,
    );
    expect(
      screen.getByRole("status", { name: "Workbench status" }),
    ).toHaveTextContent(
      "Imported candidate Projects validated. Review its authority changes, then activate or discard it.",
    );

    rerender(<ShellHarness phase="safe" />);
    expect(
      screen.getByRole("status", { name: "Workbench status" }),
    ).toHaveTextContent("Safe mode. Customized interface state is bypassed.");
  });

  it("does not expose internal mode controls", () => {
    const onModeChange = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <ShellHarness
        controlledMode="run"
        onModeChange={onModeChange}
        phase="accepted"
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Message Flect" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /App Agent|Shaper/ }),
    ).not.toBeInTheDocument();
    expect(onModeChange).not.toHaveBeenCalled();

    rerender(
      <ShellHarness
        controlledMode="edit"
        onModeChange={onModeChange}
        phase="accepted"
      />,
    );
    expect(
      screen.getByRole("textbox", { name: "Message Flect" }),
    ).toBeVisible();
  });

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
    const input = screen.getByRole("textbox", { name: "Message Flect" });
    const originalComposer = input.closest(".composer");
    expect(screen.getByText("What do you want to make?")).toBeVisible();
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
        .getByRole("textbox", { name: "Message Flect" })
        .closest(".composer"),
    ).toBe(originalComposer);
    expect(
      screen.getByRole("textbox", { name: "Message Flect" }),
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

    const input = screen.getByRole("textbox", { name: "Message Flect" });
    await user.type(input, "Open the latest project{Enter}");

    expect(appSubmit).toHaveBeenCalledWith("Open the latest project");
    expect(shaperRequest).not.toHaveBeenCalled();
  });

  it("routes a selected visible element through one targeted agent handoff", async () => {
    const user = userEvent.setup();
    const requestTargeted = vi.fn(() => Promise.resolve());
    const appSubmit = vi.fn(() => Promise.resolve());
    render(
      <ShellHarness
        phase="accepted"
        shapingController={shaping({ requestTargeted })}
        workspaceController={workspace({
          app: { ...appRole(), submit: appSubmit },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select element" }));
    await user.click(screen.getByRole("heading", { name: "Projects" }));

    const composer = screen.getByRole("textbox", { name: "Message Flect" });
    await waitFor(() => expect(composer).toHaveFocus());
    expect(
      document.querySelector(".canvas-edit-toolbar__selection"),
    ).toHaveTextContent("Projects");
    await user.type(composer, "Make this calmer{Enter}");

    expect(requestTargeted).toHaveBeenCalledWith(
      "Make this calmer",
      expect.objectContaining({
        semanticId: "headline",
        label: "Projects",
      }),
      "headline",
    );
    expect(appSubmit).not.toHaveBeenCalled();
  });

  it("turns direct manipulation into a targeted attributable edit", async () => {
    const user = userEvent.setup();
    const requestTargeted = vi.fn(() => Promise.resolve());
    render(
      <ShellHarness
        phase="accepted"
        shapingController={shaping({ requestTargeted })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select element" }));
    await user.click(screen.getByRole("heading", { name: "Projects" }));
    await user.click(screen.getByRole("button", { name: "Move later" }));

    expect(requestTargeted).toHaveBeenCalledWith(
      expect.stringContaining("one position later"),
      expect.objectContaining({ semanticId: "headline" }),
      "headline",
    );
  });

  it("shows one history and one stop control during internal work", async () => {
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

    expect(await screen.findByText("App history")).toBeVisible();
    expect(await screen.findByText("Shaper history")).toBeVisible();

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
    expect(screen.getByRole("button", { name: "Stop Flect" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /App Agent|Shaper/ }),
    ).not.toBeInTheDocument();
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

    expect(screen.getByText("Imported app ready")).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Import decision" })).getByText(
        "Projects",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Activate app" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(accept).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledOnce();
  });

  it("keeps the protected rail when the interface has no prompt node", () => {
    render(<ShellHarness phase="accepted" />);
    expect(
      screen.getByRole("complementary", { name: "Flect agent" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Message Flect" }),
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

  it("reports a rejected local share without an unhandled file-input failure", async () => {
    const user = userEvent.setup();
    const onOpenShareFile = vi
      .fn<(name: string, bytes: Uint8Array) => Promise<void>>()
      .mockRejectedValueOnce(new Error("private archive detail"))
      .mockResolvedValueOnce(undefined);
    render(
      <RoleAwareShell
        document={documentWithoutPrompt}
        onOpenSafeMode={vi.fn()}
        onOpenShareFile={onOpenShareFile}
        onRestoreSafeMode={vi.fn(() => Promise.resolve())}
        phase="accepted"
        preferences={{
          value: ShellPreferencesValue.make({
            version: 1,
            railWidth: 400,
            railCollapsed: false,
            modelFavorites: [],
          }),
          setRailWidth: vi.fn(() => Promise.resolve()),
          setRailCollapsed: vi.fn(() => Promise.resolve()),
          toggleModelFavorite: vi.fn(() => Promise.resolve()),
        }}
        preview={false}
        shaping={shaping()}
        workspace={workspace()}
      />,
    );

    const input = screen.getByLabelText("Open shared file");
    await user.upload(
      input,
      new File(["invalid"], "invalid.flect-share", {
        type: "application/octet-stream",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The shared file could not be reviewed safely.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "private archive detail",
    );

    await user.upload(
      input,
      new File(["valid"], "valid.flect-share", {
        type: "application/octet-stream",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(onOpenShareFile).toHaveBeenCalledTimes(2);
  });
});
