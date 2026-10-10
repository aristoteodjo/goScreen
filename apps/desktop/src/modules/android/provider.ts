import { createAdbProvider } from "@goscreen/android-source";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Per-machine setting: where adb lives when auto-detection misses it.
type AndroidSettings = {
  adbPath: string | null;
  setAdbPath: (path: string | null) => void;
};

export const useAndroidSettings = create<AndroidSettings>()(
  persist(
    (set) => ({
      adbPath: null,
      setAdbPath: (path) => set({ adbPath: path?.trim() ? path.trim() : null }),
    }),
    {
      name: "goscreen.android",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export const android = createAdbProvider(
  (command, args) => invoke(command, args),
  () => useAndroidSettings.getState().adbPath,
);
