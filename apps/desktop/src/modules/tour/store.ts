import { create } from "zustand";

// Site tour progress. Runtime only.
type TourState = {
  running: boolean;
  index: number;
  total: number;
  page: string | null;
  dialogOpen: boolean;
  set: (patch: Partial<Omit<TourState, "set">>) => void;
};

export const useTour = create<TourState>((set) => ({
  running: false,
  index: 0,
  total: 0,
  page: null,
  dialogOpen: false,
  set: (patch) => set(patch),
}));
