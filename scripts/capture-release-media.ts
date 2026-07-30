import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const runtimeUrl = "http://127.0.0.1:3210/api/runtime";
const shellUrl = "http://127.0.0.1:5173";
const viewport = { width: 1716, height: 916 };

const paths = {
  launcher: resolve(root, "assets/screenshots/flect-launcher.png"),
  shaper: resolve(root, "assets/screenshots/flect-shaper-preview.png"),
  shell: resolve(root, "assets/flect-shell.png"),
  heroSource: resolve(root, "assets/hero-source.html"),
  hero: resolve(root, "assets/flect-hero.png"),
  webm: resolve(root, "assets/demo/flect-v0.1-demo.webm"),
  webp: resolve(root, "assets/demo/flect-v0.1-demo.webp"),
  mp4: resolve(root, "dist-release/flect-v0.1.0-demo.mp4"),
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
  await page.getByText("Pi ready").waitFor();
};

const clearInterfaceState = async (page: Page) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Pi ready").waitFor();
};

const openPreview = async (page: Page) => {
  await page.getByRole("button", { name: "Shape interface" }).click();
  const instruction = page.getByLabel("Describe the interface change");
  await instruction.waitFor();
  await page.getByText("Extensions isolated").waitFor();
  await instruction.fill("Make the headline say Focused workspace");
  await page.getByRole("button", { name: "Propose change" }).click();
  await page.getByRole("heading", { name: "Focused workspace" }).waitFor();
  await page.getByText("Previewing a validated proposal").waitFor();
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
    await page.screenshot({
      path: paths.launcher,
      animations: "disabled",
    });

    await openPreview(page);
    await page.screenshot({
      path: paths.shaper,
      animations: "disabled",
    });
    await context.close();
  } finally {
    await browser.close();
  }
};

const recordDemo = async (videoDirectory: string) => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "no-preference",
      recordVideo: {
        dir: videoDirectory,
        size: { width: 1280, height: 684 },
      },
    });
    const page = await context.newPage();
    const video = page.video();
    if (video === null) {
      throw new Error("Playwright did not create a release demo video.");
    }

    await waitForShell(page);
    await clearInterfaceState(page);
    await page.waitForTimeout(900);

    await page.getByRole("button", { name: "Shape interface" }).click();
    const instruction = page.getByLabel("Describe the interface change");
    await instruction.waitFor();
    await page.getByText("Extensions isolated").waitFor();
    await page.waitForTimeout(650);
    await instruction.pressSequentially(
      "Make the headline say Focused workspace",
      { delay: 28 },
    );
    await page.waitForTimeout(700);

    await page.getByRole("button", { name: "Propose change" }).click();
    await page.getByRole("heading", { name: "Focused workspace" }).waitFor();
    await page.getByText("Previewing a validated proposal").waitFor();
    await page.waitForTimeout(1_000);

    await page.getByRole("button", { name: "Keep change" }).click();
    await page
      .getByText("Previewing a validated proposal")
      .waitFor({ state: "detached" });
    await page.waitForTimeout(700);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Focused workspace" }).waitFor();
    await page.waitForTimeout(1_100);

    await page.close();
    await context.close();
    await copyFile(await video.path(), paths.webm);
  } finally {
    await browser.close();
  }
};

const captureHero = async () => {
  await copyFile(paths.launcher, paths.shell);
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

const convertDemo = async (videoDirectory: string) => {
  const frameDirectory = resolve(videoDirectory, "frames");
  await mkdir(frameDirectory, { recursive: true });
  await run([
    "ffmpeg",
    "-y",
    "-i",
    paths.webm,
    "-vf",
    "fps=15,scale=1280:-2:flags=lanczos",
    resolve(frameDirectory, "frame-%04d.png"),
  ]);
  const frames = (await readdir(frameDirectory))
    .filter((name) => name.endsWith(".png"))
    .sort()
    .map((name) => resolve(frameDirectory, name));
  if (frames.length === 0) {
    throw new Error("FFmpeg did not produce any release demo frames.");
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
    "-vf",
    "scale=1280:-2:flags=lanczos",
    "-c:v",
    "libx264",
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
await mkdir(dirname(paths.launcher), { recursive: true });
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
  await recordDemo(videoDirectory);
  await captureHero();
  await convertDemo(videoDirectory);

  const heroBytes = await readFile(paths.hero);
  console.log(
    `Captured Flect v0.1 release media (${heroBytes.byteLength} byte hero).`,
  );
} finally {
  for (const child of children.toReversed()) {
    await stopChild(child);
  }
  await rm(videoDirectory, { recursive: true, force: true });
}
