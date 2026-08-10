import { execFile } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { resetBrowserWorkspace } from "./reset-browser-workspace";

const browserFailures = new WeakMap<Page, Array<string>>();
const completedPromptPages = new WeakSet<Page>();
const runFile = promisify(execFile);

test.beforeEach(async ({ page }) => {
  const failures: Array<string> = [];
  browserFailures.set(page, failures);
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (
      request.method() === "POST" &&
      /\/api\/sessions\/session-browser-test-\d+\/shape$/.test(url) &&
      request.failure()?.errorText === "net::ERR_ABORTED"
    ) {
      return;
    }
    if (url.startsWith("http://127.0.0.1:")) {
      failures.push(
        `request: ${request.method()} ${url} ${request.failure()?.errorText ?? ""}`,
      );
    }
  });

  await resetBrowserWorkspace(page);
  await expect(
    page.getByRole("textbox", { name: "Message Shaper" }),
  ).toBeEnabled();
});

test.afterEach(async ({ page }) => {
  const failures = (browserFailures.get(page) ?? []).filter(
    (failure) =>
      !(
        completedPromptPages.has(page) &&
        /request: POST .*\/api\/sessions\/session-browser-test-\d+\/prompts net::ERR_ABORTED$/.test(
          failure,
        )
      ),
  );
  expect(failures).toEqual([]);
});

const shape = async (page: Page) => {
  const composer = page.getByRole("textbox", { name: "Message Shaper" });
  await composer.fill("Exercise embedded Shaper AXI");
  await composer.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Revision decision" }),
  ).toBeVisible();
};

const acceptAndRun = async (page: Page) => {
  await shape(page);
  await page.getByRole("button", { name: "Keep change" }).click();
  await page.getByRole("button", { name: "Use · App Agent" }).click();
};

test("Shaper validates and proposes through embedded flect but cannot accept", async ({
  page,
}) => {
  await shape(page);

  await expect(page.getByRole("button", { name: "Keep change" })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Use · App Agent" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("textbox", { name: "Message Preview App Agent" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Shape · Shaper" }).click();

  const activities = page.getByRole("button", { name: "Bash details" });
  await expect(activities).toHaveCount(2);
  await expect(activities.first()).toContainText("Completed");
  await expect(activities.first()).toContainText("40ms");
  await expect(activities.last()).toContainText("Failed");
  await expect(activities.last()).toContainText("2ms");
  await activities.first().click();
  await activities.last().click();
  await expect(
    page.locator(".activity-card__details code").first(),
  ).toContainText("flect interface validate /workspace/interface.json");
  await expect(
    page.locator(".activity-card__details pre").first(),
  ).toContainText("status: proposed");
  await expect(
    page.locator(".activity-card__details pre").last(),
  ).toContainText("code: unauthorized");
});

test("Shaper inspects its real proposal ref through reserved embedded Git", async ({
  page,
}) => {
  await shape(page);
  await page.getByRole("button", { name: "Shape · Shaper" }).click();
  const composer = page.getByRole("textbox", { name: "Message Shaper" });
  await composer.fill("Inspect embedded Git");
  await composer.press("Enter");

  const activity = page.getByRole("button", { name: "Bash details" }).nth(2);
  await expect(activity).toContainText("Completed");
  await activity.click();
  const output = page.locator(".activity-card__details pre").nth(2);
  await expect(output).toContainText("flect/proposal/");
  await expect(output).toContainText(/[0-9a-f]{40}/);
});

