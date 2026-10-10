import {
  type CameraEdit,
  type CaptureMode,
  DEFAULT_EDIT,
} from "@goscreen/render-engine";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useEditor } from "@/modules/studio/store/editor";

// What the next recording captures. Per machine, so it survives restarts.
// Canvas and Scene are not stored: they follow the view on screen, so
// recording never jumps to a view the user did not pick.
type CaptureSettings = {
  deviceOnly: boolean;
  // Canvas/Scene takes also saved as one recording per device.
  separate: boolean;
  // The live webcam bubble; the editor starts from this layout.
  bubble: CameraEdit;
  // Devices are kept by name: AVFoundation renumbers them whenever one comes
  // or goes (iPhone Continuity, Bluetooth, virtual mics), so a stored index
  // ends up pointing at another, often silent, device.
  camera: string | null;
  microphone: string | null;
  barOpen: boolean;
  setDeviceOnly: (deviceOnly: boolean) => void;
  setSeparate: (separate: boolean) => void;
  setCamera: (camera: string | null) => void;
  setMicrophone: (microphone: string | null) => void;
  setBarOpen: (open: boolean) => void;
  setBubble: (patch: Partial<CameraEdit>) => void;
};

export const useCaptureSettings = create<CaptureSettings>()(
  persist(
    (set) => ({
      deviceOnly: false,
      separate: false,
      bubble: DEFAULT_EDIT.camera,
      camera: null,
      microphone: null,
      barOpen: false,
      setDeviceOnly: (deviceOnly) => set({ deviceOnly }),
      setSeparate: (separate) => set({ separate }),
      setCamera: (camera) => set({ camera }),
      setMicrophone: (microphone) => set({ microphone }),
      setBarOpen: (barOpen) => set({ barOpen }),
      setBubble: (patch) => set((s) => ({ bubble: { ...s.bubble, ...patch } })),
    }),
    {
      name: "goscreen.capture",
      version: 2,
      // v1 stored indexes, which may now name another device: pick again.
      migrate: (state, version) => {
        const s = state as Partial<CaptureSettings>;
        return version < 2 ? { ...s, camera: null, microphone: null } : s;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        deviceOnly: s.deviceOnly,
        separate: s.separate,
        bubble: s.bubble,
        camera: s.camera,
        microphone: s.microphone,
      }),
    },
  ),
);

/** Current index of a device chosen by name; null if it is not connected. */
export function deviceIndex(
  name: string | null,
  list: { index: number; name: string }[],
): number | null {
  if (name === null) return null;
  return list.find((d) => d.name === name)?.index ?? null;
}

/** The area the next capture records: the selected device, or the current view. */
export function captureMode(): CaptureMode {
  return useCaptureSettings.getState().deviceOnly
    ? "device"
    : useEditor.getState().view;
}

export function useCaptureMode(): CaptureMode {
  const deviceOnly = useCaptureSettings((s) => s.deviceOnly);
  const view = useEditor((s) => s.view);
  return deviceOnly ? "device" : view;
}

/** Picks a capture area; Canvas and Scene switch the view so you see what gets recorded. */
export function selectCaptureMode(mode: CaptureMode) {
  useCaptureSettings.getState().setDeviceOnly(mode === "device");
  if (mode !== "device") useEditor.getState().setView(mode);
}
