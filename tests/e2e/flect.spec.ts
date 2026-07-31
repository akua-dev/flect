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
  await expect(
    page.getByRole("textbox", { name: "Message Shaper" }),
  ).toBeEnabled();
});

test.afterEach(async ({ page }) => {
  expect(browserFailures.get(page) ?? []).toEqual([]);
});

const shapeFirstInterface = async (page: Page) => {
  const input = page.getByRole("textbox", { name: "Message Shaper" });
  await input.evaluate((element) => {
    element.dataset.composerIdentity = "original";
  });
  await input.fill("Create a focused project overview");
  await input.press("Enter");

  await expect(page.locator(".role-shell")).toHaveClass(/role-shell--split/);
  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Revision decision" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Shaper" }),
  ).toHaveAttribute("data-composer-identity", "original");
};

test("routes a blank workspace to Shaper and moves the same composer", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "What should we shape?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit · Shaper" }),
  ).toHaveAttribute("aria-pressed", "true");

  await shapeFirstInterface(page);

  await expect(
    page.getByText("Preview ready: Focused project overview"),
  ).toBeVisible();
  await expect(page.getByText("Shaper used its sandbox.")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message App Agent" }),
  ).toHaveCount(0);
});

test("keeps a revision, enters Run, and separates App and Shaper history", async ({
  page,
}) => {
  await shapeFirstInterface(page);
  await page.getByRole("button", { name: "Keep change" }).click();
  await page.getByRole("button", { name: "Run · App Agent" }).click();

  const appInput = page.getByRole("textbox", { name: "Message App Agent" });
  await appInput.fill("Open the latest project");
  await appInput.press("Enter");
  await expect(page.getByText("The product action completed.")).toBeVisible();
  await expect(page.getByText("App Agent used its sandbox.")).toBeVisible();

  await page.getByRole("button", { name: "Edit · Shaper" }).click();
  await expect(
    page.getByText("Preview ready: Focused project overview"),
  ).toBeVisible();
  await expect(page.getByText("The product action completed.")).toHaveCount(0);

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message App Agent" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run · App Agent" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("rejects and rolls back revisions without replacing accepted state early", async ({
  page,
}) => {
  await shapeFirstInterface(page);
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(
    page.getByRole("heading", { name: "What should we shape?" }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Message Shaper" })
    .fill("Create it again");
  await page.getByRole("button", { name: "Send to Shaper" }).click();
  await expect(
    page.getByRole("region", { name: "Revision decision" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep change" }).click();
  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Roll back last change" }).click();

  await expect(
    page.getByRole("heading", { name: "What should we shape?" }),
  ).toBeVisible();
});

test("supports model search, keyboard resizing, collapse, and focus restoration", async ({
  page,
}) => {
  await shapeFirstInterface(page);
  await page.getByRole("button", { name: "Keep change" }).click();
  await page.getByRole("button", { name: "Model: Auto via Pi" }).click();
  await page.getByRole("searchbox", { name: "Search models" }).fill("determin");
  await page
    .getByRole("menuitemradio", {
      name: "Deterministic browser test by flect-test",
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Model: Deterministic browser test" }),
  ).toBeVisible();

  const separator = page.getByRole("separator", {
    name: "Resize agent panel",
  });
  await separator.focus();
  await separator.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "520");

  await page.getByRole("button", { name: "Collapse agent" }).click();
  const reopen = page.getByRole("button", { name: "Open Flect agent" });
  await expect(reopen).toBeFocused();
  await reopen.click();
  await expect(
    page.getByRole("button", { name: "Collapse agent" }),
  ).toBeFocused();
});

test("uses right and full-height sheets at compact breakpoints", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await shapeFirstInterface(page);

  const sheet = page.locator(".agent-rail-container");
  const desktopSheetBox = await sheet.boundingBox();
  expect(desktopSheetBox).not.toBeNull();
  expect(desktopSheetBox?.x ?? 0).toBeGreaterThan(350);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open Flect agent" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Open Flect agent" }).click();
  await page.setViewportSize({ width: 720, height: 780 });
  const mobileSheetBox = await sheet.boundingBox();
  expect(mobileSheetBox?.x).toBe(0);
  expect(mobileSheetBox?.width).toBe(720);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});

test("keeps safe mode and promptless products inside the protected shell", async ({
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
    page.getByRole("complementary", { name: "Flect agent" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message App Agent" }),
  ).toBeVisible();

  await page.goto("/?safe=1");
  await expect(
    page.locator(".topbar").getByText("Safe mode", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Custom interface state is bypassed."),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Shaper" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Restore interface" }),
  ).toBeVisible();
});

test("supports keyboard shaping and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".role-shell")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );

  const input = page.getByRole("textbox", { name: "Message Shaper" });
  await input.fill("Use the keyboard");
  await input.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep change" })).toBeVisible();
});
