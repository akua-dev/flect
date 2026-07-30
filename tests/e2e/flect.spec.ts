import { expect, type Page, test } from "@playwright/test";
import { defaultInterfaceDocument } from "../../shared/interface-document";

const browserFailures = new WeakMap<Page, Array<string>>();

test.beforeEach(async ({ page }) => {
  const failures: Array<string> = [];
  browserFailures.set(page, failures);
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    failures.push(`page: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.startsWith("http://127.0.0.1:")) {
      failures.push(
        `request: ${request.method()} ${url} ${request.failure()?.errorText ?? ""}`,
      );
    }
  });

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText("Pi ready")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(browserFailures.get(page) ?? []).toEqual([]);
});

test("streams a Pi turn in a real browser", async ({ page }) => {
  await page
    .getByRole("textbox", { name: "Describe what to shape" })
    .fill("Are you ready?");
  await page.getByRole("button", { name: "Shape", exact: true }).click();

  await expect(
    page.getByText("Flect’s protected test runtime is ready."),
  ).toBeVisible();
});

test("previews, accepts, persists, and safely bypasses a shaped UI", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Shape interface" }).click();
  await expect(
    page.getByRole("complementary", { name: "Interface Shaper" }),
  ).toBeVisible();
  await expect(page.getByText("Extensions isolated")).toBeVisible({
    timeout: 15_000,
  });

  await page
    .getByLabel("Describe the interface change")
    .fill("Make the headline say Focused workspace");
  await page.getByRole("button", { name: "Propose change" }).click();
  await expect(
    page.getByRole("textbox", { name: "Describe what to shape" }),
  ).toBeDisabled();

  await expect(
    page.getByRole("heading", { name: "Focused workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Describe what to shape" }),
  ).toBeEnabled();
  await expect(page.getByText("Previewing a validated proposal")).toBeVisible();
  await page.getByRole("button", { name: "Keep change" }).click();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Focused workspace" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Shape interface" }).click();
  await page.getByRole("button", { name: "Roll back last change" }).click();
  await expect(
    page.getByRole("heading", { name: "What should we shape?" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What should we shape?" }),
  ).toBeVisible();

  await page.goto("/?safe=1");
  await expect(page.getByText("Safe mode", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What should we shape?" }),
  ).toBeVisible();
  await expect(
    page.getByText("Custom interface state is bypassed."),
  ).toBeVisible();
});

test("rejects a preview without changing the active interface", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Shape interface" }).click();
  const instruction = page.getByLabel("Describe the interface change");
  await instruction.fill("Make the headline say Focused workspace");
  await page.getByRole("button", { name: "Propose change" }).click();

  await expect(
    page.getByRole("heading", { name: "Focused workspace" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reject" }).click();

  await expect(
    page.getByRole("heading", { name: "What should we shape?" }),
  ).toBeVisible();
  await expect(instruction).toBeFocused();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What should we shape?" }),
  ).toBeVisible();
});

test("recovers a corrupt journal through the compiled launcher", async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.setItem("flect.revisions.v1", "{not-json");
  });
  await page.reload();

  await expect(page.getByText("Safe mode", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What should we shape?" }),
  ).toBeVisible();
  await expect(
    page.getByText("Custom interface state is bypassed."),
  ).toBeVisible();
});

test("keeps the protected composer when a valid custom UI omits its prompt", async ({
  page,
}) => {
  const promptlessDocument = {
    version: 2 as const,
    name: "Read-only dashboard",
    root: {
      id: "dashboard",
      type: "stack" as const,
      direction: "column" as const,
      gap: "lg" as const,
      children: [
        {
          id: "dashboard-headline",
          type: "text" as const,
          text: "Read-only dashboard",
          style: "headline" as const,
        },
      ],
    },
  };
  await page.evaluate(
    ({ builtIn, promptless }) => {
      localStorage.setItem(
        "flect.revisions.v1",
        JSON.stringify({
          version: 1,
          active: {
            version: 1,
            id: "promptless",
            parentId: "built-in",
            status: "accepted",
            source: "user",
            document: promptless,
            createdAt: 1,
          },
          lastKnownGood: {
            version: 1,
            id: "built-in",
            status: "accepted",
            source: "built-in",
            document: builtIn,
            createdAt: 0,
          },
          safeMode: false,
          disabledExtensions: [],
          lastEvent: {
            version: 1,
            sequence: 1,
            type: "revision-accepted",
            revisionId: "promptless",
          },
        }),
      );
    },
    { builtIn: defaultInterfaceDocument, promptless: promptlessDocument },
  );
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Read-only dashboard" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Describe what to shape" }),
  ).toHaveAttribute("placeholder", "Build, change, or connect anything");
});

test("keeps the shell usable at a compact viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Shape interface" }).click();
  await expect(page.getByLabel("Describe the interface change")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("supports keyboard submission and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Shape interface" }).click();

  const transitionDuration = await page
    .getByRole("button", { name: "Propose change" })
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transitionDuration).toBe("0s");

  await page.getByRole("button", { name: "Close interface Shaper" }).click();
  const prompt = page.getByRole("textbox", { name: "Describe what to shape" });
  await prompt.fill("Use the keyboard");
  await prompt.press("Enter");

  await expect(
    page.getByText("Flect’s protected test runtime is ready."),
  ).toBeVisible();
});
