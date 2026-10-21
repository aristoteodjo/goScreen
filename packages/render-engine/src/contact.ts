import type { Chapter } from "./schema";
import { placeClips } from "./sequence";
import type { MainClip } from "./types";

// A contact sheet: many frames of the montage on one image, each with its
// timecode and the name of what plays there. The AI looks at one sheet
// instead of asking for frames one by one ("stills cost seconds, renders
// cost minutes"). Layout only; drawing happens in the shell.

export const SHEET = {
  columns: 4,
  every: 2,
  width: 1600,
  maxCells: 48,
  minWidth: 480,
  maxWidth: 3200,
  // Label band under each frame, as a fraction of the cell's width.
  label: 0.075,
  gap: 6,
} as const;

export type SheetCell = {
  t: number;
  x: number;
  y: number;
  width: number;
  height: number;
  // Where the label is drawn (below the picture).
  labelY: number;
};

export type ContactSheet = {
  width: number;
  height: number;
  columns: number;
  cells: SheetCell[];
  // The picture of one cell, in pixels.
  frame: { width: number; height: number };
  fontSize: number;
};

/**
 * The instants a sheet shows: explicit `times`, or one every `every`
 * seconds between `from` and `to`, never more than `maxCells` (the step
 * grows so the whole span still fits).
 */
export function stillTimes(o: {
  duration: number;
  times?: number[];
  every?: number;
  from?: number;
  to?: number;
  maxCells?: number;
}): number[] {
  const max = Math.max(1, o.maxCells ?? SHEET.maxCells);
  const end = Math.max(0, o.duration);
  if (o.times && o.times.length > 0) {
    const picked = o.times
      .filter((t) => Number.isFinite(t))
      .map((t) => Math.min(end, Math.max(0, t)));
    return [...new Set(picked)].sort((a, b) => a - b).slice(0, max);
  }
  const from = Math.min(end, Math.max(0, o.from ?? 0));
  const to = Math.max(from, Math.min(end, o.to ?? end));
  const span = to - from;
  let every = Math.max(0.1, o.every ?? SHEET.every);
  if (span / every + 1 > max) every = span / (max - 1);
  const out: number[] = [];
  for (let t = from; t <= to + 1e-6 && out.length < max; t += every)
    out.push(Math.round(t * 1000) / 1000);
  if (out.length === 0) out.push(from);
  return out;
}

/** Grid of cells for `times` on a sheet `width` px wide; frames keep `aspect` (w/h). */
export function contactSheet(o: {
  times: number[];
  aspect: number;
  columns?: number;
  width?: number;
}): ContactSheet {
  const columns = Math.max(1, Math.min(8, Math.round(o.columns ?? SHEET.columns)));
  const width = Math.round(
    Math.max(SHEET.minWidth, Math.min(SHEET.maxWidth, o.width ?? SHEET.width)),
  );
  const aspect = o.aspect > 0 && Number.isFinite(o.aspect) ? o.aspect : 16 / 9;
  const gap = SHEET.gap;
  const cellWidth = Math.floor((width - gap * (columns + 1)) / columns);
  const frameHeight = Math.max(1, Math.round(cellWidth / aspect));
  const label = Math.max(14, Math.round(cellWidth * SHEET.label));
  const cellHeight = frameHeight + label;
  const rows = Math.max(1, Math.ceil(o.times.length / columns));
  const cells: SheetCell[] = o.times.map((t, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = gap + col * (cellWidth + gap);
    const y = gap + row * (cellHeight + gap);
    return { t, x, y, width: cellWidth, height: frameHeight, labelY: y + frameHeight };
  });
  return {
    width,
    height: gap + rows * (cellHeight + gap),
    columns,
    cells,
    frame: { width: cellWidth, height: frameHeight },
    fontSize: Math.max(10, Math.round(label * 0.62)),
  };
}

/**
 * What plays at timeline time t: the card's title, or the scene caption of
 * the recording clip (from the take's chapters), else "Clip n".
 */
export function playingAt(
  clips: MainClip[],
  chapters: Chapter[],
  t: number,
): string {
  const placed = placeClips(clips);
  if (placed.length === 0) return "";
  const p = placed.find((x) => t < x.end) ?? placed[placed.length - 1];
  if (p.clip.kind === "slide") return p.clip.title.trim() || "Card";
  const clip = p.clip;
  const scene = chapters.find(
    (c) => c.caption && clip.in >= c.start - 0.05 && clip.in < c.end,
  );
  return scene?.caption ?? `Clip ${p.index + 1}`;
}
