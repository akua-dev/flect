// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ShareInstallationRecord,
  ShareInstallationRefs,
  ShareInstalledArtifact,
  ShareLocalInstallationSource,
} from "../../shared/share-installation";
import { ShareLibrary } from "./share-library";

afterEach(cleanup);

const hash = "a".repeat(64);
const commit = "b".repeat(40);
const record = (shareId: string, installed: boolean) =>
  ShareInstallationRecord.make({
    formatVersion: 1,
    shareId,
    version: "1.0.0",
    source: ShareLocalInstallationSource.make({
      _tag: "local",
      archiveSha256: hash,
    }),
    manifestSha256: hash,
    repositorySha256: hash,
    artifacts: [
      ShareInstalledArtifact.make({
        id: `${shareId}.component`,
        kind: "component",
        version: "1.0.0",
        contentSha256: hash,
      }),
    ],
    installedArtifactIds: installed ? [`${shareId}.component`] : [],
    refs: ShareInstallationRefs.make({
      base: commit,
      upstream: commit,
      fork: commit,
    }),
    createdAt: 1,
    updatedAt: 2,
  });

describe("ShareLibrary", () => {
  it("distinguishes installed sources from retained local forks", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ShareLibrary
        entries={[
          record("dev.flect.installed", true),
          record("dev.flect.retained", false),
        ]}
        onClose={onClose}
        onDelete={vi.fn(() => Promise.resolve())}
        onExport={vi.fn(() => Promise.resolve())}
        onRemove={vi.fn(() => Promise.resolve())}
        open
      />,
    );

    expect(screen.getByText("1 part in app")).toBeVisible();
    expect(screen.getByText("Kept locally")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Remove dev.flect.installed from app",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Delete local data for dev.flect.retained",
      }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Close shared sources" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires a second explicit decision before removal or deletion", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn(() => Promise.resolve());
    const onDelete = vi.fn(() => Promise.resolve());
    render(
      <ShareLibrary
        entries={[
          record("dev.flect.installed", true),
          record("dev.flect.retained", false),
        ]}
        onClose={vi.fn()}
        onDelete={onDelete}
        onExport={vi.fn(() => Promise.resolve())}
        onRemove={onRemove}
        open
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Remove dev.flect.installed from app",
      }),
    );
    expect(onRemove).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", {
        name: "Confirm remove dev.flect.installed",
      }),
    );
    expect(onRemove).toHaveBeenCalledWith("dev.flect.installed");

    await user.click(
      screen.getByRole("button", {
        name: "Delete local data for dev.flect.retained",
      }),
    );
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", {
        name: "Confirm delete dev.flect.retained",
      }),
    );
    expect(onDelete).toHaveBeenCalledWith("dev.flect.retained", commit);
  });
});
