import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

type ResetBrowserWorkspaceOptions = {
  readonly viewOnly?: boolean;
};

export const resetBrowserWorkspace = async (
  page: Page,
  options: ResetBrowserWorkspaceOptions = {},
) => {
  await page.goto("/?storage-reset-diagnostic=1");
  await expect(page.getByTestId("storage-reset-diagnostic")).toHaveAttribute(
    "data-state",
    "complete",
  );
  const workspace = `e2e-${randomUUID().replaceAll("-", "")}`;
  const query = new URLSearchParams({ workspace });
  if (options.viewOnly === true) query.set("view", "1");
  await page.goto(`/?${query.toString()}`);
};
