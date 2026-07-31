// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../shared/interface-document";
import { SandboxResult, SetTextIntent } from "../shared/sandbox";
import { makeShapingKernelTestLayer } from "./lib/shaping-kernel";
import { SandboxCapabilityBroker } from "./sandbox/capability-broker";
import { ExtensionExecution } from "./sandbox/extension-execution";
import { ExtensionSandbox } from "./sandbox/extension-sandbox";

const mocks = vi.hoisted(() => ({
  appSubmit: vi.fn(() => Promise.resolve()),
  shaperShape: vi.fn(),
}));

vi.mock("./hooks/use-agent-session", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./hooks/use-agent-session")>();
  return {
    ...original,
    useAgentSession: () => ({
      models: [],
      selectedModel: undefined,
      selectModel: vi.fn(),
      refresh: vi.fn(() => Promise.resolve()),
      externalExtensions: { app: false, shaper: false },
      toggleExternalExtensions: vi.fn(() => Promise.resolve()),
      app: {
        role: "app" as const,
        status: "ready" as const,
        messages: [],
        lastPrompt: "",
        error: undefined,
        submit: mocks.appSubmit,
        cancel: vi.fn(() => Promise.resolve()),
      },
      shaper: {
        role: "shaper" as const,
        status: "ready" as const,
        messages: [],
        lastPrompt: "",
        error: undefined,
        shape: mocks.shaperShape,
        cancel: vi.fn(() => Promise.resolve()),
      },
      diagnoseRecovery: vi.fn(() =>
        Promise.resolve({
          version: 1 as const,
          message: "Protected recovery is available.",
        }),
      ),
    }),
  };
});

vi.mock("./hooks/use-shell-preferences", () => ({
  useShellPreferences: () => ({
    value: {
      version: 1 as const,
      railWidth: 400,
      railCollapsed: false,
      modelFavorites: [],
    },
    setRailWidth: vi.fn(() => Promise.resolve()),
    setRailCollapsed: vi.fn(() => Promise.resolve()),
    toggleModelFavorite: vi.fn(() => Promise.resolve()),
  }),
}));

import { App } from "./app";

const candidate = InterfaceDocument.make({
  version: 2,
  name: "Focused project overview",
  root: {
    id: "root",
    type: "stack",
    direction: "column",
    gap: "lg",
    children: [
      {
        id: "headline",
        type: "text",
        text: "Focused project overview",
        style: "headline",
      },
    ],
  },
});

const stored = new Map<string, string>();

beforeEach(() => {
  stored.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  mocks.appSubmit.mockClear();
  mocks.shaperShape.mockReset();
  mocks.shaperShape.mockResolvedValue(candidate);
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

afterEach(cleanup);

describe("App", () => {
  it("keeps the protected recovery shell available when workspace loading fails", async () => {
    const shaping = ManagedRuntime.make(
      Layer.mergeAll(
        makeShapingKernelTestLayer(),
        Layer.succeed(ExtensionExecution)({
          execute: () =>
            Effect.succeed(
              SandboxResult.make({
                version: 1,
                intents: [],
              }),
            ),
        }),
        Layer.succeed(ExtensionSandbox)({
          execute: () =>
            Effect.succeed(
              SandboxResult.make({
                version: 1,
                intents: [],
              }),
            ),
        }),
        Layer.succeed(SandboxCapabilityBroker)({
          apply: () => Effect.void,
        }),
      ),
    );

    render(
      <App
        consumeLegacyInterface={() => Promise.resolve()}
        loadLegacyInterface={() => Promise.reject(new Error("storage failed"))}
        shaping={shaping}
      />,
    );

    expect(
      await screen.findByText("Custom interface state is bypassed."),
    ).toBeVisible();
    expect(screen.queryByText("Opening workspace")).not.toBeInTheDocument();
    await shaping.dispose();
  });

  it("routes the first blank-workspace instruction only to Shaper", async () => {
    const user = userEvent.setup();
    const shaping = ManagedRuntime.make(
      Layer.mergeAll(
        makeShapingKernelTestLayer(),
        Layer.succeed(ExtensionExecution)({
          execute: () =>
            Effect.succeed(
              SandboxResult.make({
                version: 1,
                intents: [
                  SetTextIntent.make({
                    type: "set-text",
                    target: "isolation-status",
                    text: "undefined,undefined,undefined,undefined,undefined,undefined",
                  }),
                ],
              }),
            ),
        }),
        Layer.succeed(ExtensionSandbox)({
          execute: () =>
            Effect.succeed(
              SandboxResult.make({
                version: 1,
                intents: [],
              }),
            ),
        }),
        Layer.succeed(SandboxCapabilityBroker)({
          apply: () => Effect.void,
        }),
      ),
    );
    render(
      <App
        consumeLegacyInterface={() => Promise.resolve()}
        loadLegacyInterface={() => Promise.resolve(defaultInterfaceDocument)}
        shaping={shaping}
      />,
    );

    const input = await screen.findByRole("textbox", {
      name: "Message Shaper",
    });
    await user.type(input, "Create a focused project overview{Enter}");

    await waitFor(() =>
      expect(mocks.shaperShape).toHaveBeenCalledWith(
        "Create a focused project overview",
        expect.objectContaining({ name: "Flect" }),
      ),
    );
    expect(mocks.appSubmit).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("region", { name: "Revision decision" }),
    ).toBeVisible();
    await shaping.dispose();
  });
});
