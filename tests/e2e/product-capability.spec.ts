import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { Effect, Option, Schema } from "effect";
import { encodeCapsule } from "../../shared/capsule";

const runFile = promisify(execFile);
const controlStateDirectory = resolve("test-results/control-state");
const browserFailures = new WeakMap<Page, Array<string>>();
const ProcessFailure = Schema.Struct({
  stdout: Schema.optionalKey(Schema.String),
  stderr: Schema.optionalKey(Schema.String),
});
const InspectProjection = Schema.Struct({
  shaping: Schema.Struct({ proposal: Schema.optionalKey(Schema.Unknown) }),
});
const PermissionListProjection = Schema.Struct({
  permissions: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        scopeId: Schema.optionalKey(Schema.String),
        state: Schema.optionalKey(Schema.String),
        confirmationPolicy: Schema.optionalKey(Schema.String),
        decisionId: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
});

const runFlect = async (...args: ReadonlyArray<string>) => {
  try {
    const result = await runFile(
      "bun",
      ["cli/flect.ts", "--state-dir", controlStateDirectory, "--json", ...args],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const parsed: unknown = JSON.parse(result.stdout.trim());
    return parsed;
  } catch (cause) {
    const output = Option.getOrUndefined(
      Schema.decodeUnknownOption(ProcessFailure)(cause),
    );
    throw new Error(
      `flect ${args.join(" ")} failed\nstdout: ${output?.stdout?.trim() ?? ""}\nstderr: ${output?.stderr?.trim() ?? ""}`,
      { cause },
    );
  }
};

const runFlectFailure = async (...args: ReadonlyArray<string>) => {
  try {
    await runFlect(...args);
    return undefined;
  } catch (cause) {
    const message = String(cause);
    const encoded = message.match(/stdout: (.*)\nstderr:/s)?.[1];
    return encoded === undefined || encoded.length === 0
      ? undefined
      : (() => {
          const parsed: unknown = JSON.parse(encoded);
          return parsed;
        })();
  }
};

const capsule = (id: string, name: string) =>
  Effect.runPromise(
    encodeCapsule({
      manifest: {
        formatVersion: 1,
        id,
        name,
        version: "1.0.0",
        entrypoints: [{ id: "main", path: "ui/index.html" }],
        capabilities: [{ id: "product:projects:read", required: true }],
        compatibility: {
          flect: ">=0.2.0 <1.0.0",
          schemaVersion: 1,
          platforms: ["browser", "macos"],
        },
        provenance: {
          publisher: "akua-dev",
          source: "e2e-fixture",
          revision: `${id}-revision-1`,
          builder: "test",
        },
        signatures: [],
      },
      files: [
        {
          path: "ui/index.html",
          contents: new TextEncoder().encode(
            `<main><h1>${name}</h1><p>Reference product workflow</p></main>`,
          ),
        },
      ],
    }),
  );

const importCapsule = async (page: Page, archive: Uint8Array, name: string) => {
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Flect app" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name,
    mimeType: "application/vnd.flect",
    buffer: Buffer.from(archive),
  });
};

test.beforeEach(async ({ page }) => {
  const failures: Array<string> = [];
  browserFailures.set(page, failures);
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) =>
    failures.push(
      `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    ),
  );

  await page.goto("/?storage-reset-diagnostic=1");
  await expect(page.getByTestId("storage-reset-diagnostic")).toHaveAttribute(
    "data-state",
    "complete",
  );
  const workspace = `permission-${randomUUID().replaceAll("-", "")}`;
  await page.goto(`/?workspace=${workspace}&product-capability-workflow=1`);
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await page.getByRole("button", { name: "Enable local control" }).click();
  await expect(
    page.getByRole("button", { name: "Disable local control" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Diagnostics" }).click();
});

test.afterEach(async ({ page }) => {
  expect(browserFailures.get(page) ?? []).toEqual([]);
});

test("drives digest-bound permission lifecycle through protected UI, controller, and public flect", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const projects = await capsule("dev.akua.projects", "Projects product");
  await importCapsule(page, projects, "projects.flect");

  const decision = page.getByRole("region", { name: "Import decision" });
  await expect(
    decision.getByText("Required · Awaiting decision"),
  ).toBeVisible();
  await decision
    .getByRole("button", {
      name: "This session product:projects:read",
    })
    .click();
  await expect(
    decision.getByText("Required · Granted · This session"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Activate app" }).click();
  await expect(page.getByRole("button", { name: "Activate app" })).toHaveCount(
    0,
  );
  await expect
    .poll(async () => {
      const snapshot = await Effect.runPromise(
        Schema.decodeUnknownEffect(InspectProjection)(
          await runFlect("inspect"),
        ),
      );
      return snapshot.shaping.proposal ?? null;
    })
    .toBeNull();

  const sessionPermissions = await Effect.runPromise(
    Schema.decodeUnknownEffect(PermissionListProjection)(
      await runFlect("permissions", "list"),
    ),
  );
  expect(sessionPermissions.permissions).toContainEqual(
    expect.objectContaining({
      scopeId: "dev.akua.projects",
      state: "granted",
      confirmationPolicy: "session",
    }),
  );
  const firstInvocationFailure = await runFlectFailure(
    "product",
    "invoke",
    "projects.list",
  );
  if (firstInvocationFailure !== undefined) {
    throw new Error(
      `First product invocation failed: ${JSON.stringify(firstInvocationFailure)} logs=${JSON.stringify(await runFlect("logs", "--limit", "10"))}`,
    );
  }
  expect(
    await runFlectFailure(
      "product",
      "invoke",
      "projects.list",
      "--input",
      '{"productDenied":true}',
    ),
  ).toEqual(
    expect.objectContaining({
      error: expect.objectContaining({ code: "operation-failed" }),
    }),
  );

  const reports = await capsule("dev.akua.reports", "Reports product");
  await importCapsule(page, reports, "reports.flect");
  await expect(
    page
      .getByRole("region", { name: "Import decision" })
      .getByText("Required · Awaiting decision"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Product capabilities")).toBeVisible();
  await page.getByText("Product capabilities").click();
  await expect(page.getByText("Required · Awaiting decision")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Always allow product:projects:read",
    })
    .click();
  await expect(
    page.getByText("Required · Granted · Always allow"),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await page.getByRole("button", { name: "Enable local control" }).click();
  await expect(
    page.getByRole("button", { name: "Disable local control" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await page.getByText("Product capabilities").click();
  await expect(
    page.getByText("Required · Granted · Always allow"),
  ).toBeVisible();
  await runFlect("safe", "enter");
  await expect(page.locator(".topbar .safe-mode")).toBeVisible();
  await expect(
    page.getByText("Required · Granted · Always allow"),
  ).toBeVisible();

  const listed = await Effect.runPromise(
    Schema.decodeUnknownEffect(PermissionListProjection)(
      await runFlect("permissions", "list"),
    ),
  );
  const decisionId = listed.permissions?.find(
    (permission) => permission.decisionId !== undefined,
  )?.decisionId;
  expect(decisionId).toMatch(/^decision-/);
  if (decisionId === undefined)
    throw new Error("Decision ID was not projected.");
  await runFlect("permissions", "revoke", decisionId);
  await expect(
    page.getByText("Required · Revoked · Always allow"),
  ).toBeVisible();
  expect(await runFlectFailure("product", "invoke", "projects.list")).toEqual(
    expect.objectContaining({
      error: expect.objectContaining({ code: "operation-failed" }),
    }),
  );
});
