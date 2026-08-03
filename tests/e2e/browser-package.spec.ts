import { expect, test } from "@playwright/test";

test("reuses an integrity-checked browser package graph offline and after reload", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(
    `/?package-diagnostic=1&workspace=package-${Date.now().toString(36)}`,
  );

  const result = page.getByTestId("browser-package-result");
  await expect(result).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await expect(result).toHaveAttribute("data-cache-hit", "false");
  await expect(result).toHaveAttribute("data-registry-calls", "2");

  await context.setOffline(true);
  await page.getByRole("button", { name: "Verify cached resolution" }).click();
  await expect(result).toHaveAttribute("data-state", "complete");
  await expect(result).toHaveAttribute("data-cache-hit", "true");
  await expect(result).toHaveAttribute("data-registry-calls", "2");

  await context.setOffline(false);
  await page.reload();
  await expect(result).toHaveAttribute("data-state", "complete", {
    timeout: 30_000,
  });
  await expect(result).toHaveAttribute("data-restored", "reopened");
  await expect(result).toHaveAttribute("data-registry-calls", "0");
});
