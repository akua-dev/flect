import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Effect } from "effect";

interface ProcessRecord {
  readonly pid: number;
  readonly parentPid: number;
  readonly command: string;
}

const sourceApp = resolve("src-tauri/target/release/bundle/macos/Flect.app");
const canary = "packaged-recovery-canary-v1";
const waitLimitMs = 15_000;

const command = async (argv: ReadonlyArray<string>) => {
  const child = Bun.spawn([...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Effect.runPromise(
    Effect.all(
      [
        Effect.promise(() => new Response(child.stdout).text()),
        Effect.promise(() => new Response(child.stderr).text()),
        Effect.promise(() => child.exited),
      ],
      { concurrency: "unbounded" },
    ),
  );
  if (exitCode !== 0) {
    throw new Error(
      `${argv[0] ?? "command"} failed (${exitCode}): ${stderr.trim() || stdout.trim()}`,
    );
  }
  return stdout.trim();
};

const processes = async (): Promise<ReadonlyArray<ProcessRecord>> =>
  (await command(["ps", "-axo", "pid=,ppid=,command="]))
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      return match === null
        ? []
        : [
            {
              pid: Number(match[1]),
              parentPid: Number(match[2]),
              command: match[3] ?? "",
            },
          ];
    });

const waitFor = async <A>(
  description: string,
  probe: () => Promise<A | undefined>,
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitLimitMs) {
    const result = await probe().catch(() => undefined);
    if (result !== undefined) return result;
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}.`);
};

const appleScript = (source: string) => command(["osascript", "-e", source]);

const appProcess = (pid: number) =>
  `tell application "System Events" to tell (first process whose unix id is ${pid})`;

const contents = (pid: number) =>
  appleScript(`${appProcess(pid)} to tell front window to get entire contents`);

const numberPair = (value: string) => {
  const [first, second, ...rest] = value
    .split(",")
    .map((part) => Number(part.trim()));
  if (
    first === undefined ||
    second === undefined ||
    rest.length !== 0 ||
    !Number.isFinite(first) ||
    !Number.isFinite(second)
  ) {
    throw new Error(`Invalid native geometry: ${value}`);
  }
  return [first, second] as const;
};

const textareaOperation = (pid: number, operation: string) =>
  appleScript(`
tell application "System Events"
  tell (first process whose unix id is ${pid})
    tell front window
      set composer to missing value
      repeat with candidate in (get entire contents)
        try
          if (role of candidate is "AXTextArea") and (name of candidate is "Message Flect") then
            set composer to contents of candidate
            exit repeat
          end if
        end try
      end repeat
      if composer is missing value then error "The protected composer is missing from the accessibility tree."
      tell composer to ${operation}
    end tell
  end tell
