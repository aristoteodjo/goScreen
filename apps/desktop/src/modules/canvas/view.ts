import { create } from "zustand";
import type { View } from "./math";

// Canvas camera. Frames never subscribe to it: CanvasRoot writes the
// transform imperatively so panning does not re-render iframes.
type CanvasViewState = View & {
  interacting: boolean;
  setView: (v: View) => void;
  setInteracting: (on: boolean) => void;
};

export const useCanvasView = create<CanvasViewState>((set) => ({
  zoom: 0.5,
  panX: 80,
  panY: 80,
  interacting: false,
  setView: (v) => set(v),
  setInteracting: (interacting) => set({ interacting }),
}));
