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
import { PrivateShareSourceSummary } from "../../packages/product/src/host/share-source";
import { ShareSourceDialog } from "./share-source-dialog";

afterEach(cleanup);

describe("ShareSourceDialog", () => {
  it("submits a labeled HTTPS source and closes through the callback", async () => {
    const onOpenUrl = vi.fn(async () => undefined);
    render(
      <ShareSourceDialog
        onClose={vi.fn()}
        onOpenGit={vi.fn()}
        onOpenUrl={onOpenUrl}
        open
      />,
    );

    fireEvent.change(screen.getByLabelText("Shared file URL"), {
      target: { value: "https://example.test/weather.flect-share" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review source" }));

    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://example.test/weather.flect-share",
    );
  });

  it("requires an exact commit and rejects credential-bearing URLs", () => {
    render(
      <ShareSourceDialog
        onClose={vi.fn()}
        onOpenGit={vi.fn()}
        onOpenUrl={vi.fn()}
        open
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Public Git" }));
    fireEvent.change(screen.getByLabelText("Repository URL"), {
      target: { value: "https://token@example.test/weather.git" },
    });
    fireEvent.change(screen.getByLabelText("Exact commit"), {
      target: { value: "main" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review source" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a public HTTPS URL and a 40-character commit",
    );
  });

  it("moves through source tabs with arrow, Home, and End keys", () => {
    render(
      <ShareSourceDialog
        onClose={vi.fn()}
        onOpenGit={vi.fn()}
        onOpenPrivate={vi.fn()}
        onOpenUrl={vi.fn()}
        open
        privateSources={[
          PrivateShareSourceSummary.make({
            id: "company-share",
            name: "Company library",
          }),
        ]}
      />,
    );

    const shared = screen.getByRole("tab", { name: "Shared file" });
    const git = screen.getByRole("tab", { name: "Public Git" });
    const privateSource = screen.getByRole("tab", { name: "Private source" });
    shared.focus();
    fireEvent.keyDown(shared, { key: "ArrowRight" });
    expect(git).toHaveFocus();
    expect(git).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(git, { key: "End" });
    expect(privateSource).toHaveFocus();
    expect(privateSource).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(privateSource, { key: "Home" });
    expect(shared).toHaveFocus();
    fireEvent.keyDown(shared, { key: "ArrowLeft" });
    expect(privateSource).toHaveFocus();
  });

  it("returns focus to the control that opened it", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Actions";
    document.body.append(opener);
    opener.focus();

    const props = {
      onClose: vi.fn(),
      onOpenGit: vi.fn(),
      onOpenUrl: vi.fn(),
    };
    const { rerender } = render(<ShareSourceDialog {...props} open={false} />);
    rerender(<ShareSourceDialog {...props} open />);

    await waitFor(() =>
      expect(screen.getByLabelText("Shared file URL")).toHaveFocus(),
    );
    rerender(<ShareSourceDialog {...props} open={false} />);

    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  it("opens an opaque private reference only after replacing an existing candidate", async () => {
    const onOpenPrivate = vi.fn(async () => undefined);
    render(
      <ShareSourceDialog
        candidateOpen
        onClose={vi.fn()}
        onOpenGit={vi.fn()}
        onOpenPrivate={onOpenPrivate}
        onOpenUrl={vi.fn()}
        open
        privateSources={[
          PrivateShareSourceSummary.make({
            id: "company-share",
            name: "Company library",
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Private source" }));
    fireEvent.change(screen.getByLabelText("Private reference"), {
      target: { value: "designs/weather" },
    });
    expect(
      screen.getByRole("button", { name: "Review source" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("checkbox", { name: /replace the inactive candidate/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review source" }));

    await waitFor(() =>
      expect(onOpenPrivate).toHaveBeenCalledWith(
        "company-share",
        "designs/weather",
      ),
    );
  });
});
