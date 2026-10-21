import { BLANK_DEFAULTS, blankEdit } from "@goscreen/render-engine";
import { z } from "zod";
import { projectsIpc } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { openPlace } from "@/modules/tabs/tabs";
import { defineCommand } from "./registry";

// A montage without a recording: the AI starts from a blank frame, as it
// would with Remotion, then fills it with cards, texts, blocks, compositions
// and media through the other edit.* commands.

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export function registerBlankCommands() {
  defineCommand({
    name: "edit.new",
    title: "Start a montage without a recording",
    description:
      "Creates a video in a project from a blank frame: no screen recording, just one card of `duration` seconds in the chosen format, saved as `<id>.edit.json` in the project folder. Returns `video`, the path every edit.* command then takes in place of a recording (edit.addText, edit.addBlock, edit.addComposition, edit.addMedia, edit.setFilm, edit.stills, edit.preview, export.video...). The main track holds cards only (`slide` clips): a `recording` clip is refused. Zooms, device layers and taps do not exist here; the montage ends with its last card or layer. The editor opens on it.",
    input: z.object({
      project: z.string().min(1).describe("Project id (projects.list)"),
      name: z
        .string()
        .min(1)
        .max(80)
        .describe("Name of the video; its id is derived from it"),
      aspect: z
        .enum(["16:9", "1:1", "4:3", "9:16", "3:4", "4:5"])
        .default(BLANK_DEFAULTS.aspect)
        .describe("Format of the frame"),
      duration: z
        .number()
        .min(1)
        .max(600)
        .default(BLANK_DEFAULTS.duration)
        .describe("Length of the first card, in seconds"),
      background: hex
        .default(BLANK_DEFAULTS.background)
        .describe("Colour of the frame and of the first card (#rrggbb)"),
    }),
    run: async (i) => {
      const edit = blankEdit({
        aspect: i.aspect,
        duration: i.duration,
        background: i.background,
      });
      const video = await projectsIpc.newEdit(i.project, i.name, edit);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      openPlace({ to: "/editor", search: { video } });
      return {
        video,
        aspect: i.aspect,
        duration: i.duration,
        clips: edit.clips.map((c) => c.id),
      };
    },
  });
}
