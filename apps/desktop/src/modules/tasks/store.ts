import type { Scenario } from "@goscreen/scenario";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type TaskKind = "record" | "simulate";
export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** A scene the task got through, with what the page looked like at its end. */
export type SceneMark = { caption: string; preview: string | null };

export type Task = {
  id: string;
  kind: TaskKind;
  label: string;
  project: string | null;
  vsl: string | null;
  status: TaskStatus;
  index: number;
  total: number;
  caption: string | null;
  // The page right now (JPEG data URL), refreshed every 1.5 s while running.
  preview: string | null;
  scenes: SceneMark[];
  // Step -> flow node, to colour the flow as the task goes.
  origins: (string | null)[];
  // Scenario as played (vars filled); dropped once the task ends.
  scenario: Scenario | null;
  queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  video: string | null;
  error: string | null;
  shot: string | null;
  failedNode: string | null;
};

type TasksState = {
  tasks: Task[];
  panelOpen: boolean;
  add: (task: Task) => void;
  patch: (id: string, patch: Partial<Task>) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setPanelOpen: (open: boolean) => void;
};

const finished = (t: Task) =>
  t.status === "done" || t.status === "failed" || t.status === "cancelled";

const HISTORY = 30;

// Finished tasks stay listed between sessions (without pictures), so a
// recording made in the background can be found again.
export const useTasks = create<TasksState>()(
  persist(
    (set) => ({
      tasks: [],
      panelOpen: false,
      add: (task) =>
        set((s) => ({ tasks: [task, ...s.tasks], panelOpen: true })),
      patch: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      remove: (id) =>
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      clearFinished: () =>
        set((s) => ({ tasks: s.tasks.filter((t) => !finished(t)) })),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
    }),
    {
      name: "goscreen.tasks",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        tasks: s.tasks
          .filter(finished)
          .slice(0, HISTORY)
          .map((t) => ({
            ...t,
            preview: null,
            scenario: null,
            scenes: t.scenes.map((m) => ({ ...m, preview: null })),
          })),
      }),
    },
  ),
);

export const isFinished = finished;
