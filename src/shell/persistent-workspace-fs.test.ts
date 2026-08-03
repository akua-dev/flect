import { MemoryVfs } from "@riftydev/vfs";
import { describe, expect, it } from "vitest";
import {
  makePersistentWorkspaceFs,
  snapshotWorkspaceFiles,
} from "./persistent-workspace-fs";

describe("persistent role workspace filesystem", () => {
  it("persists a namespaced workspace and restores its synchronous index", async () => {
    const vfs = new MemoryVfs();
    const first = await makePersistentWorkspaceFs({
      vfs,
      namespace: "/flect-role-workspaces/default/shaper",
      files: {
        "/workspace/package.json": '{"name":"fixture"}\n',
      },
    });

    await first.mkdir("/workspace/src", { recursive: true });
    await first.writeFile(
      "/workspace/src/index.ts",
      "export const value = 42;\n",
    );

    const reopened = await makePersistentWorkspaceFs({
      vfs,
      namespace: "/flect-role-workspaces/default/shaper",
      files: {
        "/workspace/package.json": '{"name":"stale-default"}\n',
      },
    });
    expect(await reopened.readFile("/workspace/package.json")).toBe(
      '{"name":"fixture"}\n',
    );
    expect(await reopened.readFile("/workspace/src/index.ts")).toBe(
      "export const value = 42;\n",
    );
    expect(reopened.getAllPaths()).toContain("/workspace/src/index.ts");
    expect(await snapshotWorkspaceFiles(reopened)).toEqual([
      {
        path: "package.json",
        contents: new TextEncoder().encode('{"name":"fixture"}\n'),
      },
      {
        path: "src/index.ts",
        contents: new TextEncoder().encode("export const value = 42;\n"),
      },
    ]);
  });

  it("keeps role namespaces separate", async () => {
    const vfs = new MemoryVfs();
    const app = await makePersistentWorkspaceFs({
      vfs,
      namespace: "/flect-role-workspaces/default/app",
      files: { "/workspace/role.txt": "app\n" },
    });
    const shaper = await makePersistentWorkspaceFs({
      vfs,
      namespace: "/flect-role-workspaces/default/shaper",
      files: { "/workspace/role.txt": "shaper\n" },
    });

    await shaper.writeFile("/workspace/role.txt", "changed\n");
    expect(await app.readFile("/workspace/role.txt")).toBe("app\n");
    expect(await shaper.readFile("/workspace/role.txt")).toBe("changed\n");
  });

  it("denies canonical metadata, traversal, links, and read-only writes", async () => {
    const vfs = new MemoryVfs();
    const readOnly = await makePersistentWorkspaceFs({
      vfs,
      namespace: "/flect-role-workspaces/default/app",
      files: { "/workspace/index.ts": "export {};\n" },
      readOnly: true,
    });

    await expect(
      readOnly.writeFile("/workspace/index.ts", "changed\n"),
    ).rejects.toThrow(/read-only/i);
    await expect(
      readOnly.writeFile("/workspace/.git/config", "unsafe\n"),
    ).rejects.toThrow(/protected/i);
    await expect(
      readOnly.writeFile("/workspace/../outside", "unsafe\n"),
    ).rejects.toThrow(/outside/i);
    await expect(
      readOnly.symlink("/workspace/index.ts", "/workspace/link"),
    ).rejects.toThrow(/links/i);
    await expect(
      readOnly.link("/workspace/index.ts", "/workspace/hard-link"),
    ).rejects.toThrow(/links/i);
  });
});
