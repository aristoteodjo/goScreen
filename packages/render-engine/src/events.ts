// Every movement of a montage, listed with its time: what the automatic
// sound design puts a sound on, and what the beat grid may pull onto a
// beat. Pure: the edit (and the take's pointers, for clicks) in, events
// out, sorted by time. The kinds match @goscreen/music's `MotionKind`.

import { isCaptionOverlay } from "./captions";
import { placeClips, timelineTimesOf } from "./sequence";
import { transitionLength } from "./transitions";
import type { EditState, Overlay, RecordedPointer } from "./types";

export type MotionKind =
  | "enter"
  | "exit"
  | "pop"
  | "zoom-in"
  | "zoom-out"
  | "transition"
  | "click"
  | "tick"
  | "title"
  | "card"
  | "scene";

export type MotionEvent = {
  /** Timeline seconds. */
  t: number;
  kind: MotionKind;
  /** 0..1: a title card weighs more than a tick. */
  weight: number;
  /** The clip, layer, zoom or counter it comes from. */
  item?: string;
};

/** A scale key that jumps by this much within `POP_WINDOW` seconds is a pop. */
const POP_JUMP = 0.15;
const POP_WINDOW = 0.3;

/** The `stat-counter` block counts from 0.2 s to 1.8 s after it appears; any other counter over its first 60 %. */
const COUNTER = { from: 0.2, to: 1.8, steps: 8 };

const round = (n: number) => Math.round(n * 1000) / 1000;

const ENTER_WEIGHT: Record<Overlay["kind"], number> = {
  text: 0.8,
  video: 0.7,
  image: 0.6,
  shape: 0.4,
  blur: 0.3,
};

/** A text layer that shines (glow, sweep, flash) or a scene caption is a title. */
function isTitle(o: Overlay): boolean {
  if (o.kind !== "text") return false;
  if (o.id.startsWith("caption-") && !isCaptionOverlay(o)) return true;
  return Boolean(o.style.sweep || o.style.flash || (o.style.glow ?? 0) > 0);
}

/** A rendered counter block (`stat-counter`, `kinetic-counter`) or a composition named like one. */
function isCounter(o: Overlay): boolean {
  if (o.kind !== "video" || !o.source) return false;
  return ("block" in o.source ? o.source.block : o.source.composition).includes("counter");
}

/** When a counter's steps fall, from its start. */
function counterSteps(o: Overlay): { from: number; to: number } {
  const stat = o.kind === "video" && o.source && "block" in o.source && o.source.block === "stat-counter";
  return stat ? COUNTER : { from: 0.2, to: Math.max(0.4, o.duration * 0.6) };
}

/** Keys of the scale track that jump up quickly: each is a pop. */
function popsOf(o: Overlay): number[] {
  const keys = o.keyframes?.scale;
  if (!keys || keys.length < 2) return [];
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const out: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (b.value - a.value >= POP_JUMP && b.t - a.t <= POP_WINDOW)
      out.push(b.t);
  }
  return out;
}

/**
 * Every movement of the montage in timeline seconds: cards and scenes of
 * the main track (and their transitions), entrances and exits of layers
 * (word-timed captions excepted: they follow the voice), pops (a `pop` or
 * `spring` entrance, a scale key that jumps), the start and end of each
 * zoom, each recorded click, and the steps of each counter block.
 */
export function motionEvents(
  edit: EditState,
  pointers: RecordedPointer[] = [],
): MotionEvent[] {
  const out: MotionEvent[] = [];
  const placed = placeClips(edit.clips);
  const end = placed.length ? placed[placed.length - 1].end : 0;
  placed.forEach((p, i) => {
    if (p.clip.kind === "slide") {
      out.push({
        t: round(p.start),
        kind: "card",
        weight: p.clip.title.trim() ? 1 : 0.7,
        item: p.clip.id,
      });
    } else if (i > 0) {
      out.push({ t: round(p.start), kind: "scene", weight: 0.5, item: p.clip.id });
    }
    if (i > 0 && transitionLength(placed[i - 1].clip, p.clip) > 0) {
      out.push({
        t: round(p.start),
        kind: "transition",
        weight: 0.6,
        item: p.clip.id,
      });
    }
  });
  for (const o of edit.overlays) {
    if (edit.tracks.hidden.includes(o.lane)) continue;
    if (isCaptionOverlay(o)) continue;
    const start = round(o.start);
    if (isCounter(o)) {
      const span = counterSteps(o);
      const step = (span.to - span.from) / (COUNTER.steps - 1);
      for (let k = 0; k < COUNTER.steps; k += 1) {
        const t = o.start + span.from + k * step;
        if (t <= o.start + o.duration)
          out.push({ t: round(t), kind: "tick", weight: 0.3, item: o.id });
      }
    }
    const pops = popsOf(o).map((t) => round(o.start + t));
    const popEnter = o.enter === "pop" || o.enter === "spring";
    if (popEnter) {
      out.push({ t: start, kind: "pop", weight: ENTER_WEIGHT[o.kind], item: o.id });
    } else if (o.enter !== "none" || o.start > 0) {
      out.push({ t: start, kind: "enter", weight: ENTER_WEIGHT[o.kind], item: o.id });
    }
    if (isTitle(o)) out.push({ t: start, kind: "title", weight: 0.8, item: o.id });
    for (const t of pops)
      if (t !== start) out.push({ t, kind: "pop", weight: 0.6, item: o.id });
    const stop = round(o.start + o.duration);
    if (o.exit !== "none" && stop < end - 0.05)
      out.push({ t: stop, kind: "exit", weight: 0.5, item: o.id });
  }
  for (const z of edit.zooms) {
    for (const t of timelineTimesOf(edit.clips, z.start))
      out.push({ t: round(t), kind: "zoom-in", weight: 0.5, item: z.id });
    for (const t of timelineTimesOf(edit.clips, z.end))
      out.push({ t: round(t), kind: "zoom-out", weight: 0.4, item: z.id });
  }
  for (const p of pointers) {
    if (p.kind !== "down") continue;
    for (const t of timelineTimesOf(edit.clips, p.t))
      out.push({ t: round(t), kind: "click", weight: 0.6 });
  }
  return out
    .filter((e) => e.t >= 0 && e.t <= end + 0.001)
    .sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind));
}
