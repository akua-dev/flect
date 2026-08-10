// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Layer, ManagedRuntime, Stream, SubscriptionRef } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ControlStateSnapshot,
  FlectCommandReceipt,
  FlectWorkspaceSnapshot,
  RailStateSnapshot,
  WorkbenchSnapshot,
} from "../shared/control";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../shared/interface-document";
import {
  InterfaceRevision,
  RevisionId,
  ShapingEvent,
  ShapingSnapshot,
} from "../shared/revisions";
import { App } from "./app";
import type { WorkspaceRuntime } from "./hooks/use-workspace";
import {
  FlectWorkspaceController,
  type FlectWorkspaceControllerShape,
} from "./lib/workspace-controller";

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

const builtInRevision = InterfaceRevision.make({
  version: 1,
  id: RevisionId.make("built-in"),
  status: "accepted",
  source: "built-in",
  document: defaultInterfaceDocument,
  createdAt: 0,
});

const initialSnapshot = (safeMode = false) =>
  FlectWorkspaceSnapshot.make({
    version: 1,
    workspaceId: "workspace-app-test",
    sequence: 0,
    phase: safeMode ? "safe-mode" : "ready",
    mode: "edit",
    document: defaultInterfaceDocument,
    shaping: ShapingSnapshot.make({
      version: 1,
      active: builtInRevision,
      lastKnownGood: builtInRevision,
      safeMode,
      disabledExtensions: [],
      lastEvent: ShapingEvent.make({
        version: 1,
        sequence: safeMode ? 1 : 0,
        type: safeMode ? "safe-mode-entered" : "initialized",
        revisionId: RevisionId.make("built-in"),
      }),
    }),
    workbench: WorkbenchSnapshot.make({
      target: "shape",
      binding: "accepted",
      transitionSequence: 0,
    }),
    agent: {
      models: [],
      favoriteModels: [],
      externalExtensions: { app: false, shaper: false },
      app: {
        role: "app",
        status: "ready",
        messages: [],
        activities: [],
        lastPrompt: "",
      },
      previewApp: {
        role: "app",
        status: "ready",
        messages: [],
        activities: [],
        lastPrompt: "",
      },
      shaper: {
        role: "shaper",
        status: "ready",
        messages: [],
        activities: [],
        lastPrompt: "",
      },
    },
    rail: RailStateSnapshot.make({ collapsed: false, width: 400 }),
    control: ControlStateSnapshot.make({ enabled: false, clients: [] }),
    operations: [],
  });

