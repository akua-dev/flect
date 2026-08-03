// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapsuleIntentSucceeded } from "../../shared/capsule-protocol";
import { CapsuleFrame, projectCapsuleDocument } from "./capsule-frame";

afterEach(() => {
  cleanup();
  FakeMessageChannel.created = 0;
  FakeMessageChannel.latest = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly posted: Array<unknown> = [];
  close = vi.fn();
  start = vi.fn();
  postMessage = vi.fn((message: unknown) => {
    this.posted.push(message);
  });
  receive(message: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: message }));
  }
}

class FakeMessageChannel {
  static created = 0;
  static latest: FakeMessageChannel | undefined;
  readonly port1 = new FakePort();
  readonly port2 = new FakePort();
  constructor() {
    FakeMessageChannel.created += 1;
    FakeMessageChannel.latest = this;
  }
}

const frameDocument = (frame: HTMLIFrameElement) =>
  new TextDecoder().decode(
    Uint8Array.from(
      globalThis.atob(frame.getAttribute("src")?.split(",", 2)[1] ?? ""),
      (character) => character.charCodeAt(0),
    ),
  );

describe("CapsuleFrame", () => {
  it("mounts compiled UI in an opaque network-denied frame", () => {
    render(<CapsuleFrame html="<main>Capsule UI</main>" />);
    const frame = screen.getByTitle("Flect app") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    const source = frame.getAttribute("src");
    expect(source).toMatch(/^data:text\/html;base64,/);
    const document = frameDocument(frame);
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("<main>Capsule UI</main>");
  });

  it("projects verified local styles, scripts, and media without network URLs", () => {
    const source = projectCapsuleDocument(
      `<link rel="stylesheet" href="./styles/main.css"><main><img alt="Mark" src="../assets/mark.svg"><button id="run">Run</button><script src="./app.js"></script></main>`,
      "ui/index.html",
      [
        {
          path: "ui/styles/main.css",
          contents: new TextEncoder().encode(
            `main{background-image:url("../../assets/mark.svg")}`,
          ),
        },
        {
          path: "assets/mark.svg",
          contents: new TextEncoder().encode(
            `<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
          ),
        },
        {
          path: "ui/app.js",
          contents: new TextEncoder().encode(
            `document.querySelector("#run").textContent="Ready"`,
          ),
        },
      ],
    );

    expect(source).toContain("<style>");
    expect(source).toContain("data:image/svg+xml;base64,");
    expect(source).toContain("document.querySelector");
    expect(source).not.toContain('src="./app.js"');
    expect(source).not.toContain('href="./styles/main.css"');
  });

  it("connects when the opaque frame loaded before effect subscription", async () => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    render(<CapsuleFrame html="<main>Already loaded</main>" />);
    fireEvent.load(screen.getByTitle("Flect app"));

    await waitFor(() =>
      expect(FakeMessageChannel.created).toBeGreaterThanOrEqual(2),
    );
  });

  it("returns a correlated bounded result to the requesting capsule", async () => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    const onIntent = vi.fn(async (intent) =>
      CapsuleIntentSucceeded.make({
        version: 1,
        type: "intent-result",
        id: intent.id,
        ok: true,
        output: { projects: ["one"] },
      }),
    );
    render(<CapsuleFrame html="<main>Product</main>" onIntent={onIntent} />);
    fireEvent.load(screen.getByTitle("Flect app"));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    const port = FakeMessageChannel.latest?.port1;
    expect(port).toBeDefined();
    port?.receive({ version: 1, type: "ready" });
    await waitFor(() =>
      expect(port?.posted).toContainEqual(
        expect.objectContaining({ type: "visibility" }),
      ),
    );
    port?.receive({
      version: 1,
      type: "intent",
      id: "intent-12345678",
      action: "projects.list",
      input: { limit: 2 },
    });

    await waitFor(() => expect(onIntent).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(port?.posted).toContainEqual({
        version: 1,
        type: "intent-result",
        id: "intent-12345678",
        ok: true,
        output: { projects: ["one"] },
      }),
    );
    expect(onIntent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "projects.list" }),
    );
  });

  it("keeps the authenticated channel when host callbacks change", async () => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    const firstIntent = vi.fn(async (intent) =>
      CapsuleIntentSucceeded.make({
        version: 1,
        type: "intent-result",
        id: intent.id,
        ok: true,
        output: { handler: "first" },
      }),
    );
    const nextIntent = vi.fn(async (intent) =>
      CapsuleIntentSucceeded.make({
        version: 1,
        type: "intent-result",
        id: intent.id,
        ok: true,
        output: { handler: "next" },
      }),
    );
    const rendered = render(
      <CapsuleFrame html="<main>Product</main>" onIntent={firstIntent} />,
    );
    fireEvent.load(screen.getByTitle("Flect app"));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    const channel = FakeMessageChannel.latest;
    expect(channel).toBeDefined();
    channel?.port1.receive({ version: 1, type: "ready" });
    await waitFor(() =>
      expect(channel?.port1.posted).toContainEqual(
        expect.objectContaining({ type: "visibility" }),
      ),
    );
    const createdBeforeRerender = FakeMessageChannel.created;

    rendered.rerender(
      <CapsuleFrame html="<main>Product</main>" onIntent={nextIntent} />,
    );
    channel?.port1.receive({
      version: 1,
      type: "intent",
      id: "intent-87654321",
      action: "projects.list",
      input: null,
    });

    await waitFor(() => expect(nextIntent).toHaveBeenCalledTimes(1));
    expect(firstIntent).not.toHaveBeenCalled();
    expect(FakeMessageChannel.created).toBe(createdBeforeRerender);
    expect(channel?.port1.close).not.toHaveBeenCalled();
  });

  it("sanitizes rejected or invalid host results before replying", async () => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    const onIntent = vi.fn(async () => {
      throw new Error("Bearer host-secret");
    });
    render(<CapsuleFrame html="<main>Product</main>" onIntent={onIntent} />);
    fireEvent.load(screen.getByTitle("Flect app"));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    const port = FakeMessageChannel.latest?.port1;
    port?.receive({ version: 1, type: "ready" });
    await waitFor(() =>
      expect(port?.posted).toContainEqual(
        expect.objectContaining({ type: "visibility" }),
      ),
    );
    port?.receive({
      version: 1,
      type: "intent",
      id: "intent-12345678",
      action: "projects.list",
      input: null,
    });

    await waitFor(() => expect(onIntent).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(port?.posted).toContainEqual({
        version: 1,
        type: "intent-result",
        id: "intent-12345678",
        ok: false,
        error: {
          code: "failed",
          message: "The product operation failed safely.",
        },
      }),
    );
    expect(JSON.stringify(port?.posted)).not.toContain("host-secret");
  });

  it("mounts a different capsule after the prior source fails closed", async () => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    const rendered = render(<CapsuleFrame html="<main>Broken</main>" />);
    await waitFor(() => expect(FakeMessageChannel.latest).toBeDefined());
    FakeMessageChannel.latest?.port1.receive({
      version: 2,
      type: "unknown",
    });
    await expect(
      screen.findByText("This Flect app was stopped safely."),
    ).resolves.toBeVisible();

    rendered.rerender(<CapsuleFrame html="<main>Replacement</main>" />);
    await waitFor(() =>
      expect(
        frameDocument(screen.getByTitle("Flect app") as HTMLIFrameElement),
      ).toContain("Replacement"),
    );
  });
});
