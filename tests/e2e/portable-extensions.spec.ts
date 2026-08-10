import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { portableExtensionCapsule } from "../fixtures/portable-extensions/capsules";
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

const importCapsule = async (
  page: Page,
  archive: Uint8Array,
  name = "portable-extension.flect",
) => {
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Flect app" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name,
    mimeType: "application/vnd.flect",
    buffer: Buffer.from(archive),
  });
  const decision = page.getByRole("region", { name: "Revision decision" });
  await expect(decision).toBeVisible();
  return decision;
};

const acceptedExtensionSummary = (page: Page) =>
  page
    .locator("details.capsule-review > summary")
    .filter({ hasText: /^Portable extensions$/ });

const promptFinished = (page: Page) =>
  page.waitForEvent("requestfinished", {
    predicate: (request) =>
      request.method() === "POST" &&
      /\/api\/sessions\/[^/]+\/prompts$/.test(request.url()),
  });

test("reviews, tests, keeps, discovers, disables, and removes role-scoped packages", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const decision = await importCapsule(
    page,
    await portableExtensionCapsule({ variant: "noop" }),
  );

  await expect(decision.getByText("Unsigned")).toBeVisible();
  await expect(
    decision.getByRole("heading", { name: "Project guide" }),
  ).toBeVisible();
  await expect(
    decision.getByText("akua-dev · 1.0.0 · fixture-1.0.0-noop"),
  ).toBeVisible();
  await expect(
    decision.getByRole("group", { name: "App Agent" }),
  ).toBeVisible();
  await expect(decision.getByRole("group", { name: "Shaper" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include(".extension-review")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("portable-extension-review.png"),
  });

  const app = decision.getByRole("group", { name: "App Agent" });
  await expect(
    app.getByRole("checkbox", { name: "interface:read · required" }),
  ).toBeChecked();
  await expect(
    app.getByRole("checkbox", { name: "interface:propose · optional" }),
  ).not.toBeChecked();
  await app.getByRole("button", { name: "Enable for App Agent" }).click();
  await expect(
    app.getByRole("button", { name: "Test for App Agent" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep change" }),
  ).toBeDisabled();
  await app.getByRole("button", { name: "Test for App Agent" }).click();
  await expect(app.getByText("Testing App Agent complete.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Keep change" })).toBeEnabled();
  const previewComposer = page.getByRole("textbox", {
    name: "Message Preview App Agent",
  });
  await previewComposer.fill("Inspect portable extensions");
  const candidatePromptFinished = promptFinished(page);
  await previewComposer.press("Enter");
  const candidateActivity = page
    .getByRole("button", { name: "Bash details" })
    .last();
  await expect(candidateActivity).toContainText("Completed", {
    timeout: 30_000,
  });
  await candidateActivity.click();
  await expect(
    page.locator(".activity-card__details pre").last(),
  ).toContainText("binding: candidate");
  await expect(
    page.locator("form.composer").filter({ has: previewComposer }),
  ).toHaveAttribute("aria-busy", "false");
  await candidatePromptFinished;
  await page.getByRole("button", { name: "Keep change" }).click();

  const composer = page.getByRole("textbox", { name: "Message App Agent" });
  await composer.fill("Inspect portable extensions");
  const acceptedPromptFinished = promptFinished(page);
  await composer.press("Enter");
  const activity = page.getByRole("button", { name: "Bash details" }).last();
  await expect(activity).toContainText("Completed", { timeout: 30_000 });
  await activity.click();
  const output = page.locator(".activity-card__details pre").last();
  await expect(output).toContainText("project-guide");
  await expect(output).toContainText("intents: []");
  await expect(output).not.toContainText("public-summary");
  await expect(
    page.locator("form.composer").filter({ has: composer }),
  ).toHaveAttribute("aria-busy", "false");
  await acceptedPromptFinished;

  await acceptedExtensionSummary(page).click();
  const acceptedApp = page.getByRole("group", { name: "App Agent" });
  await acceptedApp
    .getByRole("button", { name: "Disable for App Agent" })
    .click();
  await expect(
    acceptedApp.getByRole("button", { name: "Enable for App Agent" }),
  ).toBeVisible();

  await acceptedApp.getByText("Version controls").click();
  await acceptedApp
    .getByRole("button", { name: "Remove from App Agent" })
    .click();
  await acceptedApp
    .getByRole("button", { name: "Confirm remove from App Agent" })
    .click();
  await expect(page.getByRole("group", { name: "App Agent" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Shaper" })).toBeVisible();
});

test("restores an accepted portable extension capsule after reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const decision = await importCapsule(
    page,
    await portableExtensionCapsule({ roles: ["app"], variant: "noop" }),
  );
  const app = decision.getByRole("group", { name: "App Agent" });
  await app.getByRole("button", { name: "Enable for App Agent" }).click();
  await app.getByRole("button", { name: "Test for App Agent" }).click();
  await expect(app.getByText("Testing App Agent complete.")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Keep change" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message App Agent" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page
      .frameLocator('iframe[title="Portable product"]')
      .getByRole("heading", { name: "Portable product" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "stopped safely" }),
  ).toHaveCount(0);
  await expect(acceptedExtensionSummary(page)).toBeVisible();
});

test("keeps the accepted baseline when a pinned update fails in its worker", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let decision = await importCapsule(
    page,
    await portableExtensionCapsule({ roles: ["app"], variant: "noop" }),
  );
  let app = decision.getByRole("group", { name: "App Agent" });
  await app.getByRole("button", { name: "Enable for App Agent" }).click();
  await app.getByRole("button", { name: "Test for App Agent" }).click();
  await expect(app.getByText("Testing App Agent complete.")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Keep change" }).click();

  await acceptedExtensionSummary(page).click();
  app = page.getByRole("group", { name: "App Agent" });
  await app.getByText("Version controls").click();
  const forkRevision = app.getByRole("textbox", {
    name: "Local fork revision for App Agent",
  });
  await forkRevision.fill("local-project-guide");
  await app.getByRole("button", { name: "Fork for App Agent" }).click();
  await expect(app.getByText(/fork local-project-guide/)).toBeVisible();
  await app.getByRole("button", { name: "Pin App Agent version" }).click();
  await expect(app.getByText(/pinned/)).toBeVisible();

  decision = await importCapsule(
    page,
    await portableExtensionCapsule({
      capsuleVersion: "1.1.0",
      extensionVersion: "1.1.0",
      roles: ["app"],
      variant: "broken",
    }),
    "broken-update.flect",
  );
  app = decision.getByRole("group", { name: "App Agent" });
  await expect(app.getByText(/Update conflict/)).toBeVisible();
  await app.getByRole("button", { name: "Use upstream for App Agent" }).click();
  await app.getByRole("button", { name: "Enable for App Agent" }).click();
  await app.getByRole("button", { name: "Test for App Agent" }).click();
  await expect(app.getByRole("alert")).toContainText(
    "The portable extension failed safely. Disable the extension or fix it in Shape.",
    { timeout: 30_000 },
  );
  await expect(page.getByText("fixture-private-detail")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Keep change" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(
    page
      .frameLocator('iframe[title="Portable product"]')
      .getByRole("heading", { name: "Portable product" }),
  ).toBeVisible();
});

test("fails network, storage, credential, flood, loop, memory, and oversized probes closed", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const escapedRequests: Array<string> = [];
  page.on("request", (request) => {
    if (request.url().includes("extension.invalid")) {
      escapedRequests.push(request.url());
    }
  });

  for (const variant of [
    "network",
    "storage",
    "credential",
    "flood",
    "loop",
    "memory",
  ] as const) {
    const decision = await importCapsule(
      page,
      await portableExtensionCapsule({ roles: ["app"], variant }),
      `${variant}.flect`,
    );
    const app = decision.getByRole("group", { name: "App Agent" });
    await app.getByRole("button", { name: "Enable for App Agent" }).click();
    await app.getByRole("button", { name: "Test for App Agent" }).click();
    await expect(app.getByRole("alert")).toContainText(
      "The portable extension failed safely.",
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("button", { name: "Keep change" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(decision).toHaveCount(0);
  }

  expect(escapedRequests).toEqual([]);
  await expect(
    portableExtensionCapsule({ roles: ["app"], variant: "oversized" }),
  ).rejects.toMatchObject({ _tag: "InvalidCapsule" });
  await expect(
    page.getByText(/fixture-private-key|FLECT_FIXTURE_SECRET/),
  ).toHaveCount(0);
});
