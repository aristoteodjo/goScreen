import { parseRecordingFile } from "@goscreen/render-engine";
import {
  buildScenarioEdit,
  type Scenario,
  stepLabel,
} from "@goscreen/scenario";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { ipc } from "@/lib/ipc";
import { registry } from "@/lib/registry";
import { useScenario } from "./store";

const progressSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("step"), index: z.number(), total: z.number() }),
  z.object({ type: z.literal("scene"), caption: z.string() }),
  z.object({ type: z.literal("done") }).passthrough(),
  z.object({ type: z.literal("error") }).passthrough(),
]);

export class ScenarioFailed extends Error {
  constructor(
    message: string,
    readonly shot: string | null,
  ) {
    super(message);
  }
}

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

/**
 * Plays a resolved scenario, then writes its montage next to the take
 * (`buildScenarioEdit`). Returns the video to open in the editor.
 */
export async function runScenario(scenario: Scenario): Promise<string> {
  const device = deviceFor(scenario);
  const store = useScenario.getState();
  store.set({
    running: true,
    index: 0,
    total: scenario.steps.length,
    caption: null,
  });
  const unlisten = await listen("scenario-progress", (e) => {
    const p = progressSchema.safeParse(e.payload);
    if (!p.success) return;
    if (p.data.type === "step")
      useScenario.getState().set({ index: p.data.index, total: p.data.total });
    if (p.data.type === "scene")
      useScenario.getState().set({ caption: p.data.caption });
  });
  try {
    const outcome = await ipc.scenarioRun({ scenario, device });
    if (outcome.status === "failed") {
      const step =
        outcome.index !== null && scenario.steps[outcome.index]
          ? `Step ${outcome.index + 1} (${stepLabel(scenario.steps[outcome.index])}): `
          : "";
      throw new ScenarioFailed(`${step}${outcome.message}`, outcome.shot);
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
    return outcome.videoPath;
  } finally {
    unlisten();
    useScenario.getState().set({ running: false, caption: null });
  }
}
