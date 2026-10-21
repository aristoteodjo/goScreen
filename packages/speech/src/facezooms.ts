import { ZOOM_IN, ZOOM_RAMP, type ZoomSegment } from "@goscreen/render-engine";

// Face zooms for a talking head: wide and close framings alternate at every
// cut, the close one centred on the eyes. Segments live in source time, like
// the cuts; a segment starts before its cut so the camera is already there
// when the cut lands (that lead lives in source time the cut removed).

export type EyeSample = { t: number; u: number; v: number };

export type FaceZoomOptions = {
  wide?: number;
  close?: number;
  // Largest close framing when the source is 1080p or smaller.
  cap1080?: number;
  // Seconds of push-in shown after a cut (the rest of the ramp is hidden).
  pushIn?: number;
  sourceHeight?: number;
  // Which framing the first clip gets.
  startClose?: boolean;
  id?: (i: number) => string;
};

/** The eye sample nearest in time, or null without samples. */
export function eyesAt(eyes: EyeSample[], t: number): EyeSample | null {
  let best: EyeSample | null = null;
  for (const e of eyes)
    if (best === null || Math.abs(e.t - t) < Math.abs(best.t - t)) best = e;
  return best;
}

export type ClipRange = { in: number; out: number };

/**
 * One framing per clip, alternating wide and close (close ones centred on
 * the eyes). The clips are in source seconds and need not touch. Returns a
 * zoom per close clip, none for wide ones (a wide clip shows the whole frame).
 */
export function faceZoomsForClips(
  clips: ClipRange[],
  eyes: EyeSample[],
  {
    wide = 1,
    close = 1.2,
    cap1080 = 1.15,
    pushIn = 0.4,
    sourceHeight,
    startClose = false,
    id = (i) => `face-${i + 1}`,
  }: FaceZoomOptions = {},
): ZoomSegment[] {
  const scale =
    sourceHeight !== undefined && sourceHeight <= 1080
      ? Math.min(close, cap1080)
      : close;
  const out: ZoomSegment[] = [];
  clips.forEach((clip, i) => {
    const isClose = (i % 2 === 0) === startClose;
    if (!isClose || scale <= wide || clip.out - clip.in <= 0) return;
    const eye = eyesAt(eyes, clip.in);
    const lead = Math.max(0, ZOOM_IN - pushIn);
    out.push({
      id: id(out.length),
      start: Math.max(0, clip.in - lead),
      end: clip.out + ZOOM_RAMP,
      scale,
      focus: eye ? { x: eye.u, y: eye.v } : { x: 0.5, y: 0.4 },
    });
  });
  return out;
}

/**
 * `cuts` are the boundaries of the clips in source seconds (n + 1 values for
 * n clips, each clip from cuts[i] to cuts[i+1]); see faceZoomsForClips.
 */
export function faceZooms(
  cuts: number[],
  eyes: EyeSample[],
  options: FaceZoomOptions = {},
): ZoomSegment[] {
  const sorted = [...cuts].sort((a, b) => a - b);
  const clips: ClipRange[] = [];
  for (let i = 0; i + 1 < sorted.length; i++)
    clips.push({ in: sorted[i], out: sorted[i + 1] });
  return faceZoomsForClips(clips, eyes, options);
}

/** The times to look for a face at: the start of each clip (plus a little). */
export function faceTimes(cuts: number[], inset = 0.1): number[] {
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (to - from <= 0) continue;
    out.push(Math.min(from + inset, (from + to) / 2));
  }
  return out;
}