test("Shaper checkpoints staged source through embedded Wasm Git", async ({
  page,
}) => {
  await shape(page);
  await page.getByRole("button", { name: "Shape · Shaper" }).click();
  const composer = page.getByRole("textbox", { name: "Message Shaper" });
  await composer.fill("Commit Shaper source");
  await composer.press("Enter");

  await expect(
    page.getByRole("button", { name: "Use · App Agent" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Shape · Shaper" }).click();
  const activity = page.getByRole("button", { name: "Bash details" }).nth(2);
  await expect(activity).toContainText("Completed");
  await activity.click();
  const output = page.locator(".activity-card__details pre").nth(2);
  await expect(output).toContainText("[flect/authoring");
  await expect(output).toContainText("flect/authoring");
  await expect(output).toContainText(/[0-9a-f]{40}/);

  await page.getByRole("button", { name: "Keep change" }).click();
  await page.getByRole("button", { name: "Actions" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export source and history" })
    .click();
  const archive = await (await downloadPromise).path();
  expect(archive).not.toBeNull();
  if (archive === null) {
    throw new Error("Flect did not export its repository.");
  }
  const root = await mkdtemp(join(tmpdir(), "flect-authoring-export-"));
  const repository = join(root, "repository");
  await mkdir(repository, { recursive: true });
  await runFile("tar", ["-xf", archive, "-C", repository]);
  const source = await runFile("git", [
    "-C",
    repository,
    "show",
    "flect/accepted:shaped.ts",
  ]);
  expect(source.stdout).toBe("export const shaped = true;\n");
  const refs = await runFile("git", [
    "-C",
    repository,
    "rev-parse",
    "flect/accepted",
    "flect/authoring",
  ]);
  const [accepted, authoring] = refs.stdout.trim().split("\n");
  expect(authoring).toBe(accepted);
});

test("App Agent lists and invokes a visible product action through embedded flect", async ({
  page,
}) => {
  await acceptAndRun(page);

  const composer = page.getByRole("textbox", { name: "Message App Agent" });
  await composer.fill("Invoke the visible interface action");
  await composer.press("Enter");

  await expect(
    page.getByRole("button", { name: "Shape · Shaper" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Use · App Agent" }).click();
  const activity = page.getByRole("button", { name: "Bash details" });
  await expect(activity).toContainText("Completed");
  await activity.click();
  await expect(
    page.locator(".activity-card__details code").first(),
  ).toContainText("flect action list");
  await expect(page.locator(".activity-card__details pre")).toContainText(
    "shape-interface",
  );
  await expect(page.locator(".activity-card__details pre")).toContainText(
    "status: completed",
  );
  completedPromptPages.add(page);
});

test("App Agent authority and reserved-command identity fail closed", async ({
  page,
}) => {
  await acceptAndRun(page);
  const composer = page.getByRole("textbox", { name: "Message App Agent" });

  await composer.fill("Verify App Agent authority");
  await composer.press("Enter");
  let activity = page.getByRole("button", { name: "Bash details" }).last();
  await expect(activity).toContainText("Completed");
  await activity.click();
  await expect(
    page.locator(".activity-card__details pre").last(),
  ).toContainText("code: unauthorized");
  await expect(page.locator(".topbar .safe-mode")).toHaveCount(0);

  await composer.fill("Verify embedded shell composition");
  await composer.press("Enter");
  activity = page.getByRole("button", { name: "Bash details" }).last();
  await expect(activity).toContainText("Completed");
  await activity.click();
  const output = page.locator(".activity-card__details pre").last();
  await expect(output).toContainText("browser-embedded");
  await expect(output).not.toContainText("shaper");
  completedPromptPages.add(page);
});

test("role workspace source persists through OPFS across a page restart", async ({
  page,
}) => {
  await acceptAndRun(page);
  let composer = page.getByRole("textbox", { name: "Message App Agent" });
  await composer.fill("Write persistent workspace marker");
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Bash details" }).last(),
  ).toContainText("Completed");

  await page.reload();
  await page.getByRole("button", { name: "Use · App Agent" }).click();
  composer = page.getByRole("textbox", { name: "Message App Agent" });
  await composer.fill("Read persistent workspace marker");
  await composer.press("Enter");
  const activity = page.getByRole("button", { name: "Bash details" }).last();
  await expect(activity).toContainText("Completed");
  await activity.click();
  await expect(
    page.locator(".activity-card__details pre").last(),
  ).toContainText("opfs-role-workspace");
  completedPromptPages.add(page);
});

test("streamed embedded CLI activity does not steal manual scroll position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await acceptAndRun(page);
  const composer = page.getByRole("textbox", { name: "Message App Agent" });

  await composer.fill("Show the Markdown showcase");
  await composer.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Markdown showcase" }),
  ).toBeVisible();
  const conversation = page.getByRole("log", {
    name: "App Agent conversation",
  });
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await conversation.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });

  await composer.fill("Verify embedded shell composition");
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: /Jump to latest/ }),
  ).toBeVisible();
  expect(
    await conversation.evaluate((element) => element.scrollTop),
  ).toBeLessThan(50);
  completedPromptPages.add(page);
});