end tell
`);

const textarea = (pid: number, operation: string) =>
  textareaOperation(pid, operation);

const setTextareaValue = (pid: number, value: string) =>
  textareaOperation(pid, `set value to "${value}"`);

const terminate = async (pid: number | undefined, signal: NodeJS.Signals) => {
  if (pid === undefined) return;
  try {
    process.kill(pid, signal);
  } catch {
    return;
  }
  await waitFor(`process ${pid} to stop`, async () => {
    try {
      process.kill(pid, 0);
      return undefined;
    } catch {
      return true;
    }
  });
};

const bundleId = `dev.akua.flect.verification.${crypto.randomUUID().replaceAll("-", "")}`;
const temporaryRoot = await mkdtemp(join(tmpdir(), "flect-packaged-recovery-"));
const canonicalTemporaryRoot = await realpath(temporaryRoot);
const verificationApp = join(temporaryRoot, "Flect Local Verification.app");
const isolatedHome = join(temporaryRoot, "home");
const libraryRoot = join(homedir(), "Library");
const ownedData = [
  join(libraryRoot, "Application Support", bundleId),
  join(libraryRoot, "Caches", bundleId),
  join(libraryRoot, "HTTPStorages", bundleId),
  join(libraryRoot, "Saved Application State", `${bundleId}.savedState`),
  join(libraryRoot, "WebKit", bundleId),
];
let mainPid: number | undefined;

const cleanup = async () => {
  await terminate(mainPid, "SIGTERM").catch(() => undefined);
  for (const path of ownedData) {
    if (!path.startsWith(`${libraryRoot}${sep}`) || !path.includes(bundleId)) {
      throw new Error(`Refusing unsafe verification cleanup target: ${path}`);
    }
    await rm(path, { force: true, recursive: true });
  }
  if (
    !canonicalTemporaryRoot.startsWith(`${await realpath(tmpdir())}${sep}`) ||
    !temporaryRoot.includes("flect-packaged-recovery-")
  ) {
    throw new Error(
      `Refusing unsafe temporary cleanup target: ${temporaryRoot}`,
    );
  }
  await rm(temporaryRoot, { force: true, recursive: true });
};

try {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(
      "Packaged macOS verification requires the supported arm64 macOS host.",
    );
  }
  await access(join(sourceApp, "Contents", "MacOS", "flect"));
  await mkdir(isolatedHome, { mode: 0o700 });
  await command(["ditto", sourceApp, verificationApp]);
  const plist = join(verificationApp, "Contents", "Info.plist");
  await command([
    "/usr/libexec/PlistBuddy",
    "-c",
    `Set :CFBundleIdentifier ${bundleId}`,
    plist,
  ]);
  await command([
    "/usr/libexec/PlistBuddy",
    "-c",
    "Set :CFBundleName Flect Local Verification",
    plist,
  ]);
  await command([
    "codesign",
    "--force",
    "--deep",
    "--sign",
    "-",
    verificationApp,
  ]);
  await command([
    "codesign",
    "--verify",
    "--deep",
    "--strict",
    verificationApp,
  ]);

  const executable = await realpath(
    join(verificationApp, "Contents", "MacOS", "flect"),
  );
  const launch = async (priorPid?: number) => {
    await command([
      "open",
      "-n",
      "--env",
      `HOME=${isolatedHome}`,
      verificationApp,
    ]);
    return waitFor(
      "the isolated Flect process",
      async () =>
        (await processes()).find(
          (entry) => entry.command === executable && entry.pid !== priorPid,
        )?.pid,
    );
  };

  mainPid = await launch();
  const firstContents = await waitFor(
    "the protected setup surface",
    async () => {
      const tree = await contents(mainPid as number);
      return tree.includes("Connect an agent") ? tree : undefined;
    },
  );
  if (
    !firstContents.includes("OpenAI (ChatGPT Plus/Pro)") ||
    !firstContents.includes("Other providers (") ||
    firstContents.includes("Try again")
  ) {
    throw new Error("The clean-profile provider setup is not actionable.");
  }
  const initialTextarea = await textarea(mainPid, "get {enabled, value}");
  if (!initialTextarea.startsWith("true,")) {
    throw new Error("The first clean-profile draft is not editable.");
  }

  const menuBar = await appleScript(
    `${appProcess(mainPid)} to get name of every menu bar item of menu bar 1`,
  );
  if (!["Edit", "Window", "Help"].every((name) => menuBar.includes(name))) {
    throw new Error("The packaged app is missing standard macOS menus.");
  }
  const windowButtonCount = Number(
    await appleScript(
      `${appProcess(mainPid)} to tell front window to get count of buttons`,
    ),
  );
  if (windowButtonCount < 3) {
    throw new Error("The packaged app is missing native window controls.");
  }
  const originalWindowSize = numberPair(
    await appleScript(`${appProcess(mainPid)} to get size of front window`),
  );
  await appleScript(
    `${appProcess(mainPid)} to set size of front window to {480, 320}`,
  );
  const clampedWindowSize = await waitFor(
    "the native minimum window size",
    async () => {
      const size = numberPair(
        await appleScript(
          `${appProcess(mainPid as number)} to get size of front window`,
        ),
      );
      return size[0] >= 760 && size[1] >= 560 ? size : undefined;
    },
  );
  await appleScript(
    `${appProcess(mainPid)} to set size of front window to {${originalWindowSize[0]}, ${originalWindowSize[1]}}`,
  );

  await setTextareaValue(mainPid, canary);
  await waitFor("the private draft canary", async () =>
    (await textarea(mainPid as number, "get value")) === canary
      ? true
      : undefined,
  );
  await Bun.sleep(750);

  const sidecar = await waitFor("one private runtime child", async () => {
    const children = (await processes()).filter(
      (entry) =>
        entry.parentPid === mainPid && entry.command.endsWith("/flect-runtime"),
    );
    return children.length === 1 ? children[0] : undefined;
  });
  process.kill(sidecar.pid, "SIGKILL");
  await waitFor("the private runtime child to stop", async () =>
    (await processes()).some((entry) => entry.pid === sidecar.pid)
      ? undefined
      : true,
  );
  process.kill(mainPid, 0);
  if ((await textarea(mainPid, "get value")) !== canary) {
    throw new Error("The main app lost its draft after private runtime loss.");
  }

  const priorPid = mainPid;
  await terminate(priorPid, "SIGTERM");
  mainPid = await launch(priorPid);
  await waitFor("the restored protected surface", async () =>
    (await contents(mainPid as number)).includes("Connect an agent")
      ? true
      : undefined,
  );
  const restoredDraft = await waitFor(
    "the restored private draft",
    async () => {
      const value = await textarea(mainPid as number, "get value");
      return value === canary ? value : undefined;
    },
  );
  const relaunchedSidecar = await waitFor(
    "the relaunched private runtime",
    async () =>
      (await processes()).find(
        (entry) =>
          entry.parentPid === mainPid &&
          entry.command.endsWith("/flect-runtime"),
      ),
  );
  const windowCount = Number(
    await appleScript(`${appProcess(mainPid)} to get count of windows`),
  );
  if (windowCount !== 1) {
    throw new Error("The relaunched app did not own exactly one window.");
  }

  console.log(
    JSON.stringify(
      {
        type: "flect-packaged-macos",
        signature: "verified-ad-hoc",
        isolatedBundle: true,
        isolatedPiHome: true,
        actionableProviderSetup: true,
        passiveRetryAbsent: true,
        editableFirstDraft: true,
        nativeMenus: true,
        nativeWindowControls: windowButtonCount,
        minimumWindow: clampedWindowSize,
        mainSurvivedSidecarKill: true,
        restoredDraft: restoredDraft === canary,
        relaunchedSidecar: relaunchedSidecar.pid > 0,
        windows: windowCount,
      },
      null,
      2,
    ),
  );
} finally {
  await cleanup();
}
