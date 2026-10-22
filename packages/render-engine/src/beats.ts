// Snapping a montage to the beat grid of its music: cards, layers and
// zooms move onto the nearest beat, the take's clips and the voice never
// do. Pure: the grid comes from @goscreen/music (`beatGrid`), the edit
// and the list of what moved come back.

import { isCaptionOverlay } from "./captions";
import { clipAt, placeClips, timelineTimesOf } from "./sequence";
import type { EditState, MainClip, SlideClip } from "./types";

export type Beat = { t: number; strong: boolean };

export type BeatMove = {
  what: "card" | "layer" | "zoom";
  item: string;
  /** Timeline seconds before and after. */
  from: number;
  to: number;
};

export const SNAP_TOLERANCE = 0.25;

/** A card never shrinks under this when its end snaps. */
const MIN_CARD = 0.5;

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The beat nearest to t within the tolerance (strong wins a tie), or null. */
export function nearestBeatAt(
  grid: Beat[],
  t: number,
  tolerance: number,
): Beat | null {
  let best: Beat | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const b of grid) {
    const d = Math.abs(b.t - t);
    if (d > tolerance + 1e-9) continue;
    const tie = Math.abs(d - bestD) < 1e-9;
    if (d < bestD - 1e-9 || (tie && b.strong && !best?.strong)) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/**
 * Each card's end moves to the nearest beat (so what follows it starts on
 * the beat), card by card in order, since a card's length shifts all that
 * follows. A recording clip is never touched: its in, out and speed stay.
 */
function snapCards(
  clips: MainClip[],
  grid: Beat[],
  tolerance: number,
  moves: BeatMove[],
): MainClip[] {
  const out: MainClip[] = [];
  let start = 0;
  for (const c of clips) {
    if (c.kind !== "slide") {
      out.push(c);
      start += (c.out - c.in) / c.speed;
      continue;
    }
    const end = start + c.duration;
    const beat = nearestBeatAt(grid, end, tolerance);
    const duration =
      beat && beat.t - start >= MIN_CARD ? round(beat.t - start) : c.duration;
    const card: SlideClip = { ...c, duration };
    if (Math.abs(duration - c.duration) > 1e-6)
      moves.push({ what: "card", item: c.id, from: round(end), to: round(start + duration) });
    out.push(card);
    start += duration;
  }
  return out;
}

/**
 * Moves the start of every card, layer and zoom onto the nearest beat
 * within `tolerance` seconds (cards: their end, so the next thing starts on
 * the beat). Never a take's clip, never a word-timed caption nor a layer
 * synced to a word, never a sound. Returns the edit and what moved.
 */
export function snapToBeats(
  edit: EditState,
  grid: Beat[],
  options: { tolerance?: number } = {},
): { edit: EditState; moves: BeatMove[] } {
  const tolerance = options.tolerance ?? SNAP_TOLERANCE;
  const moves: BeatMove[] = [];
  if (grid.length === 0) return { edit, moves };
  const clips = snapCards(edit.clips, grid, tolerance, moves);
  const overlays = edit.overlays.map((o) => {
    if (isCaptionOverlay(o) || o.syncWord) return o;
    const beat = nearestBeatAt(grid, o.start, tolerance);
    if (!beat || Math.abs(beat.t - o.start) < 1e-6) return o;
    moves.push({ what: "layer", item: o.id, from: round(o.start), to: beat.t });
    return { ...o, start: beat.t };
  });
  const zooms = edit.zooms.map((z) => {
    const [tl] = timelineTimesOf(clips, z.start);
    if (tl === undefined) return z;
    const beat = nearestBeatAt(grid, tl, tolerance);
    if (!beat || Math.abs(beat.t - tl) < 1e-6) return z;
    const here = clipAt(clips, tl);
    const there = clipAt(clips, beat.t);
    if (!here || !there || here.index !== there.index) return z;
    if (here.clip.kind !== "recording") return z;
    const shift = (beat.t - tl) * here.clip.speed;
    const start = round(z.start + shift);
    if (start < here.clip.in || start >= here.clip.out) return z;
    moves.push({ what: "zoom", item: z.id, from: round(tl), to: beat.t });
    return { ...z, start, end: round(z.end + shift) };
  });
  const placed = placeClips(clips);
  if (moves.length === 0) return { edit, moves };
  return {
    edit: { ...edit, clips: placed.map((p) => p.clip), overlays, zooms },
    moves,
  };
}
