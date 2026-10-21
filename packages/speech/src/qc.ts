import {
  type EditState,
  type Overlay,
  sequenceDuration,
  sourceTimeAt,
  timelineTimesOf,
} from "@goscreen/render-engine";
import { findWord } from "./syncmap";
import { insideWord } from "./tightcut";
import type { Word } from "./words";

// Mechanical quality control of a talking-head montage: pass / fail checks a
// person would otherwise do by eye, plus the real numbers of the cut.

export type FaceBox = { t: number; u: number; v: number; w: number; h: number };

export type QcOptions = {
  // Face rectangles in source time (fractions of the frame).
  faceBoxes?: FaceBox[];
  // Margin kept free around the edges, as a fraction of each side.
  safeZone?: number;
  fps?: number;
  toleranceFrames?: number;
  // The montage is meant to loop (first and last frames alike).
  loop?: boolean;
};

export type QcCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type QcStats = {
  durationSeconds: number;
  clips: number;
  words: number;
  syncedEffects: number;
  failed: number;
};

export type QcReport = { checks: QcCheck[]; stats: QcStats; pass: boolean };

type Box = { x: number; y: number; w: number; h: number };

const boxOf = (o: Overlay): Box => ({
  x: o.x - o.width / 2,
  y: o.y - o.height / 2,
  w: o.width,
  h: o.height,
});

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const label = (o: Overlay) =>
  o.kind === "text" ? `"${o.text.slice(0, 24)}"` : `${o.kind} ${o.id}`;

/** The face box nearest in time, or null. */
export function faceAt(boxes: FaceBox[], t: number): FaceBox | null {
  let best: FaceBox | null = null;
  for (const b of boxes)
    if (best === null || Math.abs(b.t - t) < Math.abs(best.t - t)) best = b;
  return best;
}

/** First timeline time showing source time `s`, or null when it was cut. */
function timelineOf(edit: EditState, s: number): number | null {
  const times = timelineTimesOf(edit.clips, s);
  return times.length > 0 ? times[0] : null;
}

export function qcReport(
  edit: EditState,
  words: Word[],
  {
    faceBoxes = [],
    safeZone = 0.05,
    fps = 30,
    toleranceFrames = 2,
    loop,
  }: QcOptions = {},
): QcReport {
  const checks: QcCheck[] = [];
  const frame = 1 / fps;

  // Effects on their word.
  const synced = edit.overlays.filter((o) => o.syncWord);
  const late = synced.flatMap((o) => {
    const sync = o.syncWord;
    if (!sync) return [];
    const index = findWord(words, sync.word, sync.nth);
    if (index === null) return [`${label(o)}: word "${sync.word}" not found`];
    const expected = timelineOf(edit, words[index].start);
    if (expected === null) return [`${label(o)}: its word was cut`];
    const off = Math.round((o.start - expected) * fps);
    return Math.abs(o.start - expected) <= toleranceFrames * frame + 1e-6
      ? []
      : [`${label(o)}: ${off > 0 ? "+" : ""}${off} frames from "${sync.word}"`];
  });
  checks.push({
    id: "sync",
    label: "Effects land on their word",
    pass: late.length === 0,
    detail:
      synced.length === 0
        ? "no effect is tied to a word"
        : late.length === 0
          ? `${synced.length} effects within ${toleranceFrames} frames`
          : late.join("; "),
  });

  // Text over the face.
  const onFace = edit.overlays.filter((o) => {
    if (o.kind !== "text" || faceBoxes.length === 0) return false;
    const box = boxOf(o);
    const step = Math.max(0.25, o.duration / 8);
    for (let t = o.start; t <= o.start + o.duration + 1e-6; t += step) {
      const s = sourceTimeAt(edit.clips, t);
      const face = s === null ? null : faceAt(faceBoxes, s);
      if (face && overlaps(box, { x: face.u, y: face.v, w: face.w, h: face.h }))
        return true;
    }
    return false;
  });
  checks.push({
    id: "face",
    label: "No text over the face",
    pass: onFace.length === 0,
    detail:
      faceBoxes.length === 0
        ? "no face box given"
        : onFace.length === 0
          ? "clear"
          : onFace.map(label).join(", "),
  });

  // Safe zone.
  const unsafe = edit.overlays.filter((o) => {
    const b = boxOf(o);
    return (
      b.x < safeZone - 1e-6 ||
      b.y < safeZone - 1e-6 ||
      b.x + b.w > 1 - safeZone + 1e-6 ||
      b.y + b.h > 1 - safeZone + 1e-6
    );
  });
  checks.push({
    id: "safe-zone",
    label: `Layers inside the ${Math.round(safeZone * 100)}% safe zone`,
    pass: unsafe.length === 0,
    detail: unsafe.length === 0 ? "clear" : unsafe.map(label).join(", "),
  });

  // Cuts inside a word.
  const midWord = edit.clips.flatMap((c) =>
    c.kind !== "recording"
      ? []
      : [c.in, c.out]
          .filter((t) => insideWord(words, t, frame))
          .map((t) => `${c.id} at ${t.toFixed(2)}s`),
  );
  checks.push({
    id: "mid-word",
    label: "No cut inside a word",
    pass: midWord.length === 0,
    detail:
      words.length === 0
        ? "no words"
        : midWord.length === 0
          ? "clear"
          : midWord.join(", "),
  });

  // Loop.
  const first = edit.clips[0];
  const last = edit.clips[edit.clips.length - 1];
  const sameCard =
    first?.kind === "slide" &&
    last?.kind === "slide" &&
    first.title === last.title &&
    JSON.stringify(first.background) === JSON.stringify(last.background);
  checks.push({
    id: "loop",
    label: "Last frame matches the first",
    pass: loop === true || sameCard,
    detail: sameCard
      ? "first and last cards match"
      : loop
        ? "declared as a loop"
        : "first and last cards differ (declare loop if intended)",
  });

  // Frozen frames: a clip too short to move.
  const frozen = edit.clips.filter((c) =>
    c.kind === "recording" ? c.out - c.in < frame : c.duration < frame,
  );
  checks.push({
    id: "frozen",
    label: "No empty or frozen clip",
    pass: frozen.length === 0,
    detail: frozen.length === 0 ? "clear" : frozen.map((c) => c.id).join(", "),
  });

  const failed = checks.filter((c) => !c.pass).length;
  return {
    checks,
    stats: {
      durationSeconds: sequenceDuration(edit.clips),
      clips: edit.clips.length,
      words: words.length,
      syncedEffects: synced.length,
      failed,
    },
    pass: failed === 0,
  };
}

/** The QC table as Markdown. */
export function qcMarkdown(report: QcReport): string {
  const rows = report.checks.map(
    (c) => `| ${c.pass ? "pass" : "FAIL"} | ${c.label} | ${c.detail} |`,
  );
  const s = report.stats;
  return [
    "| Result | Check | Detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `${s.durationSeconds.toFixed(1)} s, ${s.clips} clips, ${s.words} words, ${s.syncedEffects} synced effects, ${s.failed} failed.`,
  ].join("\n");
}
