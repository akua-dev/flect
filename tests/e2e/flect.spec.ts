import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { Effect } from "effect";
import { zipSync } from "fflate";
import { decodeCapsule, encodeCapsule } from "../../shared/capsule";
import { defaultInterfaceDocument } from "../../shared/interface-document";
import { resetBrowserWorkspace } from "./reset-browser-workspace";

const browserFailures = new WeakMap<Page, Array<string>>();
const completedShapePages = new WeakSet<Page>();
const completedPromptPages = new WeakSet<Page>();
const runFile = promisify(execFile);
const controlStateDirectory = resolve("test-results/control-state");

const runFlect = async (...args: ReadonlyArray<string>) => {
  try {
    const result = await runFile(
      "bun",
      ["cli/flect.ts", "--state-dir", controlStateDirectory, "--json", ...args],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    return JSON.parse(result.stdout.trim()) as unknown;
  } catch (cause) {
    const output = cause as {
      readonly stderr?: string;
      readonly stdout?: string;
    };
    throw new Error(
      `flect ${args.join(" ")} failed\nstdout: ${output.stdout?.trim() ?? ""}\nstderr: ${output.stderr?.trim() ?? ""}`,
      { cause },
    );
  }
};

const renderedContrastRatio = async (
  page: Page,
  foregroundSelector: string,
  backgroundSelector: string,
) =>
  page.evaluate(
    ({
      backgroundSelector: backgroundQuery,
      foregroundSelector: foregroundQuery,
    }) => {
      const foreground = document.querySelector(foregroundQuery);
      const background = document.querySelector(backgroundQuery);
      if (
        !(foreground instanceof HTMLElement) ||
        !(background instanceof HTMLElement)
      ) {
        throw new Error("Contrast target is not rendered");
      }
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) {
        throw new Error("Canvas context is unavailable");
      }
      const toRgb = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const luminance = (color: ReadonlyArray<number>) => {
        const channel = (value: number) => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        return (
          0.2126 * channel(color[0] ?? 0) +
          0.7152 * channel(color[1] ?? 0) +
          0.0722 * channel(color[2] ?? 0)
        );
      };
      const foregroundLuminance = luminance(
        toRgb(getComputedStyle(foreground).color),
      );
      const backgroundLuminance = luminance(
        toRgb(getComputedStyle(background).backgroundColor),
      );
      return (
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      );
    },
    { backgroundSelector, foregroundSelector },
  );

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
    if (
      completedShapePages.has(page) &&
      request.method() === "POST" &&
      /\/api\/sessions\/session-browser-test-\d+\/shape$/.test(url) &&
      request.failure()?.errorText === "net::ERR_ABORTED"
    ) {
      return;
    }
    if (
      completedPromptPages.has(page) &&
      request.method() === "POST" &&
      /\/api\/sessions\/session-browser-test-\d+\/prompts$/.test(url) &&
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
  await expect(page.locator(".role-shell")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeEnabled();
});

test.afterEach(async ({ page }) => {
  const failures = (browserFailures.get(page) ?? []).filter((failure) => {
    if (
      completedShapePages.has(page) &&
      /request: POST .*\/api\/sessions\/session-browser-test-\d+\/shape net::ERR_ABORTED$/.test(
        failure,
      )
    ) {
      return false;
    }
    if (
      completedPromptPages.has(page) &&
      /request: POST .*\/api\/sessions\/session-browser-test-\d+\/prompts net::ERR_ABORTED$/.test(
        failure,
      )
    ) {
      return false;
    }
    return true;
  });
  expect(failures).toEqual([]);
});

const shapeFirstInterface = async (page: Page) => {
  const input = page.getByRole("textbox", { name: "Message Flect" });
  await input.evaluate((element) => {
    element.dataset.composerIdentity = "original";
  });
  await input.fill("Create a focused project overview");
  completedShapePages.add(page);
  await input.press("Enter");

  await expect(page.locator(".role-shell")).toHaveClass(/role-shell--split/);
  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toHaveAttribute("data-composer-identity", "original");
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("status", { name: "Workbench status" }),
  ).toContainText("Flect is ready");
  await expect(page.locator(".role-shell")).toHaveAttribute(
    "data-phase",
    "accepted",
  );
  await expect(page.locator(".role-shell")).toHaveAttribute(
    "data-target",
    "use",
  );
  await expect(page.locator(".role-shell")).toHaveAttribute(
    "data-use-disabled",
    "false",
  );
};

const compiledFixtureArchive = (
  capabilities: ReadonlyArray<{
    readonly id: string;
    readonly required: boolean;
  }> = [],
  flectRange = ">=0.2.0 <1.0.0",
) =>
  Effect.runPromise(
    encodeCapsule({
      manifest: {
        formatVersion: 1,
        id: "dev.akua.compiled-fixture",
        name: "Compiled fixture",
        version: "1.0.0",
        entrypoints: [{ id: "main", path: "ui/index.html" }],
        capabilities,
        compatibility: {
          flect: flectRange,
          schemaVersion: 1,
          platforms: ["browser", "macos"],
        },
        provenance: {
          publisher: "fixture",
          source: "fixture",
          revision: "fixture",
          builder: "test",
        },
        signatures: [],
      },
      files: [
        {
          path: "ui/index.html",
          contents: new TextEncoder().encode(
            `<main><h1>Compiled product</h1><button onclick="this.textContent='Used'">Use product</button></main>`,
          ),
        },
      ],
    }),
  );

