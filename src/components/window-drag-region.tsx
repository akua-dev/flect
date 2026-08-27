import { Effect } from "effect";
import type { PointerEvent } from "react";
import { NativePlatform } from "../lib/native-platform";
import { browserRuntime } from "../lib/runtime";

const startDrag = (event: PointerEvent<HTMLDivElement>) => {
  if (event.button !== 0) return;
  void browserRuntime.runPromise(
    Effect.flatMap(NativePlatform, (platform) => platform.startWindowDrag).pipe(
      Effect.catch(() => Effect.void),
    ),
  );
};

/** Native window movement remains available above every product workspace. */
export const WindowDragRegion = () => (
  <div
    aria-hidden="true"
    className="window-drag-region"
    data-tauri-drag-region
    onPointerDown={startDrag}
  />
);
