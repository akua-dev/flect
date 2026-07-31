import type { ShapingSnapshot } from "../../shared/revisions";

export type WorkspacePhase = "blank" | "preview" | "accepted" | "safe";

export const workspacePhase = (
  snapshot: ShapingSnapshot,
  explicitSafeMode: boolean,
): WorkspacePhase => {
  if (explicitSafeMode || snapshot.safeMode) {
    return "safe";
  }
  if (snapshot.proposal?.status === "previewed") {
    return "preview";
  }
  return snapshot.active.source === "built-in" ? "blank" : "accepted";
};
