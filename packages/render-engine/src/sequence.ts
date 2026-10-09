import type { MainClip, RecordingClip } from "./types";

// The main track is a sequence: clips play back to back, so removing or
// moving one closes the gap (ripple). Timeline time T runs over the whole
// sequence; a recording clip maps it to source time with `in` and `speed`.

export const MIN_CLIP = 0.2;
export const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4] as const;

/** Stands for "until the end of the source" until its duration is known. */
export const SOURCE_END = 1e9;

export function clipDuration(c: MainClip): number {
  return c.kind === "recording" ? Math.max(0, c.out - c.in) / c.speed : c.duration;
}

export function sequenceDuration(clips: MainClip[]): number {
  return clips.reduce((s, c) => s + clipDuration(c), 0);
}

export type Placed<C extends MainClip = MainClip> = { clip: C; index: number; start: number; end: number };

export function placeClips(clips: MainClip[]): Placed[] {
  let start = 0;
  return clips.map((clip, index) => {
    const end = start + clipDuration(clip);
    const placed = { clip, index, start, end };
    start = end;
    return placed;
  });
}

/** The clip playing at timeline time T (the last one at the very end). */
export function clipAt(clips: MainClip[], t: number): Placed | null {
  const placed = placeClips(clips);
  if (placed.length === 0) return null;
  return placed.find((p) => t < p.end) ?? placed[placed.length - 1];
}

/** Source time shown at timeline time T, or null on a slide. */
export function sourceTimeAt(clips: MainClip[], t: number): number | null {
  const p = clipAt(clips, t);
  if (p?.clip.kind !== "recording") return null;
  const local = Math.min(Math.max(0, t - p.start), p.end - p.start);
  return Math.min(p.clip.out, p.clip.in + local * p.clip.speed);
}

/** Every timeline time that shows source time s (a span can be used twice). */
export function timelineTimesOf(clips: MainClip[], s: number): number[] {
  const out: number[] = [];
  for (const p of placeClips(clips)) {
    if (p.clip.kind !== "recording") continue;
    if (s >= p.clip.in && s < p.clip.out) out.push(p.start + (s - p.clip.in) / p.clip.speed);
  }
  return out;
}

/** Recording clips with their timeline position, for audio and drawing. */
export function recordingSpans(clips: MainClip[]): Placed<RecordingClip>[] {
  return placeClips(clips).filter((p): p is Placed<RecordingClip> => p.clip.kind === "recording");
}

/** Cuts the clip under T in two. Returns the same array when T is too close to an edge. */
export function splitAt(clips: MainClip[], t: number, newId: string): MainClip[] {
  const p = clipAt(clips, t);
  if (!p || t - p.start < MIN_CLIP || p.end - t < MIN_CLIP) return clips;
  const local = t - p.start;
  const c = p.clip;
  const [left, right]: [MainClip, MainClip] =
    c.kind === "recording"
      ? [
          { ...c, out: c.in + local * c.speed },
          { ...c, id: newId, in: c.in + local * c.speed, transition: null },
        ]
      : [
          { ...c, duration: local },
          { ...c, id: newId, duration: c.duration - local, transition: null },
        ];
  return [...clips.slice(0, p.index), left, right, ...clips.slice(p.index + 1)];
}

export function removeClip(clips: MainClip[], id: string): MainClip[] {
  // The sequence never ends empty: the last clip stays.
  if (clips.length <= 1) return clips;
  return clips.filter((c) => c.id !== id);
}

export function moveClip(clips: MainClip[], id: string, toIndex: number): MainClip[] {
  const from = clips.findIndex((c) => c.id === id);
  if (from < 0) return clips;
  const next = clips.filter((c) => c.id !== id);
  const at = Math.max(0, Math.min(next.length, toIndex));
  next.splice(at, 0, clips[from]);
  return next;
}

/** Index a dragged clip lands on when its center sits at timeline time T. */
export function dropIndex(clips: MainClip[], id: string, t: number): number {
  const rest = placeClips(clips.filter((c) => c.id !== id));
  const i = rest.findIndex((p) => t < (p.start + p.end) / 2);
  return i < 0 ? rest.length : i;
}

/**
 * Moves one edge of a clip by `dt` timeline seconds. A recording clip
 * cannot reach past its source (0..sourceDuration).
 */
export function trimClip(
  clips: MainClip[],
  id: string,
  edge: "start" | "end",
  dt: number,
  sourceDuration: number,
): MainClip[] {
  return clips.map((c) => {
    if (c.id !== id) return c;
    if (c.kind === "slide") {
      return { ...c, duration: Math.max(MIN_CLIP, c.duration + (edge === "end" ? dt : -dt)) };
    }
    const min = MIN_CLIP * c.speed;
    if (edge === "start") return { ...c, in: Math.min(Math.max(0, c.in + dt * c.speed), c.out - min) };
    return { ...c, out: Math.max(Math.min(sourceDuration, c.out + dt * c.speed), c.in + min) };
  });
}

export function setSpeed(clips: MainClip[], id: string, speed: number): MainClip[] {
  return clips.map((c) => (c.id === id && c.kind === "recording" ? { ...c, speed } : c));
}

/** Once the source duration is known, no clip may reach past it. */
export function clampToSource(clips: MainClip[], sourceDuration: number): MainClip[] {
  let changed = false;
  const next = clips.map((c) => {
    if (c.kind !== "recording" || c.out <= sourceDuration) return c;
    changed = true;
    return { ...c, out: sourceDuration, in: Math.min(c.in, Math.max(0, sourceDuration - MIN_CLIP)) };
  });
  return changed ? next : clips;
}
