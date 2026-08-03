import { expect, test } from "@playwright/test";

const capabilityIds = {
  status: "product.reference.status",
  read: "product.reference.projects.read",
  write: "product.reference.projects.write",
  events: "product.reference.projects.events",
};

test("drives the reference adapter through grants, GraphQL, events, cancellation, and recovery", async ({
  page,
}) => {
  const browserFailures: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserFailures.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) =>
    browserFailures.push(`page: ${error.message}`),
  );

  await page.goto("/?reference-product-diagnostic=1");
  await expect(
    page.getByRole("heading", { name: "Reference product adapter" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Read projects" }).click();
  await expect(page.getByTestId("reference-result")).toHaveText("denied");
  await expect(page.getByTestId("reference-transport-count")).toHaveText("0");

  for (const capabilityId of Object.values(capabilityIds)) {
    await page
      .getByRole("button", { name: `Always allow ${capabilityId}` })
      .click();
  }

  await page.getByRole("button", { name: "Read offline status" }).click();
  await expect(page.getByTestId("reference-result")).toHaveText(
    '{"status":"ready"}',
  );
  await page.getByRole("button", { name: "Read projects" }).click();
  await expect(page.getByTestId("reference-result")).toContainText("Alpha");
  await page.getByRole("button", { name: "Archive alpha" }).click();
  await expect(page.getByTestId("reference-result")).toContainText("archived");
  await expect(page.getByTestId("reference-credential-state")).toHaveText(
    "Host credential applied privately",
  );

  await page.getByRole("button", { name: "Deny next archive" }).click();
  const transportCount = await page
    .getByTestId("reference-transport-count")
    .textContent();
  await page.getByRole("button", { name: "Archive alpha" }).click();
  await expect(page.getByTestId("reference-result")).toHaveText(
    "product-denied",
  );
  await expect(page.getByTestId("reference-transport-count")).toHaveText(
    transportCount ?? "",
  );

  await page.getByRole("button", { name: "Start project events" }).click();
  await expect(page.getByTestId("reference-event-sequences")).toHaveText(
    "1, 2",
  );
  await page.getByRole("button", { name: "Cancel project events" }).click();
  await expect(page.getByTestId("reference-event-state")).toHaveText(
    "Cancelled and released",
  );

  await page.reload();
  await expect(
    page.getByText("Required · Granted · Always allow").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read offline status" }).click();
  await expect(page.getByTestId("reference-result")).toHaveText(
    '{"status":"ready"}',
  );

  await expect(page.locator("body")).not.toContainText(
    "reference-host-secret-never-public",
  );
  expect(browserFailures).toEqual([]);
});
