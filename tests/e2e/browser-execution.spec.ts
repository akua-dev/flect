import { expect, test } from "@playwright/test";

test("runs the pinned browser execution substrate in production Chromium", async ({
  page,
}) => {
  const failures: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    failures.push(`page: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith("http://127.0.0.1:")) {
      failures.push(
        `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
      );
    }
  });

  await page.goto("/?execution-diagnostic=1");

  const diagnostic = page.getByTestId("execution-diagnostic");
  await expect(diagnostic).toHaveAttribute("data-status", "passed", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("execution-js")).toHaveText("42");
  await expect(page.getByTestId("execution-wasi")).toHaveText("0");
  await expect(page.getByTestId("execution-packages")).toHaveText("1");
  await expect(page.getByTestId("execution-release")).toHaveText("disposed");
  expect(failures).toEqual([]);
});
