import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { resetBrowserWorkspace } from "./reset-browser-workspace";

const browserFailures = new WeakMap<Page, Array<string>>();

test.beforeEach(async ({ page }) => {
  const failures: Array<string> = [];
  browserFailures.set(page, failures);
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith("http://127.0.0.1:")) {
      failures.push(
        `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
      );
    }
  });
  await resetBrowserWorkspace(page);
  await expect(
    page.getByRole("textbox", { name: "Message Shaper" }),
  ).toBeEnabled();
});

test.afterEach(async ({ page }) => {
  expect(browserFailures.get(page) ?? []).toEqual([]);
});

const openUpdate = async (page: Page) => {
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(
    page.getByRole("region", { name: "Flect update" }),
  ).toBeVisible();
};

test("keeps browser updates explicit and non-authoritative", async ({
  page,
}) => {
  await openUpdate(page);
  await expect(
    page.getByText("Updates are available in a signed desktop release."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Install update" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Restart Flect" })).toHaveCount(
    0,
  );

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("keeps update ownership readable in the compact protected shell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await openUpdate(page);

  const geometry = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.documentWidth).toBe(geometry.viewportWidth);
  await expect(
    page.getByText("Updates are available in a signed desktop release."),
  ).toBeVisible();
});
