import { parseRecordingFile } from "@goscreen/render-engine";
import {
  buildScenarioEdit,
  type Scenario,
  stepLabel,
} from "@goscreen/scenario";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { z } from "zod";
import { ipc } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { registry } from "@/lib/registry";
import { type Task, type TaskKind, useTasks } from "./store";

// Background takes and simulations. The runner plays one scenario at a time,
// so tasks wait in line; the studio stays usable while they run.

const progressSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("step"), index: z.number(), total: z.number() }),
  z.object({ type: z.literal("scene"), caption: z.string() }),
  z.object({ type: z.literal("preview"), jpeg: z.string().min(1) }),
  z.object({ type: z.literal("done") }).passthrough(),
  z.object({ type: z.literal("error") }).passthrough(),
]);

/** The browser the runner emulates: the device's viewport, density and UA. */
export function deviceFor(scenario: Scenario) {
  const def = registry.get(scenario.device.id);
  if (!def) throw new Error(`Unknown device "${scenario.device.id}".`);
  const color =
    def.frame.colors.find((c) => c.id === scenario.device.color) ??
    def.frame.colors[0];
  const handheld = def.category === "phone" || def.category === "tablet";
  return {
    id: def.id,
    colorId: color.id,
    width: def.viewport.width,
    height: def.viewport.height,
    dpr: def.viewport.dpr,
    userAgent: def.userAgent,
    mobile: handheld,
    touch: handheld,
  };
}

export type TaskSpec = {
  kind: TaskKind;
  label: string;
  // Resolved: every {{value}} the user had to give is filled.
  scenario: Scenario;
  project?: string | null;
  vsl?: string | null;
  origins?: (string | null)[];
};

let counter = 0;

/** Adds a task; it starts as soon as the ones before it are done. */
export function enqueue(spec: TaskSpec): string {
  deviceFor(spec.scenario);
  counter += 1;
  const id = `task-${Date.now().toString(36)}-${counter}`;
  const task: Task = {
    id,
    kind: spec.kind,
    label: spec.label,
    project: spec.project ?? null,
    vsl: spec.vsl ?? null,
    status: "queued",
    index: 0,
    total: spec.scenario.steps.length,
    caption: null,
    preview: null,
    scenes: [],
    origins: spec.origins ?? [],
    scenario: spec.scenario,
    queuedAt: Date.now(),
    startedAt: null,
    endedAt: null,
    video: null,
    error: null,
    shot: null,
    failedNode: null,
  };
  useTasks.getState().add(task);
  void pump();
  return id;
}

/** Stops a running task, or takes a waiting one out of the line. */
export async function cancelTask(id: string) {
  const task = useTasks.getState().tasks.find((t) => t.id === id);
  if (!task) return;
  if (task.status === "queued") {
    useTasks
      .getState()
      .patch(id, { status: "cancelled", endedAt: Date.now(), scenario: null });
    return;
  }
  if (task.status === "running") await ipc.scenarioCancel();
}

let busy = false;

async function pump() {
  if (busy) return;
  const next = [...useTasks.getState().tasks]
    .reverse()
    .find((t) => t.status === "queued");
  if (!next) return;
  busy = true;
  try {
    await run(next);
  } finally {
    busy = false;
    void pump();
  }
}

async function run(task: Task) {
  const { patch } = useTasks.getState();
  const scenario = task.scenario;
  if (!scenario) return;
  patch(task.id, { status: "running", startedAt: Date.now() });
  const current = () => useTasks.getState().tasks.find((t) => t.id === task.id);

  const unlisten = await listen("scenario-progress", (e) => {
    const p = progressSchema.safeParse(e.payload);
    if (!p.success) return;
    const t = current();
    if (!t) return;
    switch (p.data.type) {
      case "step":
        patch(task.id, { index: p.data.index, total: p.data.total });
        break;
      case "scene": {
        // The scene before this one is over: keep how it ended.
        const scenes = t.scenes.map((m, i) =>
          i === t.scenes.length - 1 && m.preview === null
            ? { ...m, preview: t.preview }
            : m,
        );
        patch(task.id, {
          caption: p.data.caption,
          scenes: [...scenes, { caption: p.data.caption, preview: null }],
        });
        break;
      }
      case "preview":
        patch(task.id, { preview: `data:image/jpeg;base64,${p.data.jpeg}` });
        break;
    }
  });

  try {
    const outcome = await ipc.scenarioRun(
      { scenario, device: deviceFor(scenario) },
      { project: task.project, dry: task.kind === "simulate" },
    );
    const t = current();
    const scenes = (t?.scenes ?? []).map((m, i, all) =>
      i === all.length - 1 && m.preview === null
        ? { ...m, preview: t?.preview ?? null }
        : m,
    );
    if (outcome.status === "failed") {
      const step =
        outcome.index !== null ? scenario.steps[outcome.index] : undefined;
      const cancelled = outcome.message === "Cancelled.";
      patch(task.id, {
        status: cancelled ? "cancelled" : "failed",
        error: step
          ? `Step ${(outcome.index ?? 0) + 1} (${stepLabel(step)}): ${outcome.message}`
          : outcome.message,
        shot: outcome.shot,
        failedNode:
          outcome.index !== null ? (task.origins[outcome.index] ?? null) : null,
        scenes,
      });
      if (!cancelled)
        toast.error(`${task.label} stopped`, {
          description: outcome.message,
        });
      return;
    }
    if (outcome.status === "simulated") {
      patch(task.id, { status: "done", index: scenario.steps.length, scenes });
      toast.success(`${task.label}: every step played`);
      return;
    }
    const opened = await ipc.recordingOpen(outcome.videoPath);
    const take = parseRecordingFile(opened.interactions);
    const edit = buildScenarioEdit(
      {
        chapters: take.chapters,
        pointers: take.pointers,
        layers: take.layers,
        duration: outcome.durationMs / 1000,
      },
      scenario.film,
      scenario.locale,
    );
    await ipc.editSave(outcome.videoPath, edit);
    patch(task.id, { status: "done", video: outcome.videoPath, scenes });
    toast.success(`${task.label} is ready`, {
      description: "Open it from the task panel.",
    });
  } catch (e) {
    patch(task.id, {
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    unlisten();
    patch(task.id, { endedAt: Date.now(), scenario: null });
    if (task.project)
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
  }
}
