import {
  type EditState,
  ENERGIZE_DEFAULTS,
  energize,
  POP_DEFAULTS,
} from "@goscreen/render-engine";
import { z } from "zod";
import { openForExport } from "@/modules/editor/exportCurrent";
import { cutPopOut } from "@/modules/editor/popout";
import { useEdit } from "@/modules/editor/store";
import { defineCommand } from "./registry";

// What keeps a montage alive, after the dark SaaS references: elements
// that pop out of the screen and float in front, and a pass that adds a
// movement wherever nothing changes for too long. Same functions as the
// "Pop out…" and "Energize" buttons.

type EditAccess = {
  currentEdit: (video: string) => Promise<EditState>;
  applyEdit: (video: string, edit: EditState) => Promise<void>;
};

const video = z
  .string()
  .min(1)
  .describe(
    "Absolute path of a recording, or of a .edit.json montage made without one (projects.videos, edit.new)",
  );

export function registerDynamicCommands({ currentEdit, applyEdit }: EditAccess) {
  defineCommand({
    name: "edit.popOut",
    title: "Pop an element out of the screen",
    description:
      "Cuts a rectangle of the recorded screen at source time `t` (fractions of the glass: `rect` = { u, v, w, h }) into an image asset (`<stem>.assets/pop-<t>-<n>.png`) and places it as a floating layer exactly over that rectangle at that moment, in timeline time: it rises off the screen (scale 1 -> 1 + `lift`, a touch up and towards the centre), carries a soft shadow and a glow of the film's accent, then fades. Needs a recording; `layer` names the device (instance id, from edit.get) when the take has several. Returns the layer id, its start (timeline s) and its box; everything stays editable (keyframes, `shadow`, `glow`).",
    input: z.object({
      video,
      t: z.number().min(0).describe("Source seconds of the frame to cut"),
      rect: z.object({
        u: z.number().min(0).max(1),
        v: z.number().min(0).max(1),
        w: z.number().min(0.01).max(1),
        h: z.number().min(0.01).max(1),
      }),
      layer: z.string().min(1).optional(),
      duration: z.number().min(0.5).max(30).default(POP_DEFAULTS.duration),
      lift: z.number().min(0).max(0.5).default(POP_DEFAULTS.lift),
    }),
    run: async (i) => {
      await openForExport(i.video);
      const cut = await cutPopOut({
        t: i.t,
        layer: i.layer ?? null,
        rect: i.rect,
        duration: i.duration,
        lift: i.lift,
      });
      const edit = useEdit.getState().edit;
      await applyEdit(i.video, {
        ...edit,
        assets: [...edit.assets, cut.asset],
        overlays: [...edit.overlays, cut.overlay],
      });
      return {
        overlay: cut.overlay.id,
        asset: cut.asset.id,
        start: cut.start,
        duration: cut.duration,
        box: cut.box,
      };
    },
  });

  defineCommand({
    name: "edit.energize",
    title: "Keep the montage moving",
    description:
      "Walks the timeline and, wherever nothing changes for more than `every` seconds, adds one movement there: a gentle 1.12× zoom on the recording (following the taps), a 4 % pop of a text already on screen, a slow push on a card. Every hard cut becomes a 0.5 s zoom-through (the camera dives through the outgoing picture into the next one) and the camera drift is switched on. Two added effects never sit closer than 0.2 s; what is already animated is left alone. Returns the list of changes with their time (undoable).",
    input: z.object({
      video,
      every: z.number().min(0.5).max(30).default(ENERGIZE_DEFAULTS.every),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const { edit: next, changes } = energize(edit, { every: i.every });
      if (changes.length > 0) await applyEdit(i.video, next);
      return { changes, count: changes.length };
    },
  });
}
