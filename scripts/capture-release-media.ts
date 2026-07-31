import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const runtimeUrl = "http://127.0.0.1:3210/api/runtime";
const shellUrl = "http://127.0.0.1:5173";
const viewport = { width: 1716, height: 916 };
const stableCaptureStyles = `
  *, *::before, *::after {
    animation: none !important;
    caret-color: transparent !important;
    transition: none !important;
  }
`;

const paths = {
  edit: resolve(root, "assets/screenshots/flect-edit-mode.png"),
  shaper: resolve(root, "assets/screenshots/flect-shaper-preview.png"),
  run: resolve(root, "assets/screenshots/flect-run-mode.png"),
  shell: resolve(root, "assets/flect-shell.png"),
  heroSource: resolve(root, "assets/hero-source.html"),
  hero: resolve(root, "assets/flect-hero.png"),
  webm: resolve(root, "assets/demo/flect-v0.2-demo.webm"),
  webp: resolve(root, "assets/demo/flect-v0.2-demo.webp"),
  mp4: resolve(root, "dist-release/flect-v0.2.0-demo.mp4"),
};

type ChildProcess = ReturnType<typeof Bun.spawn>;

const commandText = (command: ReadonlyArray<string>) =>
  command.length > 16
    ? `${command.slice(0, 12).join(" ")} … (${command.length - 12} more arguments)`
    : command.join(" ");

const run = async (command: ReadonlyArray<string>) => {
  console.log(`$ ${commandText(command)}`);
  const child = Bun.spawn([...command], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${commandText(command)} exited with status ${exitCode}.`);
  }
};

const isReachable = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const requireUnusedPort = async (url: string) => {
  if (await isReachable(url)) {
    throw new Error(
      `Release media needs an unused local endpoint, but ${url} is already serving.`,
    );
  }
};

const waitForServer = async (
  url: string,
  child: ChildProcess,
  label: string,
) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited before ${url} became ready.`);
    }
    if (await isReachable(url)) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`${label} did not become ready at ${url}.`);
};

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null) {
    return;
  }
  child.kill();
  await Promise.race([child.exited, Bun.sleep(2_000)]);
  if (child.exitCode === null) {
    child.kill(9);
    await child.exited;
  }
};

const waitForShell = async (page: Page) => {
  await page.goto(shellUrl, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("textbox", { name: "Message Shaper" }),
  ).toBeEnabled();
};

const clearInterfaceState = async (page: Page) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("textbox", { name: "Message Shaper" }),
  ).toBeEnabled();
};

const openPreview = async (page: Page) => {
  const instruction = page.getByRole("textbox", { name: "Message Shaper" });
  await instruction.fill("Create a focused project overview");
  await instruction.press("Enter");
  await page
    .getByRole("heading", { name: "Focused project overview" })
    .waitFor();
  await page.getByRole("region", { name: "Revision decision" }).waitFor();
};

const waitForAppAgentToSettle = async (page: Page) => {
  await expect(
    page.getByRole("button", { name: "Stop App Agent" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Send to App Agent" }),
  ).toBeDisabled();
};

const enterRunMode = async (page: Page) => {
  await page.getByRole("button", { name: "Keep change" }).click();
  await page.getByRole("button", { name: "Run · App Agent" }).click();
  const instruction = page.getByRole("textbox", {
    name: "Message App Agent",
  });
  await instruction.fill("Open the latest project");
  await instruction.press("Enter");
  await page.getByText("The product action completed.").waitFor();
  await waitForAppAgentToSettle(page);
};

const captureScreenshots = async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await waitForShell(page);
    await clearInterfaceState(page);
    await page.addStyleTag({ content: stableCaptureStyles });
    await page.screenshot({
      path: paths.edit,
      animations: "disabled",
    });

    await openPreview(page);
    await page.screenshot({
      path: paths.shaper,
      animations: "disabled",
    });

    await enterRunMode(page);
    await page.screenshot({
      path: paths.run,
      animations: "disabled",
    });
    await context.close();
  } finally {
    await browser.close();
  }
};

