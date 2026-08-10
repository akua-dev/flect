import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { resetBrowserWorkspace } from "./reset-browser-workspace";

const wcagTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

const expectAccessible = async (page: Page, state: string) => {
  const result = await new AxeBuilder({ page })
    .withTags([...wcagTags])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
    `${state} must pass the mandatory WCAG A/AA audit`,
  ).toEqual([]);
};

const shapeCandidate = async (page: Page) => {
  await expect(page.locator("html")).toHaveAttribute(
    "data-flect-state",
    "active",
  );
  const composer = page.getByRole("textbox", { name: "Message Flect" });
  await composer.fill("Create an accessible project overview");
  await composer.press("Enter");
  await expect(
    page.getByRole("region", { name: "Focused project overview" }),
  ).toBeVisible();
  await expect(composer).toBeEnabled();
};

test.beforeEach(async ({ page }) => {
  await resetBrowserWorkspace(page);
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeEnabled();
});

test("gates blank, candidate, accepted, Diagnostics, model, and safe states", async ({
  page,
}) => {
  await expectAccessible(page, "blank Shape workbench");

  await shapeCandidate(page);
  await expectAccessible(page, "live canvas workbench");

  await page.getByRole("button", { name: "Actions" }).click();
  await expectAccessible(page, "extension and recovery actions menu");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(page.getByText("Workspace storage")).toBeVisible();
  await expect(
    page.getByText(
      "Source history and compiled interfaces are durable in this browser.",
    ),
  ).toBeVisible();
  await expectAccessible(page, "Diagnostics disclosure");
  await page.getByRole("button", { name: "Diagnostics" }).click();

  await page.getByRole("button", { name: "Model: Auto via Pi" }).click();
  await expectAccessible(page, "model chooser dialog");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Safe mode" }).click();
  await expectAccessible(page, "protected recovery");
});

test.describe("adaptive appearances", () => {
  for (const colorScheme of ["dark", "light"] as const) {
    test(`${colorScheme} appearance passes WCAG and remains contained`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      await page.reload();
      await shapeCandidate(page);
      await expectAccessible(page, `${colorScheme} live canvas workbench`);

      const geometry = await page.evaluate(() => ({
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(geometry.colorScheme).toContain(colorScheme);
      expect(geometry.documentWidth).toBe(geometry.viewportWidth);
      await page.screenshot({
        path: testInfo.outputPath(`${colorScheme}-candidate.png`),
      });
    });
  }
});

test("reflows at the 200 percent page-zoom viewport equivalent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await shapeCandidate(page);

  const geometry = await page.evaluate(() => ({
    composerCount: document.querySelectorAll(".composer").length,
    documentWidth: document.documentElement.scrollWidth,
    shellWidth: document.querySelector(".role-shell")?.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.documentWidth).toBe(geometry.viewportWidth);
  expect(geometry.shellWidth).toBe(geometry.viewportWidth);
  expect(geometry.composerCount).toBe(1);
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeVisible();
  await expectAccessible(page, "200 percent page-zoom equivalent workbench");
});

test("reflows at 320 px, 200 percent text, reduced motion, and forced colors", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({
    colorScheme: "light",
    forcedColors: "active",
    reducedMotion: "reduce",
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await shapeCandidate(page);
  await expectAccessible(page, "320px forced-colors candidate workbench");

  const geometry = await page.evaluate(() => {
    const composer = document.querySelector(".composer");
    const shell = document.querySelector(".role-shell");
    if (!(composer instanceof HTMLElement) || !(shell instanceof HTMLElement)) {
      throw new Error("Protected reflow targets are missing");
    }
    const composerBox = composer.getBoundingClientRect();
    return {
      composerLeft: composerBox.left,
      composerRight: composerBox.right,
      documentWidth: document.documentElement.scrollWidth,
      shellWidth: shell.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.documentWidth).toBe(geometry.viewportWidth);
  expect(geometry.shellWidth).toBe(geometry.viewportWidth);
  expect(geometry.composerLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.composerRight).toBeLessThanOrEqual(geometry.viewportWidth);
  await expect(page.locator(".composer")).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Open safe mode" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("compact-forced-colors.png"),
  });
});
