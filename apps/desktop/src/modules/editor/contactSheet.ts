import {
  contactSheet,
  playingAt,
  sequenceDuration,
  stillTimes,
} from "@goscreen/render-engine";
import { openFrames } from "./exportVideo";
import { assetUrl, currentTimeline, useSession } from "./session";
import { useEdit } from "./store";
import { timecode } from "./timecode";

// A contact sheet of the open montage: many frames drawn by the export
// renderer on one JPEG, each with its timecode and what plays there. The
// AI reads one image where it would have asked for one frame per call.

export type SheetRequest = {
  times?: number[];
  every?: number;
  from?: number;
  to?: number;
  columns?: number;
  width?: number;
};

export async function renderContactSheet(req: SheetRequest): Promise<{
  ms: number;
  width: number;
  height: number;
  times: number[];
  cells: { t: number; timecode: string; playing: string }[];
  jpeg: string;
}> {
  const s = useSession.getState();
  const timeline = currentTimeline();
  if (!s.videoUrl || !timeline) throw new Error("The video is not loaded.");
  const edit = useEdit.getState().edit;
  const times = stillTimes({
    duration: sequenceDuration(edit.clips),
    times: req.times,
    every: req.every,
    from: req.from,
    to: req.to,
  });
  const began = performance.now();
  // Each frame is drawn at the size of its cell: no bigger canvas than needed.
  const probe = contactSheet({ times, aspect: 16 / 9, columns: req.columns, width: req.width });
  const f = await openFrames({
    edit,
    timeline,
    videoUrl: s.videoUrl,
    cameraUrl: s.cameraUrl,
    mediaOffset: s.mediaOffset,
    assetUrl: (a) => assetUrl(edit, a),
    longSide: probe.frame.width,
    fps: 30,
  });
  try {
    const sheet = contactSheet({
      times,
      aspect: f.output.width / f.output.height,
      columns: req.columns,
      width: req.width,
    });
    const canvas = document.createElement("canvas");
    canvas.width = sheet.width;
    canvas.height = sheet.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable.");
    ctx.fillStyle = "#101014";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    const cells = [];
    for (const cell of sheet.cells) {
      await f.draw(Math.round(cell.t * 30));
      ctx.drawImage(f.canvas, cell.x, cell.y, cell.width, cell.height);
      const playing = playingAt(edit.clips, s.chapters, cell.t);
      const label = `${timecode(cell.t)}  ${playing}`.trim();
      ctx.fillStyle = "#e8e8ee";
      ctx.font = `${sheet.fontSize}px ui-monospace, Menlo, monospace`;
      ctx.textBaseline = "middle";
      ctx.fillText(
        label,
        cell.x + 4,
        cell.labelY + sheet.labelHeight / 2,
        cell.width - 8,
      );
      cells.push({ t: cell.t, timecode: timecode(cell.t), playing });
    }
    return {
      ms: Math.round(performance.now() - began),
      width: sheet.width,
      height: sheet.height,
      times,
      cells,
      jpeg: canvas.toDataURL("image/jpeg", 0.85),
    };
  } finally {
    f.close();
  }
}
