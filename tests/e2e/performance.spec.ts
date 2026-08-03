import { expect, type Page, test } from "@playwright/test";
import { FlectPerformanceBudgets } from "../../shared/performance-budgets";
import { resetBrowserWorkspace } from "./reset-browser-workspace";

const budget = FlectPerformanceBudgets.browser;

const report = (metrics: Readonly<Record<string, number>>) => {
  console.log(JSON.stringify({ type: "flect-performance", ...metrics }));
};

const elapsed = async <A>(use: () => Promise<A>) => {
  const startedAt = performance.now();
  const value = await use();
  return { durationMs: performance.now() - startedAt, value };
};

const reset = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await resetBrowserWorkspace(page);
  const startup = await elapsed(async () => {
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Message Shaper" }),
    ).toBeEnabled();
  });
  await session.detach();
  return startup.durationMs;
};

const heapUsed = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  await session.send("HeapProfiler.collectGarbage");
  const response = await session.send("Performance.getMetrics");
  await session.detach();
  return response.metrics.find((metric) => metric.name === "JSHeapUsedSize")
    ?.value;
};

const shape = async (page: Page, instruction: string) => {
  const input = page.getByRole("textbox", { name: "Message Shaper" });
  await input.fill(instruction);
  const result = await elapsed(async () => {
    await input.press("Enter");
    await expect(
      page.getByRole("region", { name: "Revision decision" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Message Preview App Agent" }),
    ).toBeEnabled();
  });
  expect(result.durationMs, "candidate rebuild milliseconds").toBeLessThan(
    budget.candidateRebuildMs,
  );
};

test("enforces production startup, transfer, interaction, and warm-switch budgets", async ({
  page,
}) => {
  const startupMs = await reset(page);
  expect(startupMs, "interactive startup milliseconds").toBeLessThan(
    budget.interactiveStartupMs,
  );

  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      return {
        decoded: resource.decodedBodySize,
        transfer: resource.transferSize,
      };
    }),
  );
  const transferBytes = resources.reduce(
    (total, resource) => total + resource.transfer,
    0,
  );
  const decodedBytes = resources.reduce(
    (total, resource) => total + resource.decoded,
    0,
  );
  expect(transferBytes, "initial transfer bytes").toBeLessThanOrEqual(
    budget.initialTransferBytes,
  );
  expect(decodedBytes, "initial decoded bytes").toBeLessThanOrEqual(
    budget.initialDecodedBytes,
  );

  const modelMenu = await elapsed(async () => {
    await page.getByRole("button", { name: "Model: Auto via Pi" }).click();
    await expect(
      page.getByRole("dialog", { name: "Choose model" }),
    ).toBeVisible();
  });
  expect(modelMenu.durationMs, "model menu milliseconds").toBeLessThan(
    budget.modelMenuMs,
  );
  await page.keyboard.press("Escape");

  const input = page.getByRole("textbox", { name: "Message Shaper" });
  const inputTiming = await elapsed(() => input.fill("performance probe"));
  expect(inputTiming.durationMs, "composer input milliseconds").toBeLessThan(
    budget.composerInputMs,
  );
  await input.fill("");
  await shape(page, "Create a focused project overview");

  const switchDurations: Array<number> = [];
  for (let index = 0; index < 8; index += 1) {
    const toShape = await elapsed(async () => {
      await page.getByRole("button", { name: "Shape · Shaper" }).click();
      await expect(
        page.getByRole("textbox", { name: "Message Shaper" }),
      ).toBeVisible();
    });
    switchDurations.push(toShape.durationMs);
    const toUse = await elapsed(async () => {
      await page.getByRole("button", { name: "Use · App Agent" }).click();
      await expect(
        page.getByRole("textbox", { name: "Message Preview App Agent" }),
      ).toBeVisible();
    });
    switchDurations.push(toUse.durationMs);
  }
  expect(
    Math.max(...switchDurations),
    "worst warm target switch milliseconds",
  ).toBeLessThan(budget.targetSwitchMs);
  report({
    composerInputMs: Math.round(inputTiming.durationMs),
    initialDecodedBytes: decodedBytes,
    initialTransferBytes: transferBytes,
    interactiveStartupMs: Math.round(startupMs),
    modelMenuMs: Math.round(modelMenu.durationMs),
    worstTargetSwitchMs: Math.round(Math.max(...switchDurations)),
  });
});

test("bounds Markdown rendering and repeated candidate-cycle heap growth", async ({
  page,
}) => {
  await reset(page);
  const before = await heapUsed(page);
  expect(before, "baseline JS heap metric").toBeDefined();

  for (let index = 0; index < 5; index += 1) {
    await shape(page, `Create deterministic candidate ${index + 1}`);
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(
      page.getByRole("textbox", { name: "Message Shaper" }),
    ).toBeEnabled();
  }

  await shape(page, "Create the Markdown performance candidate");
  await page.getByRole("button", { name: "Keep change" }).click();
  const app = page.getByRole("textbox", { name: "Message App Agent" });
  await app.fill("Show the Markdown showcase");
  const markdown = await elapsed(async () => {
    await app.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Markdown showcase" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.locator(".markdown-code .shiki")).toBeVisible();
  });
  expect(markdown.durationMs, "Markdown render milliseconds").toBeLessThan(
    budget.markdownRenderMs,
  );

  const after = await heapUsed(page);
  expect(after, "final JS heap metric").toBeDefined();
  expect(after ?? Number.POSITIVE_INFINITY, "final JS heap bytes").toBeLessThan(
    budget.heapCeilingBytes,
  );
  expect(
    (after ?? Number.POSITIVE_INFINITY) - (before ?? 0),
    "repeated-cycle JS heap growth bytes",
  ).toBeLessThan(budget.repeatedCycleGrowthBytes);
  report({
    finalHeapBytes: Math.round(after ?? 0),
    markdownRenderMs: Math.round(markdown.durationMs),
    repeatedCycleGrowthBytes: Math.round((after ?? 0) - (before ?? 0)),
  });
});

test("acknowledges cancellation within the interaction budget", async ({
  page,
}) => {
  await reset(page);
  const input = page.getByRole("textbox", { name: "Message Shaper" });
  await input.fill("Create a candidate that will be cancelled");
  await input.press("Enter");
  const stop = page.getByRole("button", { name: "Stop Shaper" });
  await expect(stop).toBeVisible();
  const cancellation = await elapsed(async () => {
    await stop.click();
    await expect(input).toBeEnabled();
  });
  expect(
    cancellation.durationMs,
    "cancellation acknowledgement milliseconds",
  ).toBeLessThan(budget.cancellationAcknowledgeMs);
  report({
    cancellationAcknowledgeMs: Math.round(cancellation.durationMs),
  });
});
