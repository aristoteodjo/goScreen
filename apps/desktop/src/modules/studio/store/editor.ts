import { create } from "zustand";

export type ViewMode = "canvas" | "scene";

// Editor UI State: selection, view and panels. Never persisted with the project.
type EditorState = {
  view: ViewMode;
  selectedId: string | null;
  paletteOpen: boolean;
  setView: (view: ViewMode) => void;
  select: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
};

export const useEditor = create<EditorState>((set) => ({
  view: "canvas",
  selectedId: null,
  paletteOpen: false,
  setView: (view) => set({ view }),
  select: (selectedId) => set({ selectedId }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
