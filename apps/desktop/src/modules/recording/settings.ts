import type { CaptureMode } from "@goscreen/render-engine";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// What the next recording captures. Per machine, so it survives restarts.
type CaptureSettings = {
  mode: CaptureMode;
  camera: number | null;
  microphone: number | null;
  barOpen: boolean;
  setMode: (mode: CaptureMode) => void;
  setCamera: (camera: number | null) => void;
  setMicrophone: (microphone: number | null) => void;
  setBarOpen: (open: boolean) => void;
};

export const useCaptureSettings = create<CaptureSettings>()(
  persist(
    (set) => ({
      mode: "scene",
      camera: null,
      microphone: null,
      barOpen: false,
      setMode: (mode) => set({ mode }),
      setCamera: (camera) => set({ camera }),
      setMicrophone: (microphone) => set({ microphone }),
      setBarOpen: (barOpen) => set({ barOpen }),
    }),
    {
      name: "goscreen.capture",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ mode: s.mode, camera: s.camera, microphone: s.microphone }),
    },
  ),
);
