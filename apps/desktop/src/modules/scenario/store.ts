import { EXAMPLE_SCENARIO } from "@goscreen/scenario";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// The scenario being written (kept between sessions) and the run in progress.
type ScenarioState = {
  text: string;
  // Values of {{vars}}. Secret ones are never stored.
  values: Record<string, string>;
  secrets: string[];
  dialogOpen: boolean;
  running: boolean;
  index: number;
  total: number;
  caption: string | null;
  setText: (text: string) => void;
  setValue: (name: string, value: string) => void;
  setSecrets: (names: string[]) => void;
  set: (
    patch: Partial<
      Pick<
        ScenarioState,
        "dialogOpen" | "running" | "index" | "total" | "caption"
      >
    >,
  ) => void;
};

/** A one-scene scenario on this page and device, to start writing from. */
export function scenarioFor(url: string, deviceId: string, name: string) {
  return JSON.stringify(
    {
      version: 1,
      name,
      url,
      device: { id: deviceId },
      locale: navigator.language || "en-US",
      steps: [
        { do: "scene", caption: "First scene" },
        { do: "wait", ms: 2000 },
        { do: "scroll", by: 500, duration: 1500 },
      ],
    },
    null,
    2,
  );
}

export const useScenario = create<ScenarioState>()(
  persist(
    (set) => ({
      text: JSON.stringify(EXAMPLE_SCENARIO, null, 2),
      values: {},
      secrets: [],
      dialogOpen: false,
      running: false,
      index: 0,
      total: 0,
      caption: null,
      setText: (text) => set({ text }),
      setValue: (name, value) =>
        set((s) => ({ values: { ...s.values, [name]: value } })),
      setSecrets: (secrets) => set({ secrets }),
      set: (patch) => set(patch),
    }),
    {
      name: "goscreen.scenario",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        text: s.text,
        values: Object.fromEntries(
          Object.entries(s.values).filter(([k]) => !s.secrets.includes(k)),
        ),
      }),
    },
  ),
);
