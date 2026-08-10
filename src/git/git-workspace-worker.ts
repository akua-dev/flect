/// <reference lib="webworker" />

import { Effect, Schema, type SchemaAST, Semaphore } from "effect";
import initializeWasmGit, {
  type WasmGitModule,
} from "wasm-git/lg2_opfs_async.js";
import {
  GitCheckpointed,
  GitCommandResult,
  GitCommitInspected,
  GitExported,
  GitObjectsImported,
  GitOpened,
  GitRead,
  GitReadAtRef,
  GitRefDeleted,
  GitRefMergeConflict,
  GitRefMerged,
  GitRefMoved,
  GitRefSnapshot,
  GitRemoved,
  GitRepositoryImported,
  GitRepositoryStatus,
  GitShareInspected,
  GitWorkerFailure,
  GitWorkerRequest,
  GitWorkerSuccess,
  GitWorkspaceFailure,
  GitWorkspaceFailureFrame,
  type GitWorkspaceOperation,
  type GitWorkspaceResult,
  GitWritten,
} from "../../shared/git-workspace";
import {
  type DecodedRepositoryArchiveEntry,
  decodeRepositoryTar,
  makeRepositoryTar,
  type RepositoryArchiveEntry,
} from "./repository-tar";

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_EXPORT_FILES = 20_000;
const MANAGED_IDENTITY_START = "# flect-managed-identity:start";
const MANAGED_IDENTITY_END = "# flect-managed-identity:end";
const allowedCommands = new Set([
  "add",
  "checkout",
  "commit",
  "diff",
  "for-each-ref",
  "init",
  "log",
  "merge",
  "reset",
  "rev-parse",
  "status",
  "tag",
]);
const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};
const decodeRequest = Schema.decodeUnknownEffect(
  GitWorkerRequest,
  strictOptions,
);

let modulePromise: Promise<WasmGitModule> | undefined;
let repositoryDirectory: string | undefined;
let stdout: Array<string> = [];
let stderr: Array<string> = [];

const workspaceFailure = (
  operation: GitWorkspaceFailure["operation"],
  reason: GitWorkspaceFailure["reason"],
  message: string,
) => GitWorkspaceFailure.make({ operation, reason, message });

const operationName = (
  operation: GitWorkspaceOperation,
): GitWorkspaceFailure["operation"] => operation.type;

const getErrorName = (error: unknown) => {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return undefined;
  }
  return typeof error.name === "string" ? error.name : undefined;
};

const mapUnknownFailure = (
  operation: GitWorkspaceFailure["operation"],
  error: unknown,
) => {
  const name = getErrorName(error);
  if (name === "QuotaExceededError") {
    return workspaceFailure(
      operation,
      "quota",
      "The browser could not persist the Git workspace because its storage quota was exhausted.",
    );
  }
  return workspaceFailure(
    operation,
    "worker",
    `The embedded Git ${operation} operation failed safely.`,
  );
};

const validateRelativePath = (path: string) => {
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    parts.some((part) => part.length === 0 || part === "." || part === "..") ||
    parts[0] === ".git" ||
    path.includes("\0")
  ) {
    return undefined;
  }
  return parts.join("/");
};

const requireRepository = () => {
  if (repositoryDirectory === undefined) {
    throw workspaceFailure(
      "open",
      "unavailable",
      "Open a Git workspace before using it.",
    );
  }
  return repositoryDirectory;
};

const clearMemfsTree = (module: WasmGitModule, path: string) => {
  try {
    const stat = module.FS.stat(path);
    if (module.FS.isDir(stat.mode)) {
      for (const name of module.FS.readdir(path).filter(
        (entry) => entry !== "." && entry !== "..",
      )) {
        clearMemfsTree(module, `${path}/${name}`);
      }
      module.FS.rmdir(path);
      return;
    }
    module.FS.unlink(path);
  } catch {}
};

const refreshRepositoryCache = async (module: WasmGitModule) => {
  const directory = requireRepository();
  module.FS.chdir("/");
  clearMemfsTree(module, directory);
  if (!(await module.opfsLoadTree(directory))) {
    throw workspaceFailure(
      "open",
      "corrupt",
      "The embedded Git repository disappeared while it was in use.",
    );
  }
  module.FS.chdir(directory);
};

const makeModule = async () => {
  if (modulePromise !== undefined) {
    return modulePromise;
  }
  const root = globalThis as typeof globalThis & {
    wasmGitModuleOverrides?: Readonly<Record<string, unknown>>;
  };
  root.wasmGitModuleOverrides = {
    print: (message: unknown) => stdout.push(String(message)),
    printErr: (message: unknown) => stderr.push(String(message)),
  };
  modulePromise = initializeWasmGit();
  const module = await modulePromise;
  try {
    module.FS.mkdir("/home");
  } catch {}
  try {
    module.FS.mkdir("/home/web_user");
  } catch {}
  module.FS.writeFile(
    "/home/web_user/.gitconfig",
    "[user]\nname = Flect\nemail = workspace@flect.local\n",
  );
  return module;
};

const persistRepositoryIdentity = async (
  module: WasmGitModule,
  directory: string,
) => {
  const path = `${directory}/.git/config`;
  const raw = await module.opfsReadFile(path);
  const source = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  const managedStart = source.indexOf(MANAGED_IDENTITY_START);
  const managedEnd =
    managedStart === -1
      ? -1
      : source.indexOf(MANAGED_IDENTITY_END, managedStart);
  const unmanaged =
    managedStart === -1
      ? source
      : managedEnd === -1
        ? source.slice(0, managedStart)
        : `${source.slice(0, managedStart)}${source.slice(
            managedEnd + MANAGED_IDENTITY_END.length,
          )}`;
  const config = `${unmanaged.trimEnd()}\n\n${MANAGED_IDENTITY_START}\n[user]\n\tname = Flect\n\temail = workspace@flect.local\n[commit]\n\tgpgsign = false\n${MANAGED_IDENTITY_END}\n`;
  await module.opfsWriteFile(path, new TextEncoder().encode(config));
};

const callGit = async (module: WasmGitModule, args: ReadonlyArray<string>) => {
  const directory = requireRepository();
  module.FS.chdir(directory);
  stdout = [];
  stderr = [];
  const result = await module.callMain([...args]);
  const exitCode = typeof result === "number" ? result : 0;
  return GitCommandResult.make({
    type: "command",
    exitCode,
    stdout: stdout.join("\n").slice(0, 1_048_576),
    stderr: stderr.join("\n").slice(0, 1_048_576),
  });
};

const runCommand = async (
  module: WasmGitModule,
  args: ReadonlyArray<string>,
) => {
  const command = args[0];
  if (command === undefined || !allowedCommands.has(command)) {
    throw workspaceFailure(
      "run",
      "unsupported",
      "That Git command is not available in the portable workspace.",
    );
  }
  if (
    args.some(
      (argument) =>
        argument.includes("\0") ||
        argument.includes("\n") ||
        argument === "--git-dir" ||
        argument.startsWith("--git-dir=") ||
        argument === "--work-tree" ||
        argument.startsWith("--work-tree=") ||
        argument === "-c",
    )
  ) {
    throw workspaceFailure(
      "run",
      "invalid-input",
      "The Git command contains an unsupported argument.",
    );
  }
  await refreshRepositoryCache(module);
  return callGit(module, args);
};

