import { z } from "zod";
import { renderContactSheet } from "@/modules/editor/contactSheet";
import {
  exportRunning,
  openForExport,
  previewCurrent,
  STALL_MESSAGE,
} from "@/modules/editor/exportCurrent";
import { defineCommand } from "./registry";

// The AI's visual loop: a contact sheet costs seconds, a draft costs a
// minute, an export costs several. Look at stills, fix, look again, draft a
// scene, then export (which reuses every chunk that did not change).

const video = z
  .string()
  .min(1)
  .describe(
    "Absolute path of a recording, or of a .edit.json montage made without one (projects.videos, tasks.wait, edit.new)",
  );

const base64 = (dataUrl: string) =>
  dataUrl.replace(/^data:image\/jpeg;base64,/, "");

export function registerVisualCommands() {
  defineCommand({
    name: "edit.stills",
    title: "Look at a contact sheet",
    description:
      "Draws many frames of a montage on one JPEG (base64 `screenshot`): by default one every 2 s over the whole timeline, 4 columns, 1600 px wide. Each cell shows its timecode and what plays there (card title or scene caption). Give `times` for exact instants, or `every`/`from`/`to` for a stretch. Seconds, not minutes: the way to check a montage before drafting or exporting.",
    input: z.object({
      video,
      times: z.array(z.number().min(0)).max(48).optional(),
      every: z.number().min(0.1).max(60).optional(),
      from: z.number().min(0).optional(),
      to: z.number().min(0).optional(),
      columns: z.number().int().min(1).max(8).optional(),
      width: z.number().int().min(480).max(3200).optional(),
    }),
    run: async (i) => {
      await openForExport(i.video);
      const r = await renderContactSheet(i);
      return {
        ms: r.ms,
        width: r.width,
        height: r.height,
        cells: r.cells,
        screenshot: base64(r.jpeg),
      };
    },
  });
  defineCommand({
    name: "edit.preview",
    title: "Draft a stretch of the video",
    description: `Renders a small, fast, silent MP4 of a montage between \`from\` and \`to\` seconds (scale 0.25 to 0.5 of 1080p, 10 to 15 fps) into \`<stem>.previews/\` next to the recording; returns the file. The same frames as the export, in a fraction of the time. The goScreen window must be visible: a draft that does not move for 30 s stops with "${STALL_MESSAGE}"`,
    input: z.object({
      video,
      from: z.number().min(0),
      to: z.number().min(0),
      scale: z.number().min(0.25).max(0.5).default(0.5),
      fps: z.number().int().min(10).max(15).default(12),
    }),
    run: async (i) => {
      if (i.to <= i.from) throw new Error("`to` must be after `from`.");
      if (exportRunning())
        throw new Error(
          "An export is already running (export.cancel to stop it).",
        );
      await openForExport(i.video);
      const file = await previewCurrent({
        from: i.from,
        to: i.to,
        scale: i.scale,
        fps: i.fps,
        label: "The AI is drafting",
      });
      return { file, from: i.from, to: i.to, fps: i.fps };
    },
  });
}