const makeRuntime = (safeMode = false) => {
  let setOutsideMode = (_mode: "edit" | "run") => Effect.void;
  const dispatch = vi.fn<FlectWorkspaceControllerShape["dispatch"]>();
  const layer = Layer.effect(
    FlectWorkspaceController,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make(initialSnapshot(safeMode));
      setOutsideMode = (mode) =>
        SubscriptionRef.update(state, (current) =>
          FlectWorkspaceSnapshot.make({
            ...current,
            sequence: current.sequence + 1,
            mode,
            workbench: WorkbenchSnapshot.make({
              target: mode === "run" ? "use" : "shape",
              binding: "accepted",
              transitionSequence:
                (current.workbench?.transitionSequence ?? 0) + 1,
            }),
          }),
        );
      dispatch.mockImplementation((envelope) =>
        SubscriptionRef.modify(state, (current) => {
          const sequence = current.sequence + 1;
          const command = envelope.command;
          const next =
            command.type === "submit-shaper-instruction"
              ? (() => {
                  const proposal = InterfaceRevision.make({
                    version: 1,
                    id: RevisionId.make("revision-app-test"),
                    parentId: current.shaping.active.id,
                    status: "accepted",
                    source: "shaper",
                    document: candidate,
                    createdAt: 1,
                  });
                  return FlectWorkspaceSnapshot.make({
                    ...current,
                    sequence,
                    phase: "ready",
                    mode: "run",
                    document: candidate,
                    shaping: ShapingSnapshot.make({
                      ...current.shaping,
                      active: proposal,
                      lastKnownGood: current.shaping.active,
                      lastEvent: ShapingEvent.make({
                        version: 1,
                        sequence: current.shaping.lastEvent.sequence + 2,
                        type: "revision-accepted",
                        revisionId: proposal.id,
                      }),
                    }),
                    workbench: WorkbenchSnapshot.make({
                      target: "use",
                      binding: "accepted",
                      transitionSequence:
                        (current.workbench?.transitionSequence ?? 0) + 1,
                    }),
                  });
                })()
              : FlectWorkspaceSnapshot.make({
                  ...current,
                  sequence,
                  mode:
                    command.type === "set-mode" ? command.mode : current.mode,
                  control:
                    command.type === "enable-control"
                      ? ControlStateSnapshot.make({
                          enabled: true,
                          instanceId: "instance-app-test-1",
                          clients: [],
                        })
                      : current.control,
                });
          return [
            FlectCommandReceipt.make({
              version: 1,
              commandId: envelope.commandId,
              workspaceId: envelope.workspaceId,
              operationId: "operation-app-test-1",
              sequence,
              status: "completed",
            }),
            next,
          ];
        }),
      );
      return {
        snapshot: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state),
        events: Stream.empty,
        providerAuth: Effect.succeed({ providers: [] }),
        providerAuthChanges: Stream.empty,
        continuity: Effect.succeed({
          drafts: { acceptedUse: "", candidateUse: "", shape: "" },
          generation: 0,
          revisionSequence: 0,
        }),
        continuityChanges: Stream.empty,
        setDraft: () => Effect.void,
        exportContinuity: Effect.succeed("{}"),
        exportRepository: Effect.succeed(new Uint8Array([1])),
        readShareExport: () => Effect.succeed(new Uint8Array([1])),
        discardContinuity: Effect.void,
        retryContinuity: Effect.void,
        dispatch,
        connectClient: () => Effect.void,
        disconnectClient: () => Effect.void,
        selectReasoning: () => Effect.void,
        loginProvider: () => Effect.void,
        replyProviderAuth: () => Effect.void,
        cancelProviderAuth: () => Effect.void,
        refreshProviderAuth: Effect.void,
        logoutProvider: () => Effect.void,
      } satisfies FlectWorkspaceControllerShape;
    }),
  );
  const runtime: WorkspaceRuntime = ManagedRuntime.make(layer);
  return {
    dispatch,
    runtime,
    setOutsideMode: (mode: "edit" | "run") => setOutsideMode(mode),
  };
};

describe("App", () => {
  it("routes shaping and diagnostics through the typed shared controller", async () => {
    const user = userEvent.setup();
    const { dispatch, runtime } = makeRuntime();
    render(<App runtime={runtime} />);

    const input = await screen.findByRole("textbox", {
      name: "Message Flect",
    });
    await user.type(input, "Create a focused project overview{Enter}");

    await waitFor(() =>
      expect(
        dispatch.mock.calls.some(
          ([envelope]) => envelope.command.type === "submit-shaper-instruction",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Focused project overview")).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Import decision" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Message Flect" }),
    ).toBeVisible();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(
      dispatch.mock.calls.some(
        ([envelope]) => envelope.command.type === "accept-proposal",
      ),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: "Diagnostics" }));
    await user.click(
      await screen.findByRole("button", { name: "Enable local control" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Disable local control" }),
      ).toBeVisible(),
    );

    await runtime.dispose();
  });

  it("renders outside state changes without a parallel local mode", async () => {
    const { runtime, setOutsideMode } = makeRuntime();
    render(<App runtime={runtime} />);
    await screen.findByRole("textbox", { name: "Message Flect" });

    await act(async () => {
      await runtime.runPromise(setOutsideMode("run"));
    });
    expect(
      await screen.findByRole("textbox", { name: "Message Flect" }),
    ).toBeVisible();

    await runtime.dispose();
  });

  it("keeps the protected recovery shell available in safe mode", async () => {
    const { runtime } = makeRuntime(true);
    render(<App runtime={runtime} />);

    expect(
      await screen.findByText("Custom interface state is bypassed."),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Message Flect" }),
    ).toBeDisabled();

    await runtime.dispose();
  });
});
