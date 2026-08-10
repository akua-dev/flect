// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PortableExtensionFailure,
  PortableExtensionPackage,
  PortableExtensionRoleState,
} from "../../shared/extensions";
import { ExtensionReview } from "./extension-review";

afterEach(cleanup);

const extension = PortableExtensionPackage.make({
  formatVersion: 1,
  id: "project-guide",
  name: "Project guide",
  description: "Adds a bounded project summary command.",
  version: "1.2.0",
  bundle: "extensions/project-guide.mjs",
  roles: ["app", "shaper"],
  compatibility: {
    flect: ">=0.2.0 <1.0.0",
    extensionApi: 1,
    platforms: ["browser", "macos"],
  },
  capabilities: [
    { id: "interface:read", required: true },
    { id: "interface:propose", required: false },
  ],
  publicInstructions: "Use only when asked for a project summary.",
  commands: [
    {
      id: "summary",
      name: "Summary",
      description: "Summarize the current project.",
    },
  ],
  tools: [],
  resources: {
    deadlineMs: 80,
    memoryBytes: 4 * 1024 * 1024,
    inputBytes: 8 * 1024,
    outputBytes: 16 * 1024,
    maxIntents: 3,
  },
  provenance: {
    publisher: "Akua",
    source: "https://github.com/akua-dev/project-guide",
    revision: "abc123",
    bundleSha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
});

const entry = (
  role: "app" | "shaper",
  state: PortableExtensionRoleState["state"] = "available",
) =>
  PortableExtensionRoleState.make({
    version: 1,
    capsuleId: "dev.akua.project-guide",
    extensionId: extension.id,
    packageVersion: extension.version,
    bundleSha256: extension.provenance.bundleSha256,
    provenanceRevision: extension.provenance.revision,
    role,
    binding: "candidate",
    state,
    requestedCapabilities: ["interface:read", "interface:propose"],
    requiredCapabilities: ["interface:read"],
    grantedCapabilities: [],
    pinned: false,
    tested: false,
    failureCount: 0,
  });

const callbacks = () => ({
  onSetEnabled: vi.fn(() => Promise.resolve()),
  onTest: vi.fn(() => Promise.resolve()),
  onSetPinned: vi.fn(() => Promise.resolve()),
  onFork: vi.fn(() => Promise.resolve()),
  onResolveUpdate: vi.fn(() => Promise.resolve()),
  onRemove: vi.fn(() => Promise.resolve()),
});

describe("ExtensionReview", () => {
  it("exposes provenance, roles, requested authority, and bounded resources", () => {
    render(
      <ExtensionReview
        binding="candidate"
        capsuleId="dev.akua.project-guide"
        entries={[entry("app"), entry("shaper")]}
        packages={[extension]}
        {...callbacks()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Project guide" }),
    ).toBeVisible();
    expect(screen.getByText("Akua · 1.2.0 · abc123")).toBeVisible();
    expect(screen.getByText(extension.provenance.source)).toBeVisible();
    expect(screen.getByText("App Agent")).toBeVisible();
    expect(screen.getByText("Shaper")).toBeVisible();
    expect(screen.getAllByText("interface:read · required")).toHaveLength(2);
    expect(screen.getAllByText("interface:propose · optional")).toHaveLength(2);
    expect(screen.getByText(/80 ms deadline/i)).toBeVisible();
    expect(screen.getByText(/4 MiB memory/i)).toBeVisible();
  });

  it("requires an explicit per-role enable action and keeps optional grants off by default", async () => {
    const actions = callbacks();
    render(
      <ExtensionReview
        binding="candidate"
        capsuleId="dev.akua.project-guide"
        entries={[entry("app"), entry("shaper")]}
        packages={[extension]}
        {...actions}
      />,
    );

    const app = screen.getByRole("group", { name: "App Agent" });
    expect(
      within(app).getByRole("checkbox", { name: /interface:read/i }),
    ).toBeChecked();
    expect(
      within(app).getByRole("checkbox", { name: /interface:read/i }),
    ).toBeDisabled();
    expect(
      within(app).getByRole("checkbox", { name: /interface:propose/i }),
    ).not.toBeChecked();

    await userEvent.click(
      within(app).getByRole("button", { name: "Enable for App Agent" }),
    );
    expect(actions.onSetEnabled).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: "project-guide",
        role: "app",
        binding: "candidate",
      }),
      true,
      ["interface:read"],
    );
  });

  it("makes candidate testing visible and reports a safe extension failure", async () => {
    const actions = callbacks();
    const failed = PortableExtensionRoleState.make({
      ...entry("app", "failed"),
      grantedCapabilities: ["interface:read"],
      failureCount: 1,
      failure: PortableExtensionFailure.make({
        version: 1,
        reason: "execution",
        message: "The portable extension failed safely.",
        recovery: "Disable the extension or ask Flect to fix it.",
      }),
    });
    render(
      <ExtensionReview
        binding="candidate"
        capsuleId="dev.akua.project-guide"
        entries={[failed]}
        packages={[extension]}
        {...actions}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The portable extension failed safely. Disable the extension or ask Flect to fix it.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Test for App Agent" }),
    );
    expect(actions.onTest).toHaveBeenCalledWith(
      expect.objectContaining({ extensionId: "project-guide", role: "app" }),
    );
  });

  it("offers pin, fork, conflict recovery, and confirmed removal", async () => {
    const actions = callbacks();
    const conflicted = PortableExtensionRoleState.make({
      ...entry("shaper", "conflict"),
      grantedCapabilities: ["interface:read"],
      forkRevision: "local-a",
    });
    render(
      <ExtensionReview
        binding="candidate"
        capsuleId="dev.akua.project-guide"
        entries={[conflicted]}
        packages={[extension]}
        {...actions}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Pin Shaper version" }),
    );
    expect(actions.onSetPinned).toHaveBeenCalledWith(
      expect.objectContaining({ role: "shaper" }),
      true,
    );

    const revision = screen.getByRole("textbox", {
      name: "Local fork revision for Shaper",
    });
    await userEvent.clear(revision);
    await userEvent.type(revision, "local-b");
    await userEvent.click(
      screen.getByRole("button", { name: "Fork for Shaper" }),
    );
    expect(actions.onFork).toHaveBeenCalledWith(
      expect.objectContaining({ role: "shaper" }),
      "local-b",
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Use upstream for Shaper" }),
    );
    expect(actions.onResolveUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ role: "shaper" }),
      "upstream",
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Remove from Shaper" }),
    );
    expect(screen.getByText("Removal needs confirmation.")).toHaveAttribute(
      "role",
      "status",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm remove from Shaper" }),
    );
    expect(actions.onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ role: "shaper" }),
    );
  });
});