const assetFixtureArchive = (version = "1.0.0") =>
  Effect.runPromise(
    encodeCapsule({
      manifest: {
        formatVersion: 1,
        id: "dev.akua.asset-fixture",
        name: "Asset fixture",
        version,
        entrypoints: [{ id: "main", path: "ui/index.html" }],
        capabilities: [],
        compatibility: {
          flect: ">=0.2.0 <1.0.0",
          schemaVersion: 1,
          platforms: ["browser", "macos"],
        },
        provenance: {
          publisher: "fixture",
          source: "fixture",
          revision: `asset-fixture-${version}`,
          builder: "test",
        },
        signatures: [],
      },
      files: [
        {
          path: "ui/index.html",
          contents: new TextEncoder().encode(
            `<link rel="stylesheet" href="./styles.css"><main><span>Version ${version}</span><img alt="Flect mark" src="./mark.svg"><button id="asset-action">Use assets</button></main><script src="./app.js"></script>`,
          ),
        },
        {
          path: "ui/styles.css",
          contents: new TextEncoder().encode(
            `main{background:rgb(18,24,38);color:rgb(240,244,255)}button{border-radius:12px}`,
          ),
        },
        {
          path: "ui/mark.svg",
          contents: new TextEncoder().encode(
            `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#ff7a6b"/></svg>`,
          ),
        },
        {
          path: "ui/app.js",
          contents: new TextEncoder().encode(
            `document.querySelector("#asset-action").addEventListener("click",event=>{event.currentTarget.textContent="Assets ready"})`,
          ),
        },
      ],
    }),
  );

test("shapes a blank workspace in one continuous live canvas", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "What do you want to make?" }),
  ).toBeVisible();

  await shapeFirstInterface(page);

  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);
  await expect(page.getByText("Shaper used its sandbox.")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeFocused();
  await expect(page.locator(".composer")).toHaveCount(1);
});

