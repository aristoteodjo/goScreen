import { create } from "zustand";

// Editor UI State: selection and panels. Never persisted with the project.
type EditorState = {
  selectedId: string | null;
  paletteOpen: boolean;
  select: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
};

export const useEditor = create<EditorState>((set) => ({
  selectedId: null,
  paletteOpen: false,
  select: (selectedId) => set({ selectedId }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