const requireCommandSuccess = async (
  operation: GitWorkspaceFailure["operation"],
  module: WasmGitModule,
  args: ReadonlyArray<string>,
) => {
  const result = await callGit(module, args);
  if (result.exitCode !== 0) {
    throw workspaceFailure(
      operation,
      "command",
      `Embedded Git could not complete ${args[0] ?? "the requested command"}.`,
    );
  }
  return result;
};

const resolveRef = async (module: WasmGitModule, ref: string) => {
  const result = await callGit(module, ["rev-parse", ref]);
  const objectId = result.stdout.trim();
  return result.exitCode === 0 && /^[0-9a-f]{40}$/.test(objectId)
    ? objectId
    : undefined;
};

const readLooseCommit = async (module: WasmGitModule, commit: string) => {
  const directory = requireRepository();
  let compressed: string | Uint8Array;
  try {
    compressed = await module.opfsReadFile(
      `${directory}/.git/objects/${commit.slice(0, 2)}/${commit.slice(2)}`,
    );
  } catch {
    throw workspaceFailure(
      "inspect-commit",
      "invalid-ref",
      "The requested Git commit object is unavailable.",
    );
  }
  const bytes =
    typeof compressed === "string"
      ? new TextEncoder().encode(compressed)
      : compressed;
  let decoded: Uint8Array;
  try {
    const stream = new Blob([Uint8Array.from(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));
    decoded = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw workspaceFailure(
      "inspect-commit",
      "corrupt",
      "The requested Git commit object is corrupt.",
    );
  }
  const separator = decoded.indexOf(0);
  if (separator < 1) {
    throw workspaceFailure(
      "inspect-commit",
      "corrupt",
      "The requested Git commit object is corrupt.",
    );
  }
  let header: string;
  try {
    header = new TextDecoder("utf-8", { fatal: true }).decode(
      decoded.slice(0, separator),
    );
  } catch {
    throw workspaceFailure(
      "inspect-commit",
      "corrupt",
      "The requested Git commit object is corrupt.",
    );
  }
  const match = /^commit ([0-9]+)$/.exec(header);
  const body = decoded.slice(separator + 1);
  if (match === null || Number(match[1]) !== body.byteLength) {
    throw workspaceFailure(
      "inspect-commit",
      "corrupt",
      "The requested Git commit object is corrupt.",
    );
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw workspaceFailure(
      "inspect-commit",
      "corrupt",
      "The requested Git commit object is corrupt.",
    );
  }
  const metadataEnd = source.indexOf("\n\n");
  if (metadataEnd === -1) {
    throw workspaceFailure(
      "inspect-commit",
      "corrupt",
      "The requested Git commit object is corrupt.",
    );
  }
  const parents = source
    .slice(0, metadataEnd)
    .split("\n")
    .flatMap((line) => {
      const parent = /^parent ([0-9a-f]{40})$/.exec(line);
      return parent?.[1] === undefined ? [] : [parent[1]];
    });
  if (parents.length > 16) {
    throw workspaceFailure(
      "inspect-commit",
      "corrupt",
      "The requested Git commit has too many parents.",
    );
  }
  return { source, parents };
};

const inspectLooseCommit = async (module: WasmGitModule, commit: string) => {
  const inspected = await readLooseCommit(module, commit);
  return GitCommitInspected.make({
    type: "commit-inspected",
    commit,
    parents: inspected.parents,
  });
};

const writeTwoParentMergeCommit = async (
  module: WasmGitModule,
  sourceCommit: string,
  firstParent: string,
  secondParent: string,
) => {
  const inspected = await readLooseCommit(module, sourceCommit);
  const metadataEnd = inspected.source.indexOf("\n\n");
  const metadata = inspected.source.slice(0, metadataEnd).split("\n");
  if (!/^tree [0-9a-f]{40}$/.test(metadata[0] ?? "")) {
    throw workspaceFailure(
      "merge-ref",
      "corrupt",
      "The shared merge tree could not be verified.",
    );
  }
  const rewritten =
    [
      metadata[0],
      `parent ${firstParent}`,
      `parent ${secondParent}`,
      ...metadata.slice(1).filter((line) => !line.startsWith("parent ")),
    ].join("\n") + inspected.source.slice(metadataEnd);
  const body = new TextEncoder().encode(rewritten);
  const header = new TextEncoder().encode(`commit ${body.byteLength}\0`);
  const object = new Uint8Array(header.byteLength + body.byteLength);
  object.set(header);
  object.set(body, header.byteLength);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-1", Uint8Array.from(object)),
  );
  const commit = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let compressed: Uint8Array;
  try {
    const stream = new Blob([object])
      .stream()
      .pipeThrough(new CompressionStream("deflate"));
    compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw workspaceFailure(
      "merge-ref",
      "unavailable",
      "The shared merge commit could not be persisted.",
    );
  }
  await module.opfsWriteFile(
    `${requireRepository()}/.git/objects/${commit.slice(0, 2)}/${commit.slice(2)}`,
    compressed,
  );
  await refreshRepositoryCache(module);
  if ((await resolveRef(module, commit)) !== commit) {
    throw workspaceFailure(
      "merge-ref",
      "corrupt",
      "The shared merge commit could not be verified.",
    );
  }
  return commit;
};

const sameSourceSnapshot = (
  left: ReadonlyArray<{ readonly path: string; readonly contents: Uint8Array }>,
  right: ReadonlyArray<{
    readonly path: string;
    readonly contents: Uint8Array;
  }>,
) => {
  if (left.length !== right.length) return false;
  const expected = new Map(right.map((file) => [file.path, file.contents]));
  return left.every((file) => {
    const contents = expected.get(file.path);
    return (
      contents !== undefined &&
      contents.byteLength === file.contents.byteLength &&
      contents.every((byte, index) => byte === file.contents[index])
    );
  });
};

const parseConflictPaths = (stdout: string) =>
  stdout
    .split("\n")
    .flatMap((line) => {
      if (line.length < 4) return [];
      const status = line.slice(0, 2);
      if (!new Set(["AA", "AU", "DD", "DU", "UA", "UD", "UU"]).has(status))
        return [];
      const path = line.slice(3).trim();
      return validateRelativePath(path) === undefined ? [] : [path];
    })
    .toSorted()
    .slice(0, 100);

const requireRefGuards = async (
  operation: GitWorkspaceFailure["operation"],
  module: WasmGitModule,
  guards: ReadonlyArray<{ readonly branch: string; readonly commit: string }>,
) => {
  for (const guard of guards) {
    if ((await resolveRef(module, guard.branch)) !== guard.commit) {
      throw workspaceFailure(
        operation,
        "stale-ref",
        guard.branch.endsWith("/base")
          ? "The protected shared base changed before the Git operation could complete."
          : guard.branch.endsWith("/upstream")
            ? "The protected shared upstream changed before the Git operation could complete."
            : guard.branch.endsWith("/fork")
              ? "The protected shared fork changed before the Git operation could complete."
              : "A protected branch changed before the Git operation could complete.",
      );
    }
  }
};

