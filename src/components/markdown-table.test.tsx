// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clipboard } from "../lib/clipboard";
import { MarkdownTable } from "./markdown-table";

const clipboardHarness = vi.hoisted(() => ({
  fail: false,
  writes: [] as Array<string>,
}));

vi.mock("../lib/runtime", async () => {
  const { Effect, Layer } = await import("effect");
  const { Clipboard, ClipboardWriteError } = await import("../lib/clipboard");
  const ClipboardTest = Layer.succeed(Clipboard)({
    writeText: (value: string) =>
      Effect.try({
        try: () => {
          if (clipboardHarness.fail) {
            throw new Error("permission denied");
          }
          clipboardHarness.writes.push(value);
        },
        catch: () =>
          ClipboardWriteError.make({
            message: "Flect could not copy this content.",
          }),
      }),
  });
  return {
    browserRuntime: {
      runPromiseExit: <A, E>(effect: Effect.Effect<A, E, Clipboard>) =>
        Effect.runPromiseExit(effect.pipe(Effect.provide(ClipboardTest))),
    },
  };
});

beforeEach(() => {
  clipboardHarness.fail = false;
  clipboardHarness.writes = [];
});

afterEach(cleanup);

const renderTable = () =>
  render(
    <MarkdownTable>
      <thead>
        <tr>
          <th>Name</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Flect</td>
          <td>A, B</td>
        </tr>
      </tbody>
    </MarkdownTable>,
  );

describe("MarkdownTable", () => {
  it("renders semantic cells, expands, and copies both formats", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("cell")).toHaveLength(2);

    const wrapper = container.querySelector(".markdown-table");
    expect(wrapper).toHaveAttribute("data-expanded", "false");
    await user.click(
      screen.getByRole("button", { name: "Expand table cells" }),
    );
    expect(wrapper).toHaveAttribute("data-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Collapse table cells" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(
      screen.getByRole("button", { name: "Copy table as Markdown" }),
    );
    await waitFor(() =>
      expect(clipboardHarness.writes).toEqual([
        "| Name | Note |\n| --- | --- |\n| Flect | A, B |",
      ]),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Copied Markdown");

    await user.click(screen.getByRole("button", { name: "Copy table as CSV" }));
    await waitFor(() =>
      expect(clipboardHarness.writes).toEqual([
        "| Name | Note |\n| --- | --- |\n| Flect | A, B |",
        'Name,Note\r\nFlect,"A, B"',
      ]),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Copied CSV");
  });

  it("announces clipboard failure without changing table focus behavior", async () => {
    clipboardHarness.fail = true;
    const user = userEvent.setup();
    renderTable();

    const copy = screen.getByRole("button", {
      name: "Copy table as Markdown",
    });
    copy.focus();
    await user.click(copy);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Copy failed"),
    );
    expect(copy).toHaveFocus();
  });
});
