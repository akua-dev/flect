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
    .getByRole("textbox", { name: "Message Flect" })
    .fill("Are you ready?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(
    page.getByText("Flect’s protected test runtime is ready."),
  ).toBeVisible();
});

test("uses the protected composer controls in a real browser", async ({
  page,
}) => {
  const prompt = page.getByRole("textbox", { name: "Message Flect" });
  const send = page.getByRole("button", { name: "Send message" });

  await expect(page.getByRole("button", { name: "Actions" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Model: Auto via Pi" }),
  ).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: /Voice|Attach|Add context|Capabilities/i,
    }),
  ).toHaveCount(0);
  for (const name of ["Open", "Extensions", "Connect"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  }

  await page.getByRole("button", { name: "Actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Shape interface" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Roll back last change" }),
  ).toBeDisabled();
  await expect(page.getByText("No previous revision")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Model: Auto via Pi" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "Auto via Pi" }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("menuitemradio", {
      name: "Deterministic browser test by flect-test",
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Model: Deterministic browser test" }),
  ).toBeVisible();

  await prompt.fill("Test the protected composer");
  await expect(send).toBeEnabled();
  await send.click();
  const response = page.getByText("Flect’s protected test runtime is ready.");
  const stop = page.getByRole("button", { name: "Stop response" });
  await expect
    .poll(
      async () => {
        if (await response.isVisible()) {
          return "completed";
        }
        if (await stop.isVisible()) {
          return "streaming";
        }
        return "pending";
      },
      { message: "the protected composer should stream or complete" },
    )
    .not.toBe("pending");
  await expect(response).toBeVisible();
  await expect(stop).toBeHidden();
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
  await expect(page.getByLabel("Describe the interface change")).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeDisabled();

  await expect(
    page.getByRole("heading", { name: "Focused workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
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
  await page.getByRole("button", { name: "Shape interface" }).click();
  await expect(
    page.getByRole("button", { name: "Roll back last change" }),
  ).toHaveCount(0);
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
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toHaveAttribute("placeholder", "Build, change, or connect anything");
});

test("keeps the shell usable at a compact viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const composer = page.locator(".composer");
  await page.getByRole("button", { name: "Actions" }).click();
  const [composerBox, actionsBox] = await Promise.all([
    composer.boundingBox(),
    page.getByRole("menu", { name: "Flect actions" }).boundingBox(),
  ]);
  expect(composerBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(actionsBox?.y ?? 0).toBeGreaterThanOrEqual(
    (composerBox?.y ?? 0) + (composerBox?.height ?? 0),
  );
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Shape interface" }).click();
  await expect(page.getByLabel("Describe the interface change")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("promotes the Shaper to a protected inset at narrow desktop widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await page.getByRole("button", { name: "Shape interface" }).click();

  const panelBox = await page
    .getByRole("complementary", { name: "Interface Shaper" })
    .boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(6);
  expect(panelBox?.width ?? 0).toBeGreaterThanOrEqual(748);
});

test("supports keyboard submission and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Shape interface" }).click();

  const transitionDuration = await page
    .getByRole("button", { name: "Propose change" })
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transitionDuration).toBe("0s");

  await page.getByRole("button", { name: "Close interface Shaper" }).click();
  const prompt = page.getByRole("textbox", { name: "Message Flect" });
  await prompt.fill("Use the keyboard");
  await prompt.press("Enter");

  await expect(
    page.getByText("Flect’s protected test runtime is ready."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeVisible();
});
