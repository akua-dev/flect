import { Layer, ManagedRuntime } from "effect";
import {
  AgentCommandBus,
  type AgentCommandBusShape,
} from "../axi/agent-command-bus";
import { GitWorkspace, type GitWorkspaceShape } from "../git/git-workspace";
import {
  makeLiveRoleSandboxedShellLayer,
  SandboxedShell,
} from "./sandboxed-shell";

export const makeLiveSandboxedShell = async ({
  bus,
  git,
}: {
  readonly bus: AgentCommandBusShape;
  readonly git: GitWorkspaceShape;
}) => {
  const live = makeLiveRoleSandboxedShellLayer({
    app: {
      files: {
        "/workspace/package.json":
          '{\n  "name": "flect-app-workspace",\n  "private": true,\n  "type": "module",\n  "dependencies": {}\n}\n',
        "/workspace/src/index.ts":
          'console.log("Flect app workspace is ready.");\n',
      },
    },
    previewApp: {
      files: {
        "/workspace/package.json":
          '{\n  "name": "flect-preview-app-workspace",\n  "private": true,\n  "type": "module",\n  "dependencies": {}\n}\n',
        "/workspace/src/index.ts":
          'console.log("Flect candidate workspace is ready.");\n',
      },
    },
    shaper: {
      files: {
        "/workspace/package.json":
          '{\n  "name": "flect-shaper-workspace",\n  "private": true,\n  "type": "module",\n  "dependencies": {}\n}\n',
        "/workspace/src/index.ts":
          'console.log("Flect browser workspace is ready.");\n',
      },
    },
  }).pipe(
    Layer.provideMerge(Layer.succeed(AgentCommandBus)(bus)),
    Layer.provideMerge(Layer.succeed(GitWorkspace)(git)),
  );
  const runtime = ManagedRuntime.make(live);
  return {
    service: await runtime.runPromise(SandboxedShell),
    dispose: () => runtime.dispose(),
  };
};
