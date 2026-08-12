import type { PointerEvent } from "react";

const startDrag = (event: PointerEvent<HTMLDivElement>) => {
  if (event.button !== 0) return;
  globalThis.dispatchEvent(new Event("flect:start-window-drag"));
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