const detachAtCommit = async (
  operation: GitWorkspaceFailure["operation"],
  module: WasmGitModule,
  commit: string,
) => {
  await module.opfsWriteFile(
    `${requireRepository()}/.git/HEAD`,
    new TextEncoder().encode(`${commit}\n`),
  );
  await refreshRepositoryCache(module);
  await requireCommandSuccess(operation, module, ["reset", "--hard", commit]);
  if ((await resolveRef(module, "HEAD")) !== commit) {
    throw workspaceFailure(
      operation,
      "corrupt",
      "The detached Git head could not be verified.",
    );
  }
};

const collectArchiveEntries = (module: WasmGitModule, root: string) => {
  const entries: Array<RepositoryArchiveEntry> = [];
  let totalBytes = 0;
  const visit = (absolute: string, relative: string) => {
    if (entries.length >= MAX_EXPORT_FILES) {
      throw workspaceFailure(
        "export",
        "oversized",
        "The repository contains too many files to export safely.",
      );
    }
    const stat = module.FS.stat(absolute);
    if (module.FS.isDir(stat.mode)) {
      if (relative.length > 0) {
        entries.push({ path: `${relative}/`, kind: "directory" });
      }
      for (const name of module.FS.readdir(absolute)
        .filter((entry) => entry !== "." && entry !== "..")
        .toSorted()) {
        visit(
          `${absolute}/${name}`,
          relative.length === 0 ? name : `${relative}/${name}`,
        );
      }
      return;
    }
    if (module.FS.isLink(stat.mode)) {
      entries.push({
        path: relative,
        kind: "symlink",
        target: module.FS.readlink(absolute),
      });
      return;
    }
    const value = module.FS.readFile(absolute);
    const contents =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    totalBytes += contents.byteLength;
    if (totalBytes > MAX_EXPORT_BYTES) {
      throw workspaceFailure(
        "export",
        "oversized",
        "The repository is too large to export safely.",
      );
    }
    entries.push({ path: relative, kind: "file", contents });
  };
  visit(root, "");
  return entries;
};

