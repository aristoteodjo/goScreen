import { create } from "zustand";
import { type Panel, usePlayback } from "./store";

// Workspaces, the Premiere / After Effects way: the same panels, arranged
// and focused for one job. Each keeps its own panel sizes.

export type WorkspaceId = "edit" | "animation" | "film" | "audio";
export type LeftTab = "project" | "blocks" | "effects" | "scenes";

export const WORKSPACES: {
  id: WorkspaceId;
  label: string;
  left: LeftTab;
  right: Panel | null;
}[] = [
  { id: "edit", label: "Editing", left: "project", right: null },
  { id: "animation", label: "Animation", left: "effects", right: null },
  { id: "film", label: "Film", left: "scenes", right: "film" },
  { id: "audio", label: "Audio", left: "project", right: "audio" },
];

const KEY = "goscreen.editor.workspace";

function stored(): WorkspaceId {
  try {
    const v = localStorage.getItem(KEY);
    if (WORKSPACES.some((w) => w.id === v)) return v as WorkspaceId;
  } catch {}
  return "edit";
}

type WorkspaceStore = {
  workspace: WorkspaceId;
  left: LeftTab;
  setWorkspace: (id: WorkspaceId) => void;
  setLeft: (tab: LeftTab) => void;
};

export const useWorkspace = create<WorkspaceStore>((set) => {
  const workspace = stored();
  return {
    workspace,
    left: WORKSPACES.find((w) => w.id === workspace)?.left ?? "project",
    setWorkspace: (id) => {
      const w = WORKSPACES.find((x) => x.id === id);
      if (!w) return;
      try {
        localStorage.setItem(KEY, id);
      } catch {}
      set({ workspace: id, left: w.left });
      if (w.right) usePlayback.getState().setPanel(w.right);
    },
    setLeft: (left) => set({ left }),
  };
});
