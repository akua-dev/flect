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

const percentile95 = (values: ReadonlyArray<number>) =>
  [...values].sort((left, right) => left - right)[
    Math.max(0, Math.ceil(values.length * 0.95) - 1)
  ] ?? Number.POSITIVE_INFINITY;

const heapUsed = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  await session.send("HeapProfiler.collectGarbage");
  const response = await session.send("Performance.getMetrics");
  await session.detach();
  return response.metrics.find((metric) => metric.name === "JSHeapUsedSize")
    ?.value;
};

const activate = async (page: Page) => {
  const composer = page.getByRole("textbox", { name: "Message Flect" });
  const activationMs = await composer.evaluate(
    (element) =>
      new Promise<number>((resolve, reject) => {
        if (!(element instanceof HTMLTextAreaElement)) {
          reject(new Error("Flect activation control is not a textarea."));
          return;
        }
        const startedAt = performance.now();
        const ready = () =>
          document
            .querySelector('[aria-label="Workbench status"]')
            ?.textContent?.includes("Flect is ready") === true;
        const observer = new MutationObserver(() => {
          if (!ready()) return;
          observer.disconnect();
          clearTimeout(timeout);
          resolve(performance.now() - startedAt);
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error("Flect activation did not become ready."));
        }, 10_000);
        observer.observe(document.documentElement, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        element.focus();
        if (ready()) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(performance.now() - startedAt);
        }
      }),
  );
  await expect(
    page.getByRole("status", { name: "Workbench status" }),
  ).toContainText("Flect is ready");
  await expect(page.locator(".role-shell")).toBeVisible();
  return activationMs;
};

const shape = async (page: Page, instruction: string, enforceBudget = true) => {
  const input = page.getByRole("textbox", { name: "Message Flect" });
  const shell = page.locator(".role-shell");
  const revisionBefore = await shell.getAttribute("data-active-revision");
  await input.fill(instruction);
  const result = await elapsed(async () => {
    await input.press("Enter");
    await expect(shell).not.toHaveAttribute(
      "data-active-revision",
      revisionBefore ?? "",
      { timeout: 10_000 },
    );
    await expect(input).toBeEnabled();
    await expect(shell).toHaveAttribute("data-phase", "accepted");
    await expect(
      page.getByRole("region", { name: "Import decision" }),
    ).toHaveCount(0);
  });
  const candidateRebuildMs = await page.evaluate(
    () =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming)
        .findLast((entry) => /\/api\/sessions\/[^/]+\/shape$/.test(entry.name))
        ?.duration,
  );
  expect(candidateRebuildMs, "candidate rebuild resource timing").toBeDefined();
  if (enforceBudget) {
    expect(
      candidateRebuildMs ?? Number.POSITIVE_INFINITY,
      "candidate rebuild resource milliseconds",
    ).toBeLessThan(budget.candidateRebuildMs);
  }
  return {
    candidateRebuildMs: candidateRebuildMs ?? Number.POSITIVE_INFINITY,
    endToEndMs: result.durationMs,
  };
};

test.beforeEach(async ({ page }) => {
  await resetBrowserWorkspace(page);
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeVisible();
});

test("enforces the static Astro shell and cold/warm interaction budgets", async ({
  page,
}) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  const viewOnly = new URL(page.url());
  viewOnly.searchParams.set("view", "1");
  const coldView = await elapsed(async () => {
    await page.goto(`${viewOnly.pathname}${viewOnly.search}`);
    await expect(
      page.getByRole("textbox", { name: "Message Flect" }),
    ).toBeVisible();
  });
  await session.send("Network.setCacheDisabled", { cacheDisabled: false });
  await session.detach();
  expect(
    coldView.durationMs,
    "cold view-only startup milliseconds",
  ).toBeLessThan(budget.coldInteractiveMs);

  const initialResources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      return {
        decoded: resource.decodedBodySize,
        name: resource.name,
        transfer: resource.transferSize,
      };
    }),
  );
  const initialDecodedBytes = initialResources.reduce(
    (total, resource) => total + resource.decoded,
    0,
  );
  const initialTransferBytes = initialResources.reduce(
    (total, resource) => total + resource.transfer,
    0,
  );
  expect(initialDecodedBytes, "view-only decoded bytes").toBeLessThanOrEqual(
    budget.initialShellDecodedBytes,
  );
  expect(initialTransferBytes, "view-only transfer bytes").toBeLessThanOrEqual(
    budget.initialShellGzipBytes,
  );
  expect(
    initialResources.filter((resource) =>
      /workspace-entry|react|quickjs|rifty|rolldown|wasm|worker/i.test(
        resource.name,
      ),
    ),
    "view-only route must not fetch the Flect toolchain",
  ).toEqual([]);

  const coldActivationMs = await activate(page);
  expect(coldActivationMs, "cold Flect activation milliseconds").toBeLessThan(
    budget.coldInteractiveMs,
  );

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeVisible();
  const warmActivationMs = await activate(page);
  const warmActivationLimitMs =
    process.env.CI === "true"
      ? budget.coldInteractiveMs
      : budget.warmInteractiveMs;
  expect(warmActivationMs, "warm Flect activation milliseconds").toBeLessThan(
    warmActivationLimitMs,
  );

  const composer = page.getByRole("textbox", { name: "Message Flect" });
  const inputDurations: Array<number> = [];
  for (let index = 0; index < 20; index += 1) {
    inputDurations.push(
      (await elapsed(() => composer.fill(`performance probe ${index}`)))
        .durationMs,
    );
  }
  const composerP95Ms = percentile95(inputDurations);
  expect(composerP95Ms, "composer input p95 milliseconds").toBeLessThan(
    budget.composerP95Ms,
  );

  const selection = await elapsed(async () => {
    await composer.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error("Flect composer is not a textarea.");
      }
      element.setSelectionRange(0, element.value.length);
    });
    await expect(composer).toHaveJSProperty("selectionStart", 0);
  });
  expect(selection.durationMs, "selection milliseconds").toBeLessThan(
    budget.interactionLatencyMs,
  );
  await composer.fill("");

  const modelMenu = await elapsed(async () => {
    await page.getByRole("button", { name: "Model: Auto via Pi" }).click();
    await expect(
      page.getByRole("dialog", { name: "Choose model" }),
    ).toBeVisible();
  });
  expect(modelMenu.durationMs, "model menu milliseconds").toBeLessThan(
    budget.interactionLatencyMs,
  );
  await page.keyboard.press("Escape");

  report({
    coldActivationMs: Math.round(coldActivationMs),
    coldViewOnlyMs: Math.round(coldView.durationMs),
    composerP95Ms: Math.round(composerP95Ms),
    initialDecodedBytes,
    initialTransferBytes,
    modelMenuMs: Math.round(modelMenu.durationMs),
    warmActivationLimitMs,
    warmActivationMs: Math.round(warmActivationMs),
  });
});

