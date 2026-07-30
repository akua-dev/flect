import { expect, test } from "@playwright/test";

test("runs the browser Bun command and isolated preview in production Chromium", async ({
  page,
}) => {
  const errors: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?bun-diagnostic=1");

  const diagnostic = page.getByTestId("bun-diagnostic");
  await expect(diagnostic).toHaveAttribute("data-status", "passed", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("bun-run")).toHaveText("42");
  await expect(page.getByTestId("bun-packages")).toHaveText(
    "Installed 1 package.",
  );
  await expect(page.getByTestId("bun-preview-url")).toHaveText(
    "/preview/3417/",
  );

  const preview = page.frameLocator('iframe[title="Flect preview"]');
  await expect(preview.getByTestId("preview-heading")).toHaveText(
    "Flect preview",
  );
  await expect(preview.getByTestId("preview-path")).toHaveText("/");
  await expect(preview.getByTestId("network-denied")).toHaveText("true");
  await expect(preview.getByTestId("opfs-denied")).toHaveText("true");

  await page.getByRole("button", { name: "Stop preview" }).click();
  await expect(diagnostic).toHaveAttribute("data-status", "stopped");
  await expect(page.getByTestId("bun-stop")).toHaveText("disposed");

  await page.locator('iframe[title="Flect preview"]').evaluate((element) => {
    const frame = element as HTMLIFrameElement;
    frame.src = `${frame.src}?after-stop=1`;
  });
  await expect(preview.locator("body")).toContainText("Preview stopped.");
  expect(errors).toEqual([]);
});
