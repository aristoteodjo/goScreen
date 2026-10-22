// Automatic sound design: every movement of a montage gets its sound, the
// way the reference SaaS ads do it (a whoosh on each entrance, a swish on
// each exit, a pop on an appearance, a click on a click, a tick on each
// step of a counter, a sparkle on a title's glow, an impact on a title
// card, a riser into the payoff). The events come from the editor
// (`motionEvents` in render-engine); this file only decides which sound,
// when, and how loud. Pure, so the same montage gives the same cues.

import {
  SFX_LEAD,
  type SfxKind,
  type SfxLevel,
  type SoundDensity,
} from "./sfx.ts";

/** The kinds of movement a montage shows (what render-engine's `motionEvents` lists). */
export const MOTION_KINDS = [
  "enter",
  "exit",
  "pop",
  "zoom-in",
  "zoom-out",
  "transition",
  "click",
  "tick",
  "title",
  "card",
  "scene",
] as const;
export type MotionKind = (typeof MOTION_KINDS)[number];

export type MotionEvent = {
  /** Timeline seconds. */
  t: number;
  kind: MotionKind;
  /** 0..1, how much the movement matters (a title card more than a tick). */
  weight: number;
  /** The clip, layer or zoom it comes from, for the answer. */
  item?: string;
};

export type SoundCue = {
  /** Timeline seconds where the sound file starts (its lead already taken). */
  t: number;
  kind: SfxKind;
  level: SfxLevel;
  /** 0..1 clip volume. */
  gain: number;
  /** The movement it underlines. */
  event: MotionKind;
  item?: string;
};

/** Which sound each movement gets, and the gain its importance earns. */
const FULL: Record<MotionKind, { kind: SfxKind; gain: number }> = {
  enter: { kind: "whoosh", gain: 0.55 },
  exit: { kind: "swish", gain: 0.4 },
  pop: { kind: "pop", gain: 0.6 },
  "zoom-in": { kind: "whoosh", gain: 0.45 },
  "zoom-out": { kind: "swish", gain: 0.35 },
  transition: { kind: "whoosh", gain: 0.6 },
  click: { kind: "click", gain: 0.7 },
  tick: { kind: "tick", gain: 0.35 },
  title: { kind: "sparkle", gain: 0.5 },
  card: { kind: "impact", gain: 0.9 },
  scene: { kind: "swish", gain: 0.45 },
};

/** The movements a sparse design still underlines: cards, clicks, the payoff. */
const SPARSE: Partial<Record<MotionKind, { kind: SfxKind; gain: number }>> = {
  card: { kind: "impact", gain: 0.8 },
  click: { kind: "click", gain: 0.5 },
};

/** Two identical sounds closer than this read as a stutter: the lighter one goes. */
export const SFX_MIN_GAP = 0.15;

/** The riser climbs for this long into the last card (the payoff), then the sub drops. */
const RISER_LENGTH = 1.2;

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Mulberry32, for the small gain jitter that keeps repeated whooshes alive. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The payoff: the last card of the montage when another card precedes it
 * (the closing card after the story), else the heaviest late title.
 */
function payoffOf(events: MotionEvent[]): MotionEvent | null {
  const cards = events.filter((e) => e.kind === "card");
  if (cards.length >= 2) return cards[cards.length - 1];
  return null;
}

/**
 * One sound per movement (`full`) or only cards, clicks and the payoff
 * (`sparse`); never two identical sounds within `SFX_MIN_GAP` (the lighter
 * one is dropped); gain by importance, with a small seeded jitter so a
 * row of entrances does not sound like a loop. Cues come back sorted.
 */
export function soundDesign(
  events: MotionEvent[],
  options: { density: SoundDensity; seed?: number },
): SoundCue[] {
  const rand = seeded(options.seed ?? 1);
  const table = options.density === "full" ? FULL : SPARSE;
  const payoff = payoffOf(events);
  const cues: SoundCue[] = [];
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const pick = table[e.kind];
    if (!pick) continue;
    const weight = Math.min(1, Math.max(0, e.weight));
    const isPayoff = payoff !== null && e === payoff;
    const kind: SfxKind = isPayoff ? "drop" : pick.kind;
    const level: SfxLevel = weight >= 0.75 || isPayoff ? "full" : "soft";
    const jitter = 1 + (rand() - 0.5) * 0.16;
    const gain = round(
      Math.min(1, pick.gain * (0.6 + 0.4 * weight) * jitter * (isPayoff ? 1.2 : 1)),
    );
    cues.push({
      t: round(Math.max(0, e.t - SFX_LEAD[kind])),
      kind,
      level,
      gain,
      event: e.kind,
      item: e.item,
    });
    if (isPayoff && e.t >= RISER_LENGTH * 0.5) {
      cues.push({
        t: round(Math.max(0, e.t - RISER_LENGTH)),
        kind: "riser",
        level: "full",
        gain: 0.7,
        event: e.kind,
        item: e.item,
      });
    }
  }
  return thin(cues);
}

/** Drops the lighter of two identical sounds closer than SFX_MIN_GAP. */
export function thin(cues: SoundCue[]): SoundCue[] {
  const sorted = [...cues].sort((a, b) => a.t - b.t || b.gain - a.gain);
  const kept: SoundCue[] = [];
  for (const c of sorted) {
    const i = kept.findIndex(
      (k) => k.kind === c.kind && Math.abs(k.t - c.t) < SFX_MIN_GAP,
    );
    if (i === -1) {
      kept.push(c);
    } else if (c.gain > kept[i].gain) {
      kept[i] = c;
    }
  }
  return kept.sort((a, b) => a.t - b.t);
}