test("bounds 50 accepted edit cycles, Markdown rendering, and heap growth", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await activate(page);
  await shape(page, "Create the performance baseline", false);
  const before = await heapUsed(page);
  expect(before, "baseline JS heap metric").toBeDefined();

  const rebuilds: Array<{
    readonly candidateRebuildMs: number;
    readonly endToEndMs: number;
  }> = [];
  for (let index = 0; index < budget.repeatedCycleCount; index += 1) {
    rebuilds.push(
      await shape(page, `Create deterministic local edit ${index + 1}`),
    );
  }

  const afterCycles = await heapUsed(page);
  expect(afterCycles, "post-cycle JS heap metric").toBeDefined();
  expect(
    afterCycles ?? Number.POSITIVE_INFINITY,
    "post-cycle JS heap bytes",
  ).toBeLessThan(budget.heapCeilingBytes);
  expect(
    (afterCycles ?? Number.POSITIVE_INFINITY) - (before ?? 0),
    "50-cycle JS heap growth bytes",
  ).toBeLessThan(budget.repeatedCycleGrowthBytes);

  const input = page.getByRole("textbox", { name: "Message Flect" });
  await input.fill("Show the Markdown showcase");
  const markdown = await elapsed(async () => {
    await input.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Markdown showcase" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.locator(".markdown-code .shiki")).toBeVisible();
  });
  expect(markdown.durationMs, "Markdown render milliseconds").toBeLessThan(
    budget.markdownRenderMs,
  );

  const afterMarkdown = await heapUsed(page);
  expect(afterMarkdown, "final JS heap metric").toBeDefined();
  report({
    baselineHeapBytes: Math.round(before ?? 0),
    finalHeapBytes: Math.round(afterMarkdown ?? 0),
    markdownRenderMs: Math.round(markdown.durationMs),
    repeatedCycleGrowthBytes: Math.round((afterCycles ?? 0) - (before ?? 0)),
    worstAcceptedEndToEndMs: Math.round(
      Math.max(...rebuilds.map((result) => result.endToEndMs)),
    ),
    worstCandidateRebuildMs: Math.round(
      Math.max(...rebuilds.map((result) => result.candidateRebuildMs)),
    ),
  });
  expect(
    afterMarkdown ?? Number.POSITIVE_INFINITY,
    "final JS heap bytes",
  ).toBeLessThan(budget.heapCeilingBytes);
});

test("acknowledges cancellation within the interaction budget", async ({
  page,
}) => {
  await activate(page);
  const input = page.getByRole("textbox", { name: "Message Flect" });
  await input.fill("Create a candidate that will be cancelled");
  await input.press("Enter");
  const stop = page.getByRole("button", { name: "Stop Flect" });
  await expect(stop).toBeVisible();
  const cancellationMs = await stop.evaluate(
    (button) =>
      new Promise<number>((resolve, reject) => {
        if (!(button instanceof HTMLButtonElement)) {
          reject(new Error("Flect stop control is not a button."));
          return;
        }
        const composer = document.querySelector('[aria-label="Message Flect"]');
        if (!(composer instanceof HTMLTextAreaElement)) {
          reject(new Error("Flect composer is not a textarea."));
          return;
        }
        const startedAt = performance.now();
        const observer = new MutationObserver(() => {
          if (composer.disabled) return;
          observer.disconnect();
          resolve(performance.now() - startedAt);
        });
        observer.observe(composer, { attributes: true });
        button.click();
        if (!composer.disabled) {
          observer.disconnect();
          resolve(performance.now() - startedAt);
        }
      }),
  );
  await expect(input).toBeEnabled();
  expect(
    cancellationMs,
    "cancellation acknowledgement milliseconds",
  ).toBeLessThan(budget.cancellationAcknowledgeMs);
  report({
    cancellationAcknowledgeMs: Math.round(cancellationMs),
  });
});
