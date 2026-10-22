// The beat grid of a music plan: where every beat falls on the timeline
// once the bed is laid on a clip (plan time = offset + in + (t - start)).
// The most asked technique in the shared prompts: "something happens on
// every beat". The editor snaps its movements to this grid.

import type { MusicPlan } from "./plan.ts";

export type Beat = {
  /** Timeline seconds. */
  t: number;
  /** The first beat of a bar (one in four). */
  strong: boolean;
  /** Beat index in the plan. */
  index: number;
};

/** Where on the timeline the bed plays, and from which plan second. */
export type BedPlacement = {
  /** Timeline second the clip starts at. */
  start: number;
  /** Timeline seconds the clip plays. */
  duration: number;
  /** Plan seconds the file starts from (`alignToPayoff`). */
  offset?: number;
  /** Seconds into the file the clip starts (`AudioClip.in`). */
  in?: number;
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Every beat of the plan heard inside the placement, in timeline seconds. */
export function beatGrid(plan: MusicPlan, placed: BedPlacement): Beat[] {
  const beat = 60 / plan.tempo;
  const planAtStart = (placed.offset ?? 0) + (placed.in ?? 0);
  const first = Math.ceil(planAtStart / beat - 1e-6);
  const end = planAtStart + Math.max(0, placed.duration);
  const out: Beat[] = [];
  for (let k = first; k * beat <= end + 1e-6; k += 1) {
    out.push({
      t: round(placed.start + k * beat - planAtStart),
      strong: k % 4 === 0,
      index: k,
    });
  }
  return out;
}

/**
 * The beat nearest to t within `tolerance` seconds, or null. When two beats
 * are as near, the strong one wins.
 */
export function nearestBeat(
  grid: Beat[],
  t: number,
  tolerance: number,
): Beat | null {
  let best: Beat | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const b of grid) {
    const d = Math.abs(b.t - t);
    if (d > tolerance + 1e-9) continue;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && b.strong && !best?.strong)) {
      best = b;
      bestD = d;
    }
  }
  return best;
}