const recordDemo = async (videoDirectory: string) => {
  const frameDirectory = resolve(videoDirectory, "frames");
  const normalizedFrameDirectory = resolve(videoDirectory, "normalized-frames");
  const normalizedStateDirectory = resolve(videoDirectory, "normalized-states");
  await mkdir(frameDirectory, { recursive: true });
  await mkdir(normalizedFrameDirectory, { recursive: true });
  await mkdir(normalizedStateDirectory, { recursive: true });
  const sequenceFrames: Array<string> = [];
  let frameNumber = 0;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    const captureFrames = async (count: number) => {
      const state = resolve(
        frameDirectory,
        `state-${String(frameNumber).padStart(4, "0")}.png`,
      );
      const normalizedStateWebp = resolve(
        normalizedStateDirectory,
        `state-${String(frameNumber).padStart(4, "0")}.webp`,
      );
      const normalizedState = resolve(
        normalizedStateDirectory,
        `state-${String(frameNumber).padStart(4, "0")}.png`,
      );
      await page.screenshot({ path: state, animations: "disabled" });
      await run([
        "cwebp",
        "-quiet",
        "-q",
        "72",
        "-resize",
        "1280",
        "684",
        state,
        "-o",
        normalizedStateWebp,
      ]);
      await run([
        "dwebp",
        "-quiet",
        normalizedStateWebp,
        "-o",
        normalizedState,
      ]);
      for (let index = 0; index < count; index += 1) {
        const frame = resolve(
          normalizedFrameDirectory,
          `demo-${String(frameNumber).padStart(4, "0")}.png`,
        );
        await copyFile(normalizedState, frame);
        sequenceFrames.push(frame);
        frameNumber += 1;
      }
    };

    await waitForShell(page);
    await clearInterfaceState(page);
    await page.addStyleTag({
      content: stableCaptureStyles,
    });
    await page.mouse.move(1, 1);
    await captureFrames(14);

    const instruction = page.getByRole("textbox", { name: "Message Shaper" });
    await instruction.evaluate((element) => {
      element.setAttribute("spellcheck", "false");
    });

    const shapingInstruction = "Create a focused project overview";
    await instruction.fill(shapingInstruction);
    await page.getByRole("heading", { name: "What should we shape?" }).click();
    await captureFrames(24);

    await instruction.press("Enter");
    await page
      .getByRole("heading", { name: "Focused project overview" })
      .waitFor();
    await page.getByRole("region", { name: "Revision decision" }).waitFor();
    await page.mouse.move(1, 1);
    await captureFrames(20);

    await page.getByRole("button", { name: "Keep change" }).click();
    await page
      .getByRole("region", { name: "Revision decision" })
      .waitFor({ state: "detached" });
    await page.mouse.move(1, 1);
    await captureFrames(10);

    await page.getByRole("button", { name: "Run · App Agent" }).click();
    await captureFrames(12);

    const appInstruction = page.getByRole("textbox", {
      name: "Message App Agent",
    });
    await appInstruction.fill("Open the latest project");
    await page
      .getByRole("heading", { name: "Focused project overview" })
      .click();
    await captureFrames(20);
    await appInstruction.press("Enter");
    await page.getByText("The product action completed.").waitFor();
    await waitForAppAgentToSettle(page);
    await page.mouse.move(1, 1);
    await captureFrames(24);
    await context.close();
  } finally {
    await browser.close();
  }

  if (sequenceFrames.length === 0) {
    throw new Error("Playwright did not capture release demo frames.");
  }
  await run([
    "ffmpeg",
    "-y",
    "-framerate",
    "15",
    "-i",
    resolve(normalizedFrameDirectory, "demo-%04d.png"),
    "-map_metadata",
    "-1",
    "-fflags",
    "+bitexact",
    "-c:v",
    "libvpx",
    "-deadline",
    "best",
    "-cpu-used",
    "0",
    "-crf",
    "18",
    "-b:v",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    "-an",
    paths.webm,
  ]);
  return sequenceFrames;
};

const captureHero = async () => {
  await copyFile(paths.edit, paths.shell);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(pathToFileURL(paths.heroSource).href);
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    await page.screenshot({
      path: paths.hero,
      animations: "disabled",
    });
  } finally {
    await browser.close();
  }
};

const convertDemo = async (frames: ReadonlyArray<string>) => {
  if (frames.length === 0) {
    throw new Error("Playwright did not produce any release demo frames.");
  }
  await run([
    "img2webp",
    "-loop",
    "0",
    "-min_size",
    "-d",
    "67",
    "-lossy",
    "-q",
    "72",
    "-m",
    "6",
    ...frames,
    "-o",
    paths.webp,
  ]);
  await run([
    "ffmpeg",
    "-y",
    "-i",
    paths.webm,
    "-map_metadata",
    "-1",
    "-fflags",
    "+bitexact",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    paths.mp4,
  ]);
};

await requireUnusedPort(runtimeUrl);
await requireUnusedPort(shellUrl);
await mkdir(dirname(paths.edit), { recursive: true });
await mkdir(dirname(paths.webm), { recursive: true });
await mkdir(dirname(paths.mp4), { recursive: true });
await run([process.execPath, "run", "build"]);

const videoDirectory = await mkdtemp(join(tmpdir(), "flect-release-media-"));
const children: Array<ChildProcess> = [];

try {
  const runtime = Bun.spawn([process.execPath, "server/index.ts"], {
    cwd: root,
    env: { ...process.env, FLECT_TEST_MODE: "1" },
    stdout: "inherit",
    stderr: "inherit",
  });
  children.push(runtime);
  await waitForServer(runtimeUrl, runtime, "Flect test runtime");

  const preview = Bun.spawn(
    [
      process.execPath,
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
    ],
    {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  children.push(preview);
  await waitForServer(shellUrl, preview, "Flect production preview");

  await captureScreenshots();
  const demoFrames = await recordDemo(videoDirectory);
  await captureHero();
  await convertDemo(demoFrames);

  const heroBytes = await readFile(paths.hero);
  console.log(
    `Captured Flect v0.2 release media (${heroBytes.byteLength} byte hero).`,
  );
} finally {
  for (const child of children.toReversed()) {
    await stopChild(child);
  }
  await rm(videoDirectory, { recursive: true, force: true });
}
