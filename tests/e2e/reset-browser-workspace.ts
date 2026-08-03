import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const resetBrowserWorkspace = async (page: Page) => {
  await page.goto("/?storage-reset-diagnostic=1");
  await expect(page.getByTestId("storage-reset-diagnostic")).toHaveAttribute(
    "data-state",
    "complete",
  );
  const workspace = `e2e-${randomUUID().replaceAll("-", "")}`;
  await page.goto(`/?workspace=${workspace}`);
};