test("gives the static home screen one clear starting action", async ({
  page,
}) => {
  await page.goto("/?view=1");

  await expect(
    page.getByRole("heading", { name: "Describe the app you want to make." }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toHaveAttribute(
    "placeholder",
    "For example: a calm project planner for this week",
  );
  await expect(
    page.getByRole("button", { name: "Create with Flect" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start building" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Select element" }),
  ).toHaveCount(0);
});

test("selects and directly edits the running canvas through the same agent", async ({
  page,
}) => {
  await shapeFirstInterface(page);
  const shell = page.locator(".role-shell");
  const before = await shell.getAttribute("data-active-revision");

  await page.getByRole("button", { name: "Select element" }).click();
  await page.getByRole("heading", { name: "Focused project overview" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeFocused();
  await expect(page.locator('[data-node-id="headline"]')).toHaveAttribute(
    "data-selected",
    "true",
  );

  completedShapePages.add(page);
  await page
    .getByRole("textbox", { name: "Message Flect" })
    .fill("Make this calmer without reducing contrast");
  await page.getByRole("textbox", { name: "Message Flect" }).press("Enter");
  await expect(shell).not.toHaveAttribute("data-active-revision", before ?? "");
  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();

  const afterPrompt = await shell.getAttribute("data-active-revision");
  await page.getByRole("button", { name: "Select element" }).click();
  await page.getByRole("heading", { name: "Focused project overview" }).click();
  completedShapePages.add(page);
  await page.getByRole("button", { name: "Move later" }).click();
  await expect(shell).not.toHaveAttribute(
    "data-active-revision",
    afterPrompt ?? "",
  );
  await expect(page.locator(".composer")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);
});

test("exports the shaped source and complete Git history", async ({ page }) => {
  await shapeFirstInterface(page);
  await page.getByRole("button", { name: "Actions" }).click();
  await expect(
    page.getByRole("dialog", { name: "Flect actions" }).getByRole("status"),
  ).toContainText("Current version saved");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export source and history" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("flect-repository.tar");
  const archive = await download.path();
  expect(archive).not.toBeNull();
  if (archive === null) {
    throw new Error("Flect did not produce a repository archive.");
  }

  const root = await mkdtemp(join(tmpdir(), "flect-app-export-"));
  const repository = join(root, "repository");
  await mkdir(repository, { recursive: true });
  await runFile("tar", ["-xf", archive, "-C", repository]);
  await runFile("git", ["-C", repository, "fsck", "--full"]);
  const { stdout: refs } = await runFile("git", ["-C", repository, "show-ref"]);
  expect(refs).toContain("refs/heads/flect/accepted");
  expect(refs).toContain("refs/heads/flect/last-known-good");
  expect(refs).not.toContain("refs/heads/flect/proposal/");
});

test("round-trips an accepted app through a verified .flect capsule", async ({
  page,
}) => {
  await shapeFirstInterface(page);
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Actions" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export Flect app" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("interface.flect");
  const capsule = await download.path();
  expect(capsule).not.toBeNull();
  if (capsule === null) throw new Error("Flect did not export a capsule.");

  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Flect app" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(capsule);

  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toContainText("Imported app ready");
  await expect(
    page.getByRole("button", { name: "Activate app" }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeVisible();
});

test("rejects a malformed capsule without replacing the accepted app", async ({
  page,
}) => {
  const before = await page.getByRole("main").textContent();
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Flect app" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "malformed.flect",
    mimeType: "application/vnd.flect",
    buffer: Buffer.from("not a capsule"),
  });

  await expect(
    page.getByText("Flect app import failed safely.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);
  expect(await page.getByRole("main").textContent()).toBe(before);
});

test("reviews imported provenance and blocks unavailable required capabilities", async ({
  page,
}) => {
  const archive = await compiledFixtureArchive([
    { id: "product:projects:read", required: true },
    { id: "product:projects:write", required: false },
  ]);
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Flect app" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "capability-review.flect",
    mimeType: "application/vnd.flect",
    buffer: Buffer.from(archive),
  });

  const decision = page.getByRole("region", { name: "Import decision" });
  await expect(decision.getByText("fixture · 1.0.0")).toBeVisible();
  await expect(decision.getByText("Unsigned")).toBeVisible();
  await expect(decision.getByText("product:projects:read")).toBeVisible();
  await expect(
    decision.getByText("Required · Unavailable on this host"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activate app" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discard" })).toBeFocused();
  await expect(
    page
      .frameLocator('iframe[title="Compiled fixture"]')
      .getByRole("heading", { name: "Compiled product" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator('iframe[title="Compiled fixture"]')).toHaveCount(0);
});

test("blocks a capsule outside its declared Flect compatibility range", async ({
  page,
}) => {
  const archive = await compiledFixtureArchive([], "<0.2.0");
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Flect app" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "incompatible.flect",
    mimeType: "application/vnd.flect",
    buffer: Buffer.from(archive),
  });

  const decision = page.getByRole("region", { name: "Import decision" });
  await expect(decision.getByText("<0.2.0 · incompatible")).toBeVisible();
  await expect(decision.getByText("browser · supported")).toBeVisible();
  await expect(
    decision.getByText(/incompatible with this Flect version or host/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activate app" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Discard" }).click();
});

test("projects verified capsule assets into the network-denied frame", async ({
  page,
}) => {
  const archive = await assetFixtureArchive();
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Flect app" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "asset-fixture.flect",
    mimeType: "application/vnd.flect",
    buffer: Buffer.from(archive),
  });

  const frame = page.frameLocator('iframe[title="Asset fixture"]');
  const mark = frame.getByRole("img", { name: "Flect mark" });
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
  await expect(frame.locator("main")).toHaveCSS(
    "background-color",
    "rgb(18, 24, 38)",
  );
  await frame.getByRole("button", { name: "Use assets" }).click();
  await expect(
    frame.getByRole("button", { name: "Assets ready" }),
  ).toBeVisible();
});

test("imports an ordinary static HTML project as a reviewable Flect app", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import app project" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(resolve("tests/fixtures/static-site"));
  const frame = page.frameLocator('iframe[title="static-site"]');
  await expect(
    frame.getByRole("heading", { name: "Imported portfolio" }),
  ).toBeVisible();
  await expect(frame.locator("main")).toHaveCSS("color", "rgb(26, 71, 120)");
  await expect(
    frame.getByRole("img", { name: "Portfolio mark" }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "Open work" }).click();
  await expect(
    frame.getByRole("button", { name: "Work opened" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Import decision" })
      .getByText("local-user · 1.0.0"),
  ).toBeVisible();
  await expect(
    page.getByText("Static app packaged · 4 source files. Ready to activate."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Activate app" }).click();
  await expect(page.getByRole("button", { name: "Activate app" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Actions" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export Flect app" }).click();
  const exportedPath = await (await downloadPromise).path();
  expect(exportedPath).not.toBeNull();
  if (exportedPath === null) throw new Error("Static project export missing.");
  const exported = await Effect.runPromise(
    decodeCapsule(new Uint8Array(await readFile(exportedPath))),
  );
  expect(exported.files.map((file) => file.path)).not.toContain(
    ".env.production",
  );
  expect(
    exported.files.some((file) =>
      new TextDecoder()
        .decode(file.contents)
        .includes("fixture-must-not-enter"),
    ),
  ).toBe(false);

  await page.getByRole("button", { name: "Actions" }).click();
  const repositoryDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export source and history" })
    .click();
  const repositoryArchive = await (await repositoryDownloadPromise).path();
  expect(repositoryArchive).not.toBeNull();
  if (repositoryArchive === null) {
    throw new Error("Static project repository export missing.");
  }
  const root = await mkdtemp(join(tmpdir(), "flect-static-export-"));
  const repository = join(root, "repository");
  await mkdir(repository, { recursive: true });
  await runFile("tar", ["-xf", repositoryArchive, "-C", repository]);
  await runFile("git", ["-C", repository, "fsck", "--full"]);
  const { stdout: importedHtml } = await runFile("git", [
    "-C",
    repository,
    "show",
    "flect/accepted:project/index.html",
  ]);
  expect(importedHtml).toContain("Imported portfolio");
  const { stdout: sourceTree } = await runFile("git", [
    "-C",
    repository,
    "ls-tree",
    "-r",
    "--name-only",
    "flect/accepted",
  ]);
  expect(sourceTree).toContain("project/styles.css");
  expect(sourceTree).not.toContain(".env.production");
});

test("imports a bounded source archive through the ordinary project pipeline", async ({
  page,
}) => {
  const archive = zipSync({
    "archive-app/index.html": new TextEncoder().encode(
      "<!doctype html><main><h1>Archive imported</h1></main>",
    ),
    "archive-app/.env": new TextEncoder().encode("TOKEN=never-retained"),
  });
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import project archive" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "archive-app.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });

  await expect(
    page
      .frameLocator('iframe[title="archive-app"]')
      .getByRole("heading", { name: "Archive imported" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Static app packaged · 1 source files · 1 ignored. Ready to activate.",
    ),
  ).toBeVisible();
  const decision = page.getByRole("region", { name: "Import decision" });
  await expect(
    decision.getByText("archive-import:archive-app.zip"),
  ).toBeVisible();
  await expect(decision.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
});

test("requires exact immutable identity before importing public Git source", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Import project from Git" }).click();
  const dialog = page.getByRole("dialog", { name: "Import from Git" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Public HTTPS repository")
    .fill("https://example.test/project.git");
  await dialog.getByLabel("Exact commit ID").fill("main");
  await expect(
    dialog.getByRole("button", { name: "Import exact commit" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("imports, builds, reviews, keeps, and exports a Vite source project", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import app project" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(resolve("tests/fixtures/vite-typescript"));

  await expect(
    page.getByText(
      "Portable build verified · 3 source files. Ready to activate.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  const frame = page.frameLocator('iframe[title="vite-typescript"]');
  await expect(
    frame.getByRole("button", { name: "Vite app ready" }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "Vite app ready" }).click();
  await expect(
    frame.getByRole("button", { name: "Vite app used" }),
  ).toBeVisible();

  const decision = page.getByRole("region", { name: "Import decision" });
  await expect(decision.getByText("Vite · src/main.ts")).toBeVisible();
  await expect(decision.getByText(/artifact [0-9a-f]{7}/)).toBeVisible();
  await expect(
    decision.getByText(
      "Flect uses its restricted browser compiler instead of executing Vite config or package scripts.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Activate app" }).click();
  await expect(page.getByRole("button", { name: "Activate app" })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(
    page.frameLocator('iframe[title="vite-typescript"]').getByRole("button", {
      name: "Vite app ready",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Actions" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export Flect app" }).click();
  const exportedPath = await (await downloadPromise).path();
  expect(exportedPath).not.toBeNull();
  if (exportedPath === null) throw new Error("Vite app export missing.");
  const exported = await Effect.runPromise(
    decodeCapsule(new Uint8Array(await readFile(exportedPath))),
  );
  expect(exported.manifest.entrypoints).toEqual([
    { id: "compiled-web", path: "index.html" },
  ]);
  expect(exported.manifest.build?.sourceRevision).toMatch(/^[0-9a-f]{40}$/);
  expect(exported.manifest.build?.artifactDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(exported.files.map((file) => file.path)).toContain("app.js");
  expect(exported.files.map((file) => file.path)).not.toContain("src/main.ts");
});

test("imports a Vite React project and rebuilds it with the registry offline", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const importProject = async () => {
    await page.getByRole("button", { name: "Actions" }).click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import app project" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(resolve("tests/fixtures/vite-react"));
    await expect(
      page.getByText(
        "Portable build verified · 4 source files. Ready to activate.",
      ),
    ).toBeVisible({ timeout: 45_000 });
  };

  await importProject();
  const candidate = page.frameLocator('iframe[title="vite-react"]');
  await expect(
    candidate.getByRole("heading", { name: "React project imported" }),
  ).toBeVisible();
  await candidate.getByRole("button", { name: "Use React app" }).click();
  await expect(
    candidate.getByRole("button", { name: "React app used" }),
  ).toBeVisible();
  const decision = page.getByRole("region", { name: "Import decision" });
  await expect(decision.getByText("Vite React · src/main.jsx")).toBeVisible();
  await expect(decision.getByText(/artifact [0-9a-f]{7}/)).toBeVisible();
  await expect(
    decision.getByText(/Locked in source Git · graph [0-9a-f]{7}/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Activate app" }).click();
  await expect(page.getByRole("button", { name: "Activate app" })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Actions" }).click();
  const repositoryDownload = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export source and history" })
    .click();
  const repositoryArchive = await (await repositoryDownload).path();
  expect(repositoryArchive).not.toBeNull();
  if (repositoryArchive === null) {
    throw new Error("Vite React source export missing.");
  }
  const exportDirectory = await mkdtemp(join(tmpdir(), "flect-react-lock-"));
  const repository = join(exportDirectory, "repository");
  await mkdir(repository);
  await runFile("tar", ["-xf", repositoryArchive, "-C", repository]);
  const { stdout: packageLockSource } = await runFile("git", [
    "-C",
    repository,
    "show",
    "flect/accepted:project/package-lock.json",
  ]);
  const packageLock = JSON.parse(packageLockSource) as {
    readonly packages?: Readonly<
      Record<string, { readonly version?: string; readonly integrity?: string }>
    >;
  };
  expect(packageLock.packages?.["node_modules/react"]?.version).toBe("19.2.8");
  expect(packageLock.packages?.["node_modules/react"]?.integrity).toMatch(
    /^sha512-/,
  );

  let blockedRegistryRequests = 0;
  await context.route("https://registry.npmjs.org/**", async (route) => {
    blockedRegistryRequests += 1;
    await route.abort("internetdisconnected");
  });
  await importProject();
  await expect(
    page
      .frameLocator('iframe[title="vite-react"]')
      .getByRole("heading", { name: "React project imported" }),
  ).toBeVisible();
  expect(blockedRegistryRequests).toBe(0);
  await page.getByRole("button", { name: "Discard" }).click();
});

test("imports Vue and Svelte through the same portable workspace contract", async ({
  context,
  page,
}) => {
  test.setTimeout(180_000);
  const importFramework = async (
    fixture: "vite-vue" | "vite-svelte",
    framework: "Vue" | "Svelte",
  ) => {
    await page.getByRole("button", { name: "Actions" }).click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import app project" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(resolve(`tests/fixtures/${fixture}`));
    await expect(
      page.getByText(
        "Portable build verified · 5 source files. Ready to activate.",
      ),
    ).toBeVisible({ timeout: 75_000 });
    const frame = page.frameLocator(`iframe[title="${fixture}"]`);
    await expect(
      frame.getByRole("heading", { name: `${framework} project imported` }),
    ).toBeVisible();
    await frame.getByRole("button", { name: `${framework} count 0` }).click();
    await expect(
      frame.getByRole("button", { name: `${framework} count 1` }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Import decision" })
        .getByText(`${framework} · src/main.js`),
    ).toBeVisible();
    await page.getByRole("button", { name: "Activate app" }).click();
    await expect(
      page.getByRole("button", { name: "Activate app" }),
    ).toHaveCount(0);
  };

  await importFramework("vite-vue", "Vue");
  await importFramework("vite-svelte", "Svelte");

  let blockedRegistryRequests = 0;
  await context.route("https://registry.npmjs.org/**", async (route) => {
    blockedRegistryRequests += 1;
    await route.abort("internetdisconnected");
  });
  await page.reload();
  await expect(
    page
      .frameLocator('iframe[title="vite-svelte"]')
      .getByRole("heading", { name: "Svelte project imported" }),
  ).toBeVisible();
  expect(blockedRegistryRequests).toBe(0);
});

test("downloads a capsule URL without credentials and opens verified review", async ({
  page,
}) => {
  const archive = await assetFixtureArchive();
  const capsuleUrl = "https://capsules.example/asset-fixture.flect";
  let credentialsHeader: string | undefined;
  await page.route(capsuleUrl, async (route) => {
    credentialsHeader = route.request().headers().authorization;
    await route.fulfill({
      body: Buffer.from(archive),
      contentType: "application/vnd.flect",
      headers: {
        "access-control-allow-origin": "*",
        "content-length": String(archive.byteLength),
      },
      status: 200,
    });
  });

  await page.getByRole("button", { name: "Actions" }).click();
  await page
    .getByRole("menuitem", { name: "Install Flect app from URL" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Install Flect app" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("HTTPS capsule URL").fill(capsuleUrl);
  await dialog.getByRole("button", { name: "Download and review" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .frameLocator('iframe[title="Asset fixture"]')
      .getByRole("button", { name: "Use assets" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Import decision" })
      .getByText("fixture · 1.0.0"),
  ).toBeVisible();
  expect(credentialsHeader).toBeUndefined();
});

test("compares an installed capsule update and never overwrites it silently", async ({
  page,
}) => {
  const versionOne = await assetFixtureArchive("1.0.0");
  const versionTwo = await assetFixtureArchive("1.1.0");
  const install = async (url: string) => {
    await page.getByRole("button", { name: "Actions" }).click();
    await page
      .getByRole("menuitem", { name: "Install Flect app from URL" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Install Flect app" });
    await dialog.getByLabel("HTTPS capsule URL").fill(url);
    await dialog.getByRole("button", { name: "Download and review" }).click();
    await expect(dialog).toHaveCount(0);
  };
  await page.route("https://capsules.example/v1.flect", (route) =>
    route.fulfill({
      body: Buffer.from(versionOne),
      contentType: "application/vnd.flect",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.route("https://capsules.example/v2.flect", (route) =>
    route.fulfill({
      body: Buffer.from(versionTwo),
      contentType: "application/vnd.flect",
      headers: { "access-control-allow-origin": "*" },
    }),
  );

  await install("https://capsules.example/v1.flect");
  await page.getByRole("button", { name: "Activate app" }).click();
  await expect(page.getByRole("button", { name: "Activate app" })).toHaveCount(
    0,
  );
  await expect(
    page
      .frameLocator('iframe[title="Asset fixture"]')
      .getByText("Version 1.0.0"),
  ).toBeVisible();

  await install("https://capsules.example/v2.flect");
  await expect(page.getByText("Review update 1.0.0 → 1.1.0")).toBeVisible();
  await expect(
    page.getByText(
      "The installed app stays active until you explicitly activate this version.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(
    page
      .frameLocator('iframe[title="Asset fixture"]')
      .getByText("Version 1.0.0"),
  ).toBeVisible();
});

test("previews and accepts compiled UI only inside the isolated capsule frame", async ({
  page,
}) => {
  const archive = await compiledFixtureArchive();
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Flect app" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "compiled.flect",
    mimeType: "application/vnd.flect",
    buffer: Buffer.from(archive),
  });

  const frame = page.frameLocator('iframe[title="Compiled fixture"]');
  await expect(
    frame.getByRole("heading", { name: "Compiled product" }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "Use product" }).click();
  await expect(frame.getByRole("button", { name: "Used" })).toBeVisible();

  await page.getByRole("button", { name: "Activate app" }).click();
  await expect(page.getByRole("button", { name: "Activate app" })).toHaveCount(
    0,
  );

  await page.reload();
  const restoredAccepted = page.frameLocator(
    'iframe[title="Compiled fixture"]',
  );
  await expect(
    restoredAccepted.getByRole("heading", { name: "Compiled product" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select element" }).click();
  await restoredAccepted
    .getByRole("heading", { name: "Compiled product" })
    .click();
  await expect(page.locator(".canvas-selection-outline")).toContainText(
    "Compiled product",
  );
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Clear canvas selection" }).click();
  await expect(page.locator(".canvas-selection-outline")).toHaveCount(0);
  await restoredAccepted.getByRole("button", { name: "Use product" }).click();
  await expect(
    restoredAccepted.getByRole("button", { name: "Used" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Actions" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export Flect app" }).click();
  const download = await downloadPromise;
  const exported = await download.path();
  expect(exported).not.toBeNull();
  if (exported === null) throw new Error("Compiled capsule was not exported.");
  expect(await readFile(exported)).toEqual(Buffer.from(archive));

  await page.getByRole("button", { name: "Safe mode" }).click();
  await expect(page.locator('iframe[title="Compiled fixture"]')).toHaveCount(0);
  await expect(
    page.getByText("Custom interface state is bypassed."),
  ).toBeVisible();
});

test("restores a compiled candidate for review without replacing accepted state", async ({
  page,
}) => {
  const archive = await compiledFixtureArchive();
  await page.getByRole("button", { name: "Actions" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Flect app" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "compiled.flect",
    mimeType: "application/vnd.flect",
    buffer: Buffer.from(archive),
  });

  await expect(
    page
      .frameLocator('iframe[title="Compiled fixture"]')
      .getByRole("heading", { name: "Compiled product" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toBeVisible();
  await page.reload();
  const restored = page.frameLocator('iframe[title="Compiled fixture"]');
  await expect(
    restored.getByRole("heading", { name: "Compiled product" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator('iframe[title="Compiled fixture"]')).toHaveCount(0);
});

test("keeps one draft and one conversation while Flect routes product and edit work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await shapeFirstInterface(page);

  const composer = page.getByRole("textbox", { name: "Message Flect" });
  await composer.fill("this one draft stays here");
  await expect(composer).toHaveValue("this one draft stays here");
  await expect(page.locator(".composer")).toHaveCount(1);
  await composer.fill("Show the Markdown showcase");
  await composer.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Markdown showcase" }),
  ).toBeVisible();
  const previewConversation = page.getByRole("log", {
    name: "Flect conversation",
  });
  await expect
    .poll(() =>
      previewConversation.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await previewConversation.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  expect(
    await previewConversation.evaluate((element) => element.scrollTop),
  ).toBeLessThan(50);

  await page.getByRole("button", { name: "Actions" }).click();
  await page
    .getByRole("menuitem", { name: "Enable trusted Pi extensions" })
    .click();
  await composer.fill("Fail candidate extension");
  await composer.press("Enter");
  const failedActivity = page.getByRole("button", {
    name: "Trusted Pi extension details",
  });
  await expect(failedActivity).toContainText("Error");
  await failedActivity.click();
  await expect(
    page.getByText("Disable trusted Pi extensions for this agent and retry."),
  ).toBeVisible();
  await expect(
    page.getByText("FLECT_PRIVATE_EXTENSION_FIXTURE_FAILURE"),
  ).toHaveCount(0);
  await expect(page.getByText(/fail-on-agent-start\.ts/)).toHaveCount(0);
  const fix = page.getByRole("button", { name: "Fix with Flect" }).last();
  await expect(fix).toBeVisible();
  await fix.click();
  await page.getByRole("button", { name: "Actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Disable trusted Pi extensions" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Fail candidate extension")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fix with Flect" }).last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Actions" }).click();
  await page
    .getByRole("menuitem", { name: "Disable trusted Pi extensions" })
    .click();
  await composer.fill("Fail candidate extension");
  await composer.press("Enter");
  await expect(
    page.getByText(
      "Trusted Pi extensions are disabled. The corrected candidate completed safely.",
    ),
  ).toHaveCount(1);
  await expect(page.locator(".composer")).toHaveCount(1);
});

test("routes product questions and typed edit requests without exposing agent modes", async ({
  page,
}) => {
  await shapeFirstInterface(page);
  const appInput = page.getByRole("textbox", { name: "Message Flect" });
  await appInput.fill("Which interface is active?");
  await appInput.press("Enter");
  await expect(page.getByText("The product action completed.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);

  await appInput.fill("Explicitly change the interface");
  await appInput.press("Enter");
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);
  await expect(appInput).toBeEnabled();
  await expect(page.getByText("Explicitly change the interface")).toBeVisible();
});

test("keeps essential composer qualifiers at AA contrast", async ({ page }) => {
  expect(
    await renderedContrastRatio(page, ".runtime-state", ".composer"),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    await renderedContrastRatio(page, ".model-menu__source", ".composer"),
  ).toBeGreaterThanOrEqual(4.5);
});

test("keeps one chronological conversation across internal routing and reload", async ({
  page,
}) => {
  await shapeFirstInterface(page);

  const appInput = page.getByRole("textbox", { name: "Message Flect" });
  await appInput.fill("Open the latest project");
  await appInput.press("Enter");
  await expect(page.getByText("The product action completed.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bash details" }).first(),
  ).toContainText("Completed");
  completedPromptPages.add(page);
  await expect(
    page.getByText("Change complete: Focused project overview"),
  ).toBeVisible();
  const conversation = page.getByRole("log", { name: "Flect conversation" });
  await expect(conversation).toContainText("Create a focused project overview");
  await expect(conversation).toContainText("Open the latest project");

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeVisible();
  await expect(page.getByText("The product action completed.")).toBeVisible();
  await expect(
    page.getByText("Change complete: Focused project overview"),
  ).toBeVisible();
});

test("restores the one visible draft through refresh and clears it after send", async ({
  page,
}) => {
  await shapeFirstInterface(page);
  const composer = page.getByRole("textbox", {
    name: "Message Flect",
  });
  await composer.fill("One draft survives refresh");

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toHaveValue("One draft survives refresh");
  await page.getByRole("textbox", { name: "Message Flect" }).press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toHaveValue("");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const encoded = localStorage.getItem("flect.role-continuity.v1");
        if (encoded === null) return undefined;
        return (JSON.parse(encoded) as { drafts?: Record<string, string> })
          .drafts;
      }),
    )
    .toEqual({ acceptedUse: "", candidateUse: "", shape: "" });
});

test("normalizes an interrupted Shaper turn without restoring partial output", async ({
  page,
}) => {
  const input = page.getByRole("textbox", { name: "Message Flect" });
  await input.fill("Create a candidate that will be cancelled");
  completedShapePages.add(page);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Stop Flect" })).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeEnabled();
  await expect(
    page.getByText("Create a candidate that will be cancelled"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);
});

test("rejects a stale draft writer across two real same-origin tabs", async ({
  context,
  page,
}) => {
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(
    second.getByRole("textbox", { name: "Message Flect" }),
  ).toBeEnabled();
  await expect(second.locator(".role-shell")).toBeVisible();
  await expect(
    second.getByRole("status", { name: "Workbench status" }),
  ).toContainText("Flect is ready");

  await page
    .getByRole("textbox", { name: "Message Flect" })
    .fill("Newer draft from the first tab");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("flect.role-continuity.v1")),
    )
    .toContain("Newer draft from the first tab");

  await second
    .getByRole("textbox", { name: "Message Flect" })
    .fill("Stale draft from the second tab");
  expect(
    await page.evaluate(() => localStorage.getItem("flect.role-continuity.v1")),
  ).toContain("Newer draft from the first tab");
  expect(
    await page.evaluate(() => localStorage.getItem("flect.role-continuity.v1")),
  ).not.toContain("Stale draft from the second tab");

  await second.getByRole("button", { name: "Safe mode" }).click();
  await expect(second.getByText(/stale-write/)).toBeVisible();
  await second.close();
});

test("preserves the prior continuity record when browser quota rejects a write", async ({
  page,
}) => {
  await page
    .getByRole("textbox", { name: "Message Flect" })
    .fill("Last durable draft");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("flect.role-continuity.v1")),
    )
    .toContain("Last durable draft");
  const durable = await page.evaluate(() =>
    localStorage.getItem("flect.role-continuity.v1"),
  );

  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "flect.role-continuity.v1") {
        throw new DOMException("Injected quota limit", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  });
  await page.reload();
  const input = page.getByRole("textbox", { name: "Message Flect" });
  await expect(input).toHaveValue("Last durable draft");
  await input.fill("This write exceeds quota");
  await page.getByRole("button", { name: "Safe mode" }).click();
  await expect(page.getByText(/storage-unavailable/)).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("flect.role-continuity.v1")),
  ).toBe(durable);
});

test("renders complete Markdown as a contained chat instrument", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:5173",
  });
  await shapeFirstInterface(page);

  const input = page.getByRole("textbox", { name: "Message Flect" });
  await input.fill("Show the Markdown showcase");
  await input.press("Enter");

  await expect(
    page.getByRole("heading", { level: 1, name: "Markdown showcase" }),
  ).toBeVisible();
  await expect(page.getByText("A quoted product decision.")).toBeVisible();
  for (const checkbox of await page.getByRole("checkbox").all()) {
    await expect(checkbox).toBeDisabled();
  }
  await expect(page.getByText("Implementation note")).toBeVisible();
  const link = page.getByRole("link", { name: "Effect" });
  await expect(link).toHaveAttribute("href", "https://effect.website");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator('[role="doc-endnotes"]')).toContainText(
    "Rendered from a deterministic fixture.",
  );

  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.locator(".markdown-table")).toHaveAttribute(
    "data-expanded",
    "false",
  );
  await expect(page.locator(".markdown-code .shiki")).toBeVisible();
  await expect(page.locator(".markdown-code")).toHaveAttribute(
    "data-language",
    "typescript",
  );
  await expect(page.getByText("src/showcase.ts")).toBeVisible();

  await page.getByRole("button", { name: "Wrap lines" }).click();
  await expect(
    page.getByRole("button", { name: "Disable line wrap" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Expand table cells" }).click();
  await expect(page.locator(".markdown-table")).toHaveAttribute(
    "data-expanded",
    "true",
  );

  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await page.getByRole("button", { name: "Copy table as Markdown" }).click();
  await expect(
    page.locator(".markdown-table").getByRole("status"),
  ).toContainText("Copied Markdown");

  await page.setViewportSize({ width: 720, height: 780 });
  const geometry = await page.evaluate(() => {
    const code = document.querySelector(".markdown-code__viewport");
    const table = document.querySelector(".markdown-table__viewport");
    const shell = document.querySelector(".role-shell");
    if (
      !(code instanceof HTMLElement) ||
      !(table instanceof HTMLElement) ||
      !(shell instanceof HTMLElement)
    ) {
      throw new Error("Markdown geometry targets are missing");
    }
    return {
      codeClient: code.clientWidth,
      codeScroll: code.scrollWidth,
      documentScroll: document.documentElement.scrollWidth,
      shellScroll: shell.scrollWidth,
      tableClient: table.clientWidth,
      tableScroll: table.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  expect(geometry.documentScroll).toBe(geometry.viewport);
  expect(geometry.shellScroll).toBe(geometry.viewport);
  expect(geometry.codeScroll).toBeGreaterThanOrEqual(geometry.codeClient);
  expect(geometry.tableScroll).toBeGreaterThanOrEqual(geometry.tableClient);

  for (const name of [
    "Disable line wrap",
    "Copy code",
    "Collapse table cells",
    "Copy table as Markdown",
    "Copy table as CSV",
  ]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box, `${name} should be rendered`).not.toBeNull();
    expect(box?.height ?? 0, `${name} touch target`).toBeGreaterThanOrEqual(44);
  }
});

test("keeps a reader's position until they choose to jump to new activity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await shapeFirstInterface(page);

  const input = page.getByRole("textbox", { name: "Message Flect" });
  await input.fill("Show the Markdown showcase");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Markdown showcase" }),
  ).toBeVisible();

  const conversation = page.getByRole("log", {
    name: "Flect conversation",
  });
  const conversationScroll = conversation.locator(".conversation__scroll");
  await expect
    .poll(() =>
      conversationScroll.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await conversationScroll.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });

  await input.fill("Open the latest project");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: /Jump to latest/ }),
  ).toBeVisible();
  expect(
    await conversationScroll.evaluate((element) => element.scrollTop),
  ).toBeLessThan(50);

  await page.getByRole("button", { name: /Jump to latest/ }).click();
  await expect
    .poll(() =>
      conversationScroll.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(48);
});

test("rolls back accepted local changes without exposing proposal ceremony", async ({
  page,
}) => {
  await shapeFirstInterface(page);

  await page
    .getByRole("textbox", { name: "Message Flect" })
    .fill("Create it again");
  await page.getByRole("button", { name: "Send to Flect" }).click();
  await expect(
    page.getByRole("status", { name: "Workbench status" }),
  ).toContainText("Flect is ready");
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Undo last change" }).click();

  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);
});

test("supports model search, keyboard resizing, collapse, and focus restoration", async ({
  page,
}) => {
  await shapeFirstInterface(page);
  await page.getByRole("button", { name: "Model: Auto via Pi" }).click();
  await expect
    .poll(() =>
      page.locator(".role-shell").evaluate((shell) => shell.scrollLeft),
    )
    .toBe(0);
  const modelPickerBox = await page
    .getByRole("dialog", { name: "Choose model" })
    .boundingBox();
  expect(modelPickerBox).not.toBeNull();
  expect(modelPickerBox?.x ?? 0).toBeGreaterThanOrEqual(0);
  expect(
    (modelPickerBox?.x ?? 0) + (modelPickerBox?.width ?? 0),
  ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await page.getByRole("searchbox", { name: "Search models" }).fill("determin");
  await page
    .getByRole("radio", {
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

test("connects a Pi provider and selects reasoning entirely inside Flect", async ({
  page,
}) => {
  await page.reload();
  await page.getByRole("button", { name: "Model: Auto via Pi" }).click();

  await expect(
    page.getByRole("region", { name: "Pi providers" }),
  ).toBeVisible();
  await expect(page.getByText("Flect browser test")).toBeVisible();
  await page.getByRole("radio", { name: "High" }).click();
  await expect(page.getByRole("radio", { name: "High" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await page.getByRole("button", { name: "Connect" }).click();
  await expect
    .poll(async () =>
      page.getByRole("dialog", { name: "Choose model" }).isVisible(),
    )
    .toBe(false);
  await page.getByRole("button", { name: "Model: Auto via Pi" }).click();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "High" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeEnabled();

  await page.keyboard.press("Escape");
  await shapeFirstInterface(page);
  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Model: Auto via Pi" }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    page.getByText("Active private sessions will restart."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm disconnect" }).click();
  await expect
    .poll(async () =>
      page.getByRole("dialog", { name: "Choose model" }).isVisible(),
    )
    .toBe(false);
  await page.getByRole("button", { name: "Model: Auto via Pi" }).click();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();
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

  for (const name of [
    "Safe mode",
    "Select element",
    "Collapse agent",
    "Fix with Flect",
    "Actions",
    "Model: Auto via Pi",
    "Send to Flect",
  ]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box, `${name} should be rendered`).not.toBeNull();
    expect(
      box?.height ?? 0,
      `${name} touch target height`,
    ).toBeGreaterThanOrEqual(44);
  }
});

test("uses the canvas as a full-height Settings workspace", async ({
  page,
}) => {
  await shapeFirstInterface(page);

  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const settings = page.locator(".diagnostics-panel--workspace");
  const rail = page.locator(".agent-rail-container");
  const settingsBox = await settings.boundingBox();
  const railBox = await rail.boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(settingsBox?.x).toBe(0);
  expect(settingsBox?.width ?? 0).toBeCloseTo(railBox?.x ?? 0, -1);

  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeFocused();

  await page.setViewportSize({ width: 720, height: 780 });
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(settings).toHaveCSS("width", "720px");
  await expect(rail).toBeHidden();
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
      localStorage.removeItem("flect.git-activation.v1");
    },
    { builtIn: defaultInterfaceDocument, promptless: promptlessDocument },
  );
  await page.goto(`/?workspace=promptless-${Date.now()}`);

  await expect(
    page.getByRole("heading", { name: "Read-only dashboard" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Flect agent" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Flect" })
    .fill("Unsent continuity to inspect");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("flect.role-continuity.v1")),
    )
    .toContain("Unsent continuity to inspect");

  await page.goto("/?safe=1");
  await expect(
    page.locator(".topbar").getByText("Safe mode", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Custom interface state is bypassed."),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Message Flect" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Restore interface" }),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session continuity" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("flect-role-continuity.json");
  await page
    .getByRole("button", { name: "Discard session continuity" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("flect.role-continuity.v1")),
    )
    .toBeNull();
  await page.getByRole("button", { name: "Restore interface" }).click();
  await expect(
    page.getByText("Custom interface state is bypassed."),
  ).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.has("safe"))
    .toBe(false);
  await page.reload();
  await expect(
    page.getByText("Custom interface state is bypassed."),
  ).toHaveCount(0);
});

test("supports keyboard shaping and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".role-shell")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );

  const input = page.getByRole("textbox", { name: "Message Flect" });
  await input.fill("Use the keyboard");
  completedShapePages.add(page);
  await input.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Import decision" }),
  ).toHaveCount(0);
  await expect(input).toBeEnabled();
});

test("lets an outside agent drive the same reactive workspace through flect", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Enable local control" }).click();
  await expect(
    page.getByRole("button", { name: "Disable local control" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();

  await expect
    .poll(async () => {
      try {
        const snapshot = (await runFlect("inspect")) as {
          readonly workspaceId?: string;
        };
        return snapshot.workspaceId;
      } catch {
        return undefined;
      }
    })
    .toBe("workspace-local-default");

  completedShapePages.add(page);
  await runFlect("shape", "Create a focused project overview");
  await expect(
    page.getByRole("heading", { name: "Focused project overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bash details" }).first(),
  ).toContainText("Completed");

  const repository = (await runFlect("repository", "status")) as {
    readonly acceptedCommit?: string;
    readonly proposalCommit?: string;
    readonly dirty?: boolean;
  };
  expect(repository.acceptedCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(repository.proposalCommit).toBeUndefined();
  expect(repository.dirty).toBe(false);

  await runFlect("prompt", "Open the latest project");
  completedPromptPages.add(page);
  await expect(page.getByText("The product action completed.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bash details" }).first(),
  ).toContainText("Completed");

  const logs = (await runFlect("logs")) as {
    readonly operations?: ReadonlyArray<{
      readonly clientId?: string;
      readonly category?: string;
      readonly phase?: string;
    }>;
  };
  expect(
    logs.operations?.some(
      (operation) =>
        operation.clientId?.startsWith("client-") &&
        operation.category === "command" &&
        operation.phase === "succeeded",
    ),
  ).toBe(true);

  const beforeSafeMode = (await runFlect("repository", "status")) as {
    readonly acceptedCommit?: string;
  };
  await runFlect("safe", "enter");
  await expect(page.locator(".topbar .safe-mode")).toBeVisible();
  const enteredSafeMode = (await runFlect("repository", "status")) as {
    readonly acceptedCommit?: string;
  };
  expect(enteredSafeMode.acceptedCommit).toBe(beforeSafeMode.acceptedCommit);
  await runFlect("safe", "restore");
  await expect(page.locator(".topbar .safe-mode")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Safe mode" })).toBeVisible();
  await expect
    .poll(async () => {
      const restored = (await runFlect("repository", "status")) as {
        readonly acceptedCommit?: string;
      };
      return restored.acceptedCommit;
    })
    .not.toBe(enteredSafeMode.acceptedCommit);
  await runFlect("control", "disable");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(
    page.getByRole("button", { name: "Enable local control" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".topbar .safe-mode")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "What do you want to make?" }),
  ).toBeVisible();
});