const readReachableLooseObject = async (
  module: WasmGitModule,
  objectId: string,
) => {
  let compressed: string | Uint8Array;
  try {
    compressed = await module.opfsReadFile(
      `${requireRepository()}/.git/objects/${objectId.slice(0, 2)}/${objectId.slice(2)}`,
    );
  } catch {
    throw workspaceFailure(
      "export-ref",
      "unsupported",
      "The retained fork contains packed or unavailable Git objects and cannot be exported portably.",
    );
  }
  const bytes =
    typeof compressed === "string"
      ? new TextEncoder().encode(compressed)
      : compressed;
  let decoded: Uint8Array;
  try {
    const stream = new Blob([Uint8Array.from(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));
    decoded = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw workspaceFailure(
      "export-ref",
      "corrupt",
      "The retained fork contains a corrupt Git object.",
    );
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-1", Uint8Array.from(decoded)),
  );
  const actual = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const separator = decoded.indexOf(0);
  let header: string;
  try {
    header = new TextDecoder("utf-8", { fatal: true }).decode(
      decoded.slice(0, separator),
    );
  } catch {
    throw workspaceFailure(
      "export-ref",
      "corrupt",
      "The retained fork contains a corrupt Git object.",
    );
  }
  const match = /^(commit|tree|blob) ([0-9]+)$/.exec(header);
  const body = decoded.slice(separator + 1);
  if (
    actual !== objectId ||
    separator < 1 ||
    match === null ||
    Number(match[2]) !== body.byteLength
  ) {
    throw workspaceFailure(
      "export-ref",
      "corrupt",
      "The retained fork contains a corrupt Git object.",
    );
  }
  return {
    type: match[1] ?? "blob",
    body,
    compressed: Uint8Array.from(bytes),
  };
};

const commitLinks = (body: Uint8Array) => {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw workspaceFailure(
      "export-ref",
      "corrupt",
      "The retained fork contains invalid commit metadata.",
    );
  }
  const metadata = source.slice(0, source.indexOf("\n\n"));
  const links = metadata.split("\n").flatMap((line) => {
    const match = /^(?:tree|parent) ([0-9a-f]{40})$/.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  if (!links.some((link) => metadata.startsWith(`tree ${link}`))) {
    throw workspaceFailure(
      "export-ref",
      "corrupt",
      "The retained fork contains invalid commit metadata.",
    );
  }
  return links;
};

const treeLinks = (body: Uint8Array) => {
  const links: Array<string> = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let offset = 0; offset < body.byteLength; ) {
    const space = body.indexOf(0x20, offset);
    const nul = space < 0 ? -1 : body.indexOf(0, space + 1);
    if (space <= offset || nul <= space + 1 || nul + 21 > body.byteLength) {
      throw workspaceFailure(
        "export-ref",
        "corrupt",
        "The retained fork contains an invalid Git tree.",
      );
    }
    let mode: string;
    let name: string;
    try {
      mode = decoder.decode(body.slice(offset, space));
      name = decoder.decode(body.slice(space + 1, nul));
    } catch {
      throw workspaceFailure(
        "export-ref",
        "corrupt",
        "The retained fork contains an invalid Git tree.",
      );
    }
    if (
      !new Set(["40000", "100644", "100755"]).has(mode) ||
      name.length === 0 ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\\")
    ) {
      throw workspaceFailure(
        "export-ref",
        "unsupported",
        "The retained fork contains an unsupported Git tree entry.",
      );
    }
    links.push(
      Array.from(body.slice(nul + 1, nul + 21), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    );
    offset = nul + 21;
  }
  return links;
};

const exportReachableRef = async (module: WasmGitModule, commit: string) => {
  const pending = [commit];
  const retained = new Map<string, Uint8Array>();
  let totalBytes = 0;
  while (pending.length > 0) {
    const objectId = pending.pop();
    if (objectId === undefined || retained.has(objectId)) continue;
    if (retained.size >= MAX_EXPORT_FILES) {
      throw workspaceFailure(
        "export-ref",
        "oversized",
        "The retained fork contains too many Git objects to export safely.",
      );
    }
    const object = await readReachableLooseObject(module, objectId);
    retained.set(objectId, object.compressed);
    totalBytes += object.compressed.byteLength;
    if (totalBytes > MAX_EXPORT_BYTES) {
      throw workspaceFailure(
        "export-ref",
        "oversized",
        "The retained fork is too large to export safely.",
      );
    }
    if (object.type === "commit") pending.push(...commitLinks(object.body));
    else if (object.type === "tree") pending.push(...treeLinks(object.body));
  }
  const prefixes = [
    ...new Set([...retained.keys()].map((id) => id.slice(0, 2))),
  ].toSorted();
  const entries: Array<RepositoryArchiveEntry> = [
    { path: ".git/", kind: "directory" },
    { path: ".git/objects/", kind: "directory" },
    ...prefixes.map((prefix) => ({
      path: `.git/objects/${prefix}/`,
      kind: "directory" as const,
    })),
    ...[...retained.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([id, contents]) => ({
        path: `.git/objects/${id.slice(0, 2)}/${id.slice(2)}`,
        kind: "file" as const,
        contents,
      })),
  ];
  const archive = makeRepositoryTar(entries);
  if (archive.byteLength > MAX_EXPORT_BYTES) {
    throw workspaceFailure(
      "export-ref",
      "oversized",
      "The retained fork is too large to export safely.",
    );
  }
  return { archive, fileCount: retained.size };
};

const collectQuarantineArchive = (module: WasmGitModule, root: string) => {
  const entries: Array<RepositoryArchiveEntry> = [];
  let totalBytes = 0;
  const visit = (absolute: string, relative: string) => {
    if (entries.length >= MAX_EXPORT_FILES) {
      throw workspaceFailure(
        "inspect-share",
        "oversized",
        "The shared repository contains too many files.",
      );
    }
    const stat = module.FS.stat(absolute);
    if (module.FS.isLink(stat.mode)) {
      throw workspaceFailure(
        "inspect-share",
        "unsupported",
        "The shared repository contains an unsupported filesystem link.",
      );
    }
    if (module.FS.isDir(stat.mode)) {
      entries.push({ path: `${relative}/`, kind: "directory" });
      for (const name of module.FS.readdir(absolute)
        .filter((entry) => entry !== "." && entry !== "..")
        .toSorted()) {
        visit(`${absolute}/${name}`, `${relative}/${name}`);
      }
      return;
    }
    const value = module.FS.readFile(absolute);
    const contents =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    totalBytes += contents.byteLength;
    if (totalBytes > MAX_EXPORT_BYTES) {
      throw workspaceFailure(
        "inspect-share",
        "oversized",
        "The shared repository is too large.",
      );
    }
    entries.push({ path: relative, kind: "file", contents });
  };
  visit(`${root}/.git/objects`, ".git/objects");
  for (const name of module.FS.readdir(root)
    .filter((entry) => entry !== "." && entry !== ".." && entry !== ".git")
    .toSorted()) {
    visit(`${root}/${name}`, name);
  }
  const archive = makeRepositoryTar(entries);
  if (archive.byteLength > MAX_EXPORT_BYTES) {
    throw workspaceFailure(
      "inspect-share",
      "oversized",
      "The shared repository archive is too large.",
    );
  }
  return archive;
};

const collectSourceFiles = async (module: WasmGitModule, root: string) => {
  const files: Array<{ path: string; contents: Uint8Array }> = [];
  let totalBytes = 0;
  const visit = async (absolute: string, relative: string): Promise<void> => {
    const stat = module.FS.stat(absolute);
    if (module.FS.isDir(stat.mode)) {
      for (const name of module.FS.readdir(absolute)
        .filter(
          (entry) =>
            entry !== "." &&
            entry !== ".." &&
            !(relative.length === 0 && entry === ".git"),
        )
        .toSorted()) {
        await visit(
          `${absolute}/${name}`,
          relative.length === 0 ? name : `${relative}/${name}`,
        );
      }
      return;
    }
    if (module.FS.isLink(stat.mode)) {
      throw workspaceFailure(
        "snapshot-ref",
        "unsupported",
        "Source snapshots do not expose filesystem links to an agent workspace.",
      );
    }
    const path = validateRelativePath(relative);
    if (path === undefined) {
      throw workspaceFailure(
        "snapshot-ref",
        "invalid-path",
        "The repository contains a source path that cannot enter an agent workspace.",
      );
    }
    const value = await module.opfsReadFile(absolute);
    const contents =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    totalBytes += contents.byteLength;
    files.push({ path, contents });
    if (files.length > 4_096 || totalBytes > MAX_EXPORT_BYTES) {
      throw workspaceFailure(
        "snapshot-ref",
        "oversized",
        "The repository source exceeds the portable agent-workspace limit.",
      );
    }
  };
  await visit(root, "");
  return files;
};

const executeOperation = async (
  operation: GitWorkspaceOperation,
): Promise<GitWorkspaceResult> => {
  const module = await makeModule();
  switch (operation.type) {
    case "open": {
      const directory = `/opfs/flect-${operation.workspaceId}`;
      if (operation.reset) {
        await module.opfsRemoveTree(directory);
      }
      const existed = await module.opfsLoadTree(directory);
      repositoryDirectory = directory;
      if (!existed) {
        stdout = [];
        stderr = [];
        const result = await module.callMain(["init", directory]);
        if (typeof result === "number" && result !== 0) {
          throw workspaceFailure(
            "open",
            "corrupt",
            "The embedded Git repository could not be initialized.",
          );
        }
      }
      module.FS.chdir(directory);
      await persistRepositoryIdentity(module, directory);
      return GitOpened.make({
        type: "opened",
        variant: "asyncify",
        existed,
      });
    }
    case "write": {
      const relative = validateRelativePath(operation.path);
      if (relative === undefined) {
        throw workspaceFailure(
          "write",
          "invalid-path",
          "The requested path is outside the workspace.",
        );
      }
      if (operation.contents.byteLength > MAX_FILE_BYTES) {
        throw workspaceFailure(
          "write",
          "oversized",
          "The requested file is too large for the workspace.",
        );
      }
      const directory = requireRepository();
      await module.opfsWriteFile(
        `${directory}/${relative}`,
        operation.contents,
      );
      return GitWritten.make({
        type: "written",
        path: relative,
        bytes: operation.contents.byteLength,
      });
    }
    case "read": {
      const relative = validateRelativePath(operation.path);
      if (relative === undefined) {
        throw workspaceFailure(
          "read",
          "invalid-path",
          "The requested path is outside the workspace.",
        );
      }
      const directory = requireRepository();
      const contents = await module.opfsReadFile(`${directory}/${relative}`);
      return GitRead.make({
        type: "read",
        path: relative,
        contents:
          typeof contents === "string"
            ? new TextEncoder().encode(contents)
            : contents,
      });
    }
    case "run":
      return runCommand(module, operation.args);
    case "export": {
      await refreshRepositoryCache(module);
      const directory = requireRepository();
      const entries = collectArchiveEntries(module, directory);
      const archive = makeRepositoryTar(entries);
      return GitExported.make({
        type: "exported",
        archive,
        fileCount: entries.filter((entry) => entry.kind !== "directory").length,
      });
    }
    case "export-ref": {
      await refreshRepositoryCache(module);
      await requireRefGuards("export-ref", module, operation.guards);
      if (
        (await resolveRef(module, operation.branch)) !==
        operation.expectedCommit
      ) {
        throw workspaceFailure(
          "export-ref",
          "stale-ref",
          "The retained fork changed before it could be exported.",
        );
      }
      const exported = await exportReachableRef(
        module,
        operation.expectedCommit,
      );
      return GitExported.make({ type: "exported", ...exported });
    }
    case "remove": {
      const directory = requireRepository();
      await module.opfsRemoveTree(directory);
      repositoryDirectory = undefined;
      return GitRemoved.make({ type: "removed" });
    }
    case "import-repository": {
      const directory = requireRepository();
      let entries: ReadonlyArray<DecodedRepositoryArchiveEntry>;
      try {
        entries = await Effect.runPromise(
          decodeRepositoryTar(operation.archive),
        );
      } catch {
        throw workspaceFailure(
          "import-repository",
          "corrupt",
          "The shared Git repository could not be imported safely.",
        );
      }
      await module.opfsRemoveTree(directory);
      module.FS.chdir("/");
      clearMemfsTree(module, directory);
      stdout = [];
      stderr = [];
      const initialized = await module.callMain(["init", directory]);
      if (typeof initialized === "number" && initialized !== 0) {
        throw workspaceFailure(
          "import-repository",
          "corrupt",
          "The shared Git repository could not be initialized safely.",
        );
      }
      repositoryDirectory = directory;
      for (const entry of entries) {
        if (
          entry.kind === "file" &&
          entry.path.startsWith(".git/objects/") &&
          entry.contents !== undefined
        ) {
          await module.opfsWriteFile(
            `${directory}/${entry.path}`,
            entry.contents,
          );
        }
      }
      await persistRepositoryIdentity(module, directory);
      await refreshRepositoryCache(module);
      if ((await resolveRef(module, operation.commit)) !== operation.commit) {
        throw workspaceFailure(
          "import-repository",
          "corrupt",
          "The shared Git commit is missing or corrupt.",
        );
      }
      for (const protectedRef of [
        "flect/accepted",
        "flect/last-known-good",
        "flect/authoring",
      ]) {
        if ((await resolveRef(module, protectedRef)) !== undefined) {
          throw workspaceFailure(
            "import-repository",
            "invalid-ref",
            "The shared Git repository contains a protected ref.",
          );
        }
      }
      await requireCommandSuccess("import-repository", module, [
        "checkout",
        "--detach",
        operation.commit,
      ]);
      await requireCommandSuccess("import-repository", module, [
        "reset",
        "--hard",
        operation.commit,
      ]);
      const files = await collectSourceFiles(module, directory);
      return GitRepositoryImported.make({
        type: "repository-imported",
        commit: operation.commit,
        fileCount: files.length,
      });
    }
    case "import-objects": {
      await refreshRepositoryCache(module);
      await requireRefGuards("import-objects", module, operation.guards);
      let entries: ReadonlyArray<DecodedRepositoryArchiveEntry>;
      try {
        entries = await Effect.runPromise(
          decodeRepositoryTar(operation.archive),
        );
      } catch {
        throw workspaceFailure(
          "import-objects",
          "corrupt",
          "The shared Git objects could not be imported safely.",
        );
      }
      const directory = requireRepository();
      const objects = entries.filter(
        (entry) =>
          entry.kind === "file" &&
          entry.path.startsWith(".git/objects/") &&
          entry.contents !== undefined,
      );
      if (objects.length === 0) {
        throw workspaceFailure(
          "import-objects",
          "corrupt",
          "The shared Git archive contains no objects.",
        );
      }
      for (const object of objects) {
        if (object.contents === undefined) {
          throw workspaceFailure(
            "import-objects",
            "corrupt",
            "A shared Git object has no contents.",
          );
        }
        await module.opfsWriteFile(
          `${directory}/${object.path}`,
          object.contents,
        );
      }
      await refreshRepositoryCache(module);
      await requireRefGuards("import-objects", module, operation.guards);
      if ((await resolveRef(module, operation.commit)) !== operation.commit) {
        throw workspaceFailure(
          "import-objects",
          "corrupt",
          "The requested shared Git commit is missing or corrupt.",
        );
      }
      return GitObjectsImported.make({
        type: "objects-imported",
        commit: operation.commit,
        objectCount: objects.length,
      });
    }
    case "inspect-commit": {
      await refreshRepositoryCache(module);
      if ((await resolveRef(module, operation.commit)) !== operation.commit) {
        throw workspaceFailure(
          "inspect-commit",
          "invalid-ref",
          "The requested Git commit object is unavailable.",
        );
      }
      return inspectLooseCommit(module, operation.commit);
    }
    case "merge-ref": {
      await refreshRepositoryCache(module);
      await requireRefGuards("merge-ref", module, operation.guards);
      const mergePaths = new Set<string>();
      let mergeBytes = 0;
      const resolvedFiles = operation.files.map((file) => {
        const path = validateRelativePath(file.path);
        mergeBytes += file.contents.byteLength;
        if (
          path === undefined ||
          mergePaths.has(path) ||
          file.contents.byteLength > MAX_FILE_BYTES ||
          mergeBytes > MAX_EXPORT_BYTES
        ) {
          throw workspaceFailure(
            "merge-ref",
            path === undefined || mergePaths.has(path)
              ? "invalid-path"
              : "oversized",
            "The resolved shared merge tree is invalid.",
          );
        }
        mergePaths.add(path);
        return { path, contents: file.contents };
      });
      if (
        (await resolveRef(module, operation.branch)) !==
          operation.expectedCommit ||
        (await resolveRef(module, operation.upstreamBranch)) !==
          operation.expectedUpstreamCommit
      ) {
        throw workspaceFailure(
          "merge-ref",
          "stale-ref",
          "A shared branch changed before the merge could begin.",
        );
      }
      await module.opfsWriteFile(
        `${requireRepository()}/.git/HEAD`,
        new TextEncoder().encode(`${operation.expectedCommit}\n`),
      );
      await refreshRepositoryCache(module);
      if ((await resolveRef(module, "HEAD")) !== operation.expectedCommit) {
        throw workspaceFailure(
          "merge-ref",
          "corrupt",
          "The detached shared merge head could not be verified.",
        );
      }
      await requireCommandSuccess("merge-ref", module, [
        "reset",
        "--hard",
        operation.expectedCommit,
      ]);
      const merge = await callGit(module, [
        "merge",
        "--no-ff",
        "-m",
        operation.message,
        operation.expectedUpstreamCommit,
      ]);
      if (merge.exitCode !== 0) {
        const status = await callGit(module, ["status", "--short"]);
        const paths = parseConflictPaths(status.stdout);
        await requireCommandSuccess("merge-ref", module, [
          "reset",
          "--hard",
          operation.expectedCommit,
        ]);
        if (paths.length === 0) {
          throw workspaceFailure(
            "merge-ref",
            "command",
            "The shared Git merge could not be completed.",
          );
        }
        if (operation.conflictPaths !== undefined) {
          const expected = [...operation.conflictPaths].toSorted();
          const actual = [...paths].toSorted();
          if (
            new Set(expected).size !== expected.length ||
            expected.length !== actual.length ||
            expected.some((path, index) => path !== actual[index])
          ) {
            throw workspaceFailure(
              "merge-ref",
              "stale-ref",
              "The embedded Git conflict paths no longer match the reviewed conflict.",
            );
          }
        } else {
          await requireRefGuards("merge-ref", module, operation.guards);
          return GitRefMergeConflict.make({
            type: "ref-merge-conflict",
            branch: operation.branch,
            commit: operation.expectedCommit,
            conflictPaths: paths,
          });
        }
      }
      await requireCommandSuccess("merge-ref", module, [
        "reset",
        "--hard",
        operation.expectedCommit,
      ]);
      const forkFiles = await collectSourceFiles(module, requireRepository());
      const changed = !sameSourceSnapshot(forkFiles, resolvedFiles);
      let sourceCommit = operation.expectedCommit;
      if (changed) {
        const directory = requireRepository();
        const retained = new Set(resolvedFiles.map((file) => file.path));
        const removals = forkFiles
          .map((file) => file.path)
          .filter((path) => !retained.has(path));
        for (const path of removals) {
          await module.opfsRemoveTree(`${directory}/${path}`);
        }
        for (const file of resolvedFiles) {
          await module.opfsWriteFile(
            `${directory}/${file.path}`,
            file.contents,
          );
        }
        await requireCommandSuccess("merge-ref", module, [
          "add",
          ...resolvedFiles.map((file) => file.path),
          ...removals,
        ]);
        await requireCommandSuccess("merge-ref", module, [
          "commit",
          "-m",
          operation.message,
        ]);
        const committed = await resolveRef(module, "HEAD");
        if (committed === undefined || committed === operation.expectedCommit) {
          throw workspaceFailure(
            "merge-ref",
            "corrupt",
            "The resolved shared merge tree was not committed.",
          );
        }
        sourceCommit = committed;
      }
      const commit = await writeTwoParentMergeCommit(
        module,
        sourceCommit,
        operation.expectedCommit,
        operation.expectedUpstreamCommit,
      );
      const inspected = await inspectLooseCommit(module, commit);
      await detachAtCommit("merge-ref", module, commit);
      await requireCommandSuccess("merge-ref", module, [
        "reset",
        "--hard",
        commit,
      ]);
      const committedFiles = await collectSourceFiles(
        module,
        requireRepository(),
      );
      if (!sameSourceSnapshot(committedFiles, resolvedFiles)) {
        throw workspaceFailure(
          "merge-ref",
          "corrupt",
          "The resolved shared merge tree could not be verified.",
        );
      }
      if (inspected.parents.length !== 2) {
        await requireCommandSuccess("merge-ref", module, [
          "reset",
          "--hard",
          operation.expectedCommit,
        ]);
        throw workspaceFailure(
          "merge-ref",
          "corrupt",
          inspected.parents.length === 0
            ? "The shared merge commit has no parents."
            : inspected.parents.length === 1
              ? inspected.parents[0] === operation.expectedUpstreamCommit
                ? "The shared merge commit kept only the upstream parent."
                : inspected.parents[0] === operation.expectedCommit
                  ? "The shared merge commit kept only the fork parent."
                  : "The shared merge commit has an unexpected single parent."
              : "The shared merge commit has too many parents.",
        );
      }
      if (inspected.parents[0] !== operation.expectedCommit) {
        await requireCommandSuccess("merge-ref", module, [
          "reset",
          "--hard",
          operation.expectedCommit,
        ]);
        throw workspaceFailure(
          "merge-ref",
          "corrupt",
          "The shared merge first parent could not be verified.",
        );
      }
      if (inspected.parents[1] !== operation.expectedUpstreamCommit) {
        await requireCommandSuccess("merge-ref", module, [
          "reset",
          "--hard",
          operation.expectedCommit,
        ]);
        throw workspaceFailure(
          "merge-ref",
          "corrupt",
          "The shared merge second parent could not be verified.",
        );
      }
      await requireRefGuards("merge-ref", module, operation.guards);
      await module.opfsWriteFile(
        `${requireRepository()}/.git/refs/heads/${operation.branch}`,
        new TextEncoder().encode(`${commit}\n`),
      );
      await refreshRepositoryCache(module);
      if ((await resolveRef(module, operation.branch)) !== commit) {
        throw workspaceFailure(
          "merge-ref",
          "corrupt",
          "The shared merge candidate ref could not be verified.",
        );
      }
      return GitRefMerged.make({
        type: "ref-merged",
        branch: operation.branch,
        commit,
        parents: [operation.expectedCommit, operation.expectedUpstreamCommit],
      });
    }
    case "inspect-share": {
      if (operation.url !== undefined) {
        let url: URL;
        try {
          url = new URL(operation.url);
        } catch {
          throw workspaceFailure(
            "inspect-share",
            "invalid-input",
            "The public Git URL is invalid.",
          );
        }
        if (
          url.protocol !== "https:" ||
          url.username.length > 0 ||
          url.password.length > 0
        ) {
          throw workspaceFailure(
            "inspect-share",
            "invalid-input",
            "The public Git URL must be credential-free HTTPS.",
          );
        }
        const directory = requireRepository();
        await module.opfsRemoveTree(directory);
        module.FS.chdir("/");
        clearMemfsTree(module, directory);
        stdout = [];
        stderr = [];
        const cloned = await module.callMain(["clone", url.href, directory]);
        if (typeof cloned === "number" && cloned !== 0) {
          throw workspaceFailure(
            "inspect-share",
            "command",
            "The public Git repository could not be cloned.",
          );
        }
        repositoryDirectory = directory;
        await persistRepositoryIdentity(module, directory);
      }
      await refreshRepositoryCache(module);
      if ((await resolveRef(module, operation.commit)) !== operation.commit) {
        throw workspaceFailure(
          "inspect-share",
          "invalid-ref",
          "The shared Git commit is unavailable.",
        );
      }
      await detachAtCommit("inspect-share", module, operation.commit);
      const files = await collectSourceFiles(module, requireRepository());
      const manifest = files.find((file) => file.path === ".flect/share.json");
      if (
        (operation.manifestRequired && manifest === undefined) ||
        (manifest?.contents.byteLength ?? 0) > 1_048_576
      ) {
        throw workspaceFailure(
          "inspect-share",
          "corrupt",
          "The shared Git repository has no valid share manifest.",
        );
      }
      return GitShareInspected.make({
        type: "share-inspected",
        commit: operation.commit,
        ...(manifest === undefined ? {} : { manifest: manifest.contents }),
        repository: collectQuarantineArchive(module, requireRepository()),
        files,
      });
    }
    case "checkpoint": {
      await refreshRepositoryCache(module);
      for (const guard of operation.guards) {
        if ((await resolveRef(module, guard.branch)) !== guard.commit) {
          throw workspaceFailure(
            "checkpoint",
            "stale-ref",
            "A protected branch changed before the checkpoint could be written.",
          );
        }
      }
      const paths = new Set<string>();
      let totalBytes = 0;
      const files = operation.files.map((file) => {
        const path = validateRelativePath(file.path);
        if (path === undefined || paths.has(path)) {
          throw workspaceFailure(
            "checkpoint",
            "invalid-path",
            "A checkpoint contains an invalid or duplicate path.",
          );
        }
        paths.add(path);
        totalBytes += file.contents.byteLength;
        if (
          file.contents.byteLength > MAX_FILE_BYTES ||
          totalBytes > MAX_EXPORT_BYTES
        ) {
          throw workspaceFailure(
            "checkpoint",
            "oversized",
            "The checkpoint is too large for the portable workspace.",
          );
        }
        return { path, contents: file.contents };
      });
      const removals = operation.removals.map((requestedPath) => {
        const path = validateRelativePath(requestedPath);
        if (path === undefined || paths.has(path)) {
          throw workspaceFailure(
            "checkpoint",
            "invalid-path",
            "A checkpoint contains an invalid or duplicate removal path.",
          );
        }
        paths.add(path);
        return path;
      });
      if (paths.size === 0) {
        throw workspaceFailure(
          "checkpoint",
          "invalid-input",
          "A checkpoint must contain at least one source change.",
        );
      }

      const actual = await resolveRef(module, operation.branch);
      let createBranchAfterCommit = false;
      const sharedBranch = operation.branch.startsWith("flect/shared/");
      if (operation.expectedCommit !== undefined) {
        if (actual !== operation.expectedCommit) {
          throw workspaceFailure(
            "checkpoint",
            "stale-ref",
            "The target branch changed before the checkpoint could be written.",
          );
        }
        if (sharedBranch) {
          await detachAtCommit("checkpoint", module, operation.expectedCommit);
        } else {
          await requireCommandSuccess("checkpoint", module, [
            "checkout",
            operation.branch,
          ]);
          await requireCommandSuccess("checkpoint", module, [
            "reset",
            "--hard",
            operation.expectedCommit,
          ]);
        }
      } else if (operation.baseCommit !== undefined) {
        if (actual === undefined) {
          if (sharedBranch) {
            await detachAtCommit("checkpoint", module, operation.baseCommit);
          } else {
            await requireCommandSuccess("checkpoint", module, [
              "checkout",
              "-b",
              operation.branch,
              operation.baseCommit,
            ]);
          }
        } else if (actual === operation.baseCommit) {
          if (sharedBranch) {
            await detachAtCommit("checkpoint", module, operation.baseCommit);
          } else {
            await requireCommandSuccess("checkpoint", module, [
              "checkout",
              operation.branch,
            ]);
            await requireCommandSuccess("checkpoint", module, [
              "reset",
              "--hard",
              operation.baseCommit,
            ]);
          }
        } else {
          throw workspaceFailure(
            "checkpoint",
            "stale-ref",
            "The proposal branch no longer starts at its expected base commit.",
          );
        }
      } else {
        const head = await resolveRef(module, "HEAD");
        if (actual !== undefined || head !== undefined) {
          throw workspaceFailure(
            "checkpoint",
            "stale-ref",
            "The repository is not empty, so an initial checkpoint cannot replace it.",
          );
        }
        createBranchAfterCommit = true;
      }

      const directory = requireRepository();
      for (const path of removals) {
        await module.opfsRemoveTree(`${directory}/${path}`);
      }
      for (const file of files) {
        await module.opfsWriteFile(`${directory}/${file.path}`, file.contents);
      }
      await requireCommandSuccess("checkpoint", module, [
        "add",
        ...files.map((file) => file.path),
        ...removals,
      ]);
      await requireCommandSuccess("checkpoint", module, [
        "commit",
        "-m",
        operation.message,
      ]);
      if (createBranchAfterCommit) {
        await requireCommandSuccess("checkpoint", module, [
          "checkout",
          "-b",
          operation.branch,
        ]);
      } else if (sharedBranch) {
        const detachedCommit = await resolveRef(module, "HEAD");
        if (detachedCommit === undefined) {
          throw workspaceFailure(
            "checkpoint",
            "corrupt",
            "The shared checkpoint commit could not be resolved.",
          );
        }
        await module.opfsWriteFile(
          `${requireRepository()}/.git/refs/heads/${operation.branch}`,
          new TextEncoder().encode(`${detachedCommit}\n`),
        );
        await refreshRepositoryCache(module);
      }
      const commit = await resolveRef(module, operation.branch);
      if (commit === undefined) {
        throw workspaceFailure(
          "checkpoint",
          "corrupt",
          "The checkpoint commit could not be verified after it was written.",
        );
      }
      const previousCommit = operation.expectedCommit ?? operation.baseCommit;
      if (previousCommit !== undefined && commit === previousCommit) {
        throw workspaceFailure(
          "checkpoint",
          "corrupt",
          "The checkpoint did not advance its protected branch.",
        );
      }
      return GitCheckpointed.make({
        type: "checkpointed",
        branch: operation.branch,
        commit,
      });
    }
    case "read-at-ref": {
      await refreshRepositoryCache(module);
      for (const guard of operation.guards) {
        if ((await resolveRef(module, guard.branch)) !== guard.commit) {
          throw workspaceFailure(
            "read-at-ref",
            "stale-ref",
            "A protected branch changed before the snapshot could be read.",
          );
        }
      }
      const actual = await resolveRef(module, operation.branch);
      if (actual !== operation.expectedCommit) {
        throw workspaceFailure(
          "read-at-ref",
          "stale-ref",
          "The requested branch changed before it could be read.",
        );
      }
      if (operation.branch.startsWith("flect/shared/")) {
        await detachAtCommit("read-at-ref", module, operation.expectedCommit);
      } else {
        await requireCommandSuccess("read-at-ref", module, [
          "checkout",
          operation.branch,
        ]);
        await requireCommandSuccess("read-at-ref", module, [
          "reset",
          "--hard",
          operation.expectedCommit,
        ]);
      }
      const directory = requireRepository();
      const paths = new Set<string>();
      const files = [];
      for (const requestedPath of operation.paths) {
        const path = validateRelativePath(requestedPath);
        if (path === undefined || paths.has(path)) {
          throw workspaceFailure(
            "read-at-ref",
            "invalid-path",
            "The ref read contains an invalid or duplicate path.",
          );
        }
        paths.add(path);
        const contents = await module.opfsReadFile(`${directory}/${path}`);
        files.push({
          path,
          contents:
            typeof contents === "string"
              ? new TextEncoder().encode(contents)
              : contents,
        });
      }
      return GitReadAtRef.make({
        type: "read-at-ref",
        branch: operation.branch,
        commit: operation.expectedCommit,
        files,
      });
    }
    case "snapshot-ref": {
      await refreshRepositoryCache(module);
      for (const guard of operation.guards) {
        if ((await resolveRef(module, guard.branch)) !== guard.commit) {
          throw workspaceFailure(
            "snapshot-ref",
            "stale-ref",
            "A protected branch changed before the source snapshot could be read.",
          );
        }
      }
      if (
        (await resolveRef(module, operation.branch)) !==
        operation.expectedCommit
      ) {
        throw workspaceFailure(
          "snapshot-ref",
          "stale-ref",
          "The requested branch changed before its source could be read.",
        );
      }
      if (operation.branch.startsWith("flect/shared/")) {
        await detachAtCommit("snapshot-ref", module, operation.expectedCommit);
      } else {
        await requireCommandSuccess("snapshot-ref", module, [
          "checkout",
          operation.branch,
        ]);
        await requireCommandSuccess("snapshot-ref", module, [
          "reset",
          "--hard",
          operation.expectedCommit,
        ]);
      }
      return GitRefSnapshot.make({
        type: "ref-snapshot",
        branch: operation.branch,
        commit: operation.expectedCommit,
        files: await collectSourceFiles(module, requireRepository()),
      });
    }
    case "move-ref": {
      await refreshRepositoryCache(module);
      for (const guard of operation.guards) {
        if ((await resolveRef(module, guard.branch)) !== guard.commit) {
          throw workspaceFailure(
            "move-ref",
            "stale-ref",
            "A protected branch changed before the ref could be moved.",
          );
        }
      }
      if ((await resolveRef(module, operation.targetCommit)) === undefined) {
        throw workspaceFailure(
          "move-ref",
          "invalid-ref",
          "The requested recovery target does not exist.",
        );
      }
      const actual = await resolveRef(module, operation.branch);
      if (operation.branch.startsWith("flect/shared/")) {
        if (
          (operation.expectedCommit === undefined && actual !== undefined) ||
          (operation.expectedCommit !== undefined &&
            actual !== operation.expectedCommit)
        ) {
          throw workspaceFailure(
            "move-ref",
            "stale-ref",
            "The shared ref changed before it could be moved.",
          );
        }
        await module.opfsWriteFile(
          `${requireRepository()}/.git/refs/heads/${operation.branch}`,
          new TextEncoder().encode(`${operation.targetCommit}\n`),
        );
        await refreshRepositoryCache(module);
        const commit = await resolveRef(module, operation.branch);
        if (commit !== operation.targetCommit) {
          throw workspaceFailure(
            "move-ref",
            "corrupt",
            "The moved shared ref could not be verified.",
          );
        }
        return GitRefMoved.make({
          type: "ref-moved",
          branch: operation.branch,
          commit,
        });
      }
      if (operation.expectedCommit === undefined) {
        if (actual !== undefined) {
          throw workspaceFailure(
            "move-ref",
            "stale-ref",
            "The target ref already exists unexpectedly.",
          );
        }
        await requireCommandSuccess("move-ref", module, [
          "checkout",
          operation.targetCommit,
        ]);
        await requireCommandSuccess("move-ref", module, [
          "checkout",
          "-b",
          operation.branch,
        ]);
      } else {
        if (actual !== operation.expectedCommit) {
          throw workspaceFailure(
            "move-ref",
            "stale-ref",
            "The target ref changed before it could be moved.",
          );
        }
        await requireCommandSuccess("move-ref", module, [
          "checkout",
          operation.branch,
        ]);
        await requireCommandSuccess("move-ref", module, [
          "reset",
          "--hard",
          operation.targetCommit,
        ]);
      }
      const commit = await resolveRef(module, operation.branch);
      if (commit !== operation.targetCommit) {
        throw workspaceFailure(
          "move-ref",
          "corrupt",
          "The moved ref could not be verified.",
        );
      }
      return GitRefMoved.make({
        type: "ref-moved",
        branch: operation.branch,
        commit,
      });
    }
    case "delete-ref": {
      await refreshRepositoryCache(module);
      if (!operation.branch.startsWith("flect/shared/")) {
        throw workspaceFailure(
          "delete-ref",
          "invalid-ref",
          "Only a namespaced Flect share ref can be deleted.",
        );
      }
      await requireRefGuards("delete-ref", module, operation.guards);
      if (
        (await resolveRef(module, operation.branch)) !==
        operation.expectedCommit
      ) {
        throw workspaceFailure(
          "delete-ref",
          "stale-ref",
          "The shared ref changed before it could be deleted.",
        );
      }
      await detachAtCommit("delete-ref", module, operation.expectedCommit);
      await module.opfsRemoveTree(
        `${requireRepository()}/.git/refs/heads/${operation.branch}`,
      );
      await refreshRepositoryCache(module);
      if ((await resolveRef(module, operation.branch)) !== undefined) {
        throw workspaceFailure(
          "delete-ref",
          "corrupt",
          "The deleted shared ref is still present.",
        );
      }
      await requireRefGuards(
        "delete-ref",
        module,
        operation.guards.filter((guard) => guard.branch !== operation.branch),
      );
      return GitRefDeleted.make({
        type: "ref-deleted",
        branch: operation.branch,
      });
    }
    case "status": {
      await refreshRepositoryCache(module);
      const acceptedCommit = await resolveRef(module, "flect/accepted");
      const lastKnownGoodCommit = await resolveRef(
        module,
        "flect/last-known-good",
      );
      const proposalCommit =
        operation.proposalBranch === undefined
          ? undefined
          : await resolveRef(module, operation.proposalBranch);
      const authoringCommit = await resolveRef(module, "flect/authoring");
      const status = await requireCommandSuccess("status", module, [
        "status",
        "--short",
      ]);
      const lines = status.stdout.split("\n").filter((line) => line.length > 3);
      const conflictCodes = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
      const conflictPaths = lines.flatMap((line) => {
        const path = validateRelativePath(line.slice(3).trim());
        return path !== undefined && conflictCodes.has(line.slice(0, 2))
          ? [path]
          : [];
      });
      return GitRepositoryStatus.make({
        type: "status",
        ...(acceptedCommit === undefined ? {} : { acceptedCommit }),
        ...(lastKnownGoodCommit === undefined ? {} : { lastKnownGoodCommit }),
        ...(operation.proposalBranch === undefined
          ? {}
          : { proposalBranch: operation.proposalBranch }),
        ...(proposalCommit === undefined ? {} : { proposalCommit }),
        ...(authoringCommit === undefined ? {} : { authoringCommit }),
        dirty: lines.length > 0,
        conflictPaths,
      });
    }
  }
};

const handle = (value: unknown) =>
  Effect.gen(function* () {
    const frame = yield* decodeRequest(value);
    const result = yield* Effect.tryPromise({
      try: () => executeOperation(frame.operation),
      catch: (error) =>
        Schema.is(GitWorkspaceFailure)(error)
          ? error
          : mapUnknownFailure(operationName(frame.operation), error),
    });
    return GitWorkerSuccess.make({
      type: "success",
      id: frame.id,
      result,
    });
  }).pipe(
    Effect.catch((error) => {
      const id =
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string" &&
        /^request-[a-z0-9]+$/.test(value.id)
          ? value.id
          : "request-invalid";
      return Effect.succeed(
        GitWorkerFailure.make({
          type: "failure",
          id,
          error: Schema.is(GitWorkspaceFailure)(error)
            ? GitWorkspaceFailureFrame.make({
                reason: error.reason,
                operation: error.operation,
                message: error.message,
              })
            : GitWorkspaceFailureFrame.make({
                reason: "invalid-input",
                operation: "open",
                message: "The embedded Git request was invalid.",
              }),
        }),
      );
    }),
  );

const operationPermit = Effect.runSync(Semaphore.make(1));
worker.addEventListener("message", (event: MessageEvent<unknown>) => {
  Effect.runCallback(
    operationPermit.withPermits(1)(
      handle(event.data).pipe(
        Effect.tap((response) =>
          Effect.sync(() => worker.postMessage(response)),
        ),
      ),
    ),
  );
});
