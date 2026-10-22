// Sound effects synthesised like the tap click of the export: one short
// sound per kind of movement, the same samples every time. The reference
// SaaS ads put a sound on every motion (a whoosh on an entrance, a swish
// on an exit, a pop on an appearance, a tick on each step of a counter...),
// so the set covers each of them, in two levels: `full` for the sound that
// carries a beat, `soft` for the one that only underlines it.

import { z } from "zod";

export const SFX_KINDS = [
  "tap",
  "pop",
  "thud",
  "tick",
  "riser",
  "whoosh",
  "swish",
  "click",
  "sparkle",
  "impact",
  "drop",
  "blip",
] as const;
export type SfxKind = (typeof SFX_KINDS)[number];
export const sfxKindSchema = z.enum(SFX_KINDS);

export const SFX_LEVELS = ["soft", "full"] as const;
export type SfxLevel = (typeof SFX_LEVELS)[number];
export const sfxLevelSchema = z.enum(SFX_LEVELS);

/** Peak of each level, linear (full -2 dBFS, soft about -8 dBFS). */
export const SFX_PEAK: Record<SfxLevel, number> = { soft: 0.4, full: 0.8 };

export const SOUND_DENSITIES = ["sparse", "full"] as const;
export type SoundDensity = (typeof SOUND_DENSITIES)[number];
export const soundDensitySchema = z.enum(SOUND_DENSITIES);

/**
 * How many effects a minute of film can carry before they read as noise,
 * by density: `sparse` underlines the cards, the clicks and the payoff of
 * a spoken piece; `full` is the reference ads' rate (a sound on every
 * movement: a 20 s spot carries 30 to 60 of them). A density, not a hard
 * limit: the commands warn past it, they never refuse.
 */
export const SFX_PER_MINUTE: Record<SoundDensity, number> = {
  sparse: 12,
  full: 180,
};

/** The number of effects `seconds` of film carry at this density before the commands warn. */
export function sfxBudget(seconds: number, density: SoundDensity): number {
  return Math.max(4, Math.ceil((Math.max(0, seconds) / 60) * SFX_PER_MINUTE[density]));
}

const TAU = Math.PI * 2;

/** Seeded white noise, the same breath every time. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return (s >>> 9) / (1 << 23) - 1;
  };
}

export const SFX_LENGTHS: Record<SfxKind, number> = {
  tap: 0.06,
  pop: 0.09,
  thud: 0.28,
  tick: 0.025,
  riser: 1.2,
  whoosh: 0.35,
  swish: 0.18,
  click: 0.05,
  sparkle: 0.6,
  impact: 0.4,
  drop: 0.5,
  blip: 0.08,
};

/**
 * Seconds before the movement each effect should start, so that its loudest
 * point lands on the movement: a whoosh swells before the entrance, a riser
 * climbs to the payoff. Zero for the percussive ones.
 */
export const SFX_LEAD: Record<SfxKind, number> = {
  tap: 0,
  pop: 0,
  thud: 0,
  tick: 0,
  riser: 1.2,
  whoosh: 0.14,
  swish: 0.05,
  click: 0,
  sparkle: 0,
  impact: 0,
  drop: 0,
  blip: 0,
};

/** Low-pass cutoff per kind: the airy ones keep their highs. */
const CUTOFF: Partial<Record<SfxKind, number>> = {
  sparkle: 14_000,
  swish: 10_000,
  whoosh: 8_000,
  blip: 9_000,
};

/** A bell-shaped envelope on 0..1 that peaks at `at`. */
function swell(k: number, at: number): number {
  if (k <= 0 || k >= 1) return 0;
  const x = k < at ? k / at : (1 - k) / (1 - at);
  return Math.sin((Math.PI / 2) * x) ** 2;
}

/**
 * A band-passed noise whose centre sweeps from `from` to `to` Hz over the
 * sound: the breath of a whoosh. Chamberlin state-variable filter, so the
 * sweep costs nothing and never blows up at these frequencies.
 */
function sweptNoise(
  n: number,
  sampleRate: number,
  rand: () => number,
  from: number,
  to: number,
  peakAt: number,
  q: number,
): Float32Array {
  const out = new Float32Array(n);
  let low = 0;
  let band = 0;
  for (let i = 0; i < n; i += 1) {
    const k = i / n;
    const hz = from + (to - from) * k * k;
    const f = Math.min(0.9, 2 * Math.sin((Math.PI * hz) / sampleRate));
    const x = rand();
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    out[i] = band * swell(k, peakAt);
  }
  return out;
}

/** The effect's samples (mono, -1..1, peak at the level's). */
export function renderSfx(
  kind: SfxKind,
  sampleRate = 48_000,
  level: SfxLevel = "full",
): Float32Array {
  const n = Math.round(SFX_LENGTHS[kind] * sampleRate);
  const rand = noise(0x2545_f491 ^ SFX_KINDS.indexOf(kind));
  let out: Float32Array;
  switch (kind) {
    case "whoosh":
      out = sweptNoise(n, sampleRate, rand, 300, 2600, 0.4, 0.5);
      break;
    case "swish":
      out = sweptNoise(n, sampleRate, rand, 1800, 5200, 0.28, 0.6);
      break;
    default:
      out = tonal(kind, n, sampleRate, rand);
  }
  // A one-pole low-pass tames the noise, then a fixed peak.
  let y = 0;
  const lp = 1 - Math.exp((-TAU * (CUTOFF[kind] ?? 6000)) / sampleRate);
  for (let i = 0; i < n; i += 1) {
    y += (out[i] - y) * lp;
    out[i] = y;
  }
  // A 2 ms fade at both ends: no click on the cut.
  const edge = Math.min(Math.floor(n / 4), Math.round(sampleRate * 0.002));
  for (let i = 0; i < edge; i += 1) {
    const g = i / edge;
    out[i] *= g;
    out[n - 1 - i] *= g;
  }
  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i += 1) out[i] *= SFX_PEAK[level] / peak;
  return out;
}

/** The sine-based effects, sample by sample. */
function tonal(
  kind: Exclude<SfxKind, "whoosh" | "swish">,
  n: number,
  sampleRate: number,
  rand: () => number,
): Float32Array {
  const out = new Float32Array(n);
  let phase = 0;
  // Sparkle: a cluster of high partials, each a little later than the last.
  const partials = Array.from({ length: 6 }, (_, i) => ({
    hz: 2800 + ((i * 2654435761) % 5200),
    at: i * 0.045,
    phase: 0,
  }));
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    let v = 0;
    switch (kind) {
      case "tap":
        v =
          Math.sin(TAU * 2200 * t) * Math.exp(-t * 90) +
          rand() * Math.exp(-t * 160) * 0.35;
        break;
      case "pop": {
        const hz = 300 + 400 * Math.exp(-t * 60);
        phase = (phase + hz / sampleRate) % 1;
        v = Math.sin(TAU * phase) * Math.exp(-t * 40);
        break;
      }
      case "thud": {
        const hz = 55 + 60 * Math.exp(-t * 30);
        phase = (phase + hz / sampleRate) % 1;
        v =
          Math.sin(TAU * phase) * Math.exp(-t * 11) +
          rand() * Math.exp(-t * 220) * 0.25;
        break;
      }
      case "tick":
        v = Math.sin(TAU * 4200 * t) * Math.exp(-t * 260);
        break;
      case "click":
        // A mouse click: a short burst of noise with a woody body.
        v =
          rand() * Math.exp(-t * 400) * 0.6 +
          Math.sin(TAU * 1400 * t) * Math.exp(-t * 180) * 0.7;
        break;
      case "riser": {
        // Filtered noise that swells and climbs, cut at its top.
        const k = t / SFX_LENGTHS.riser;
        const hz = 180 + 900 * k * k;
        phase = (phase + hz / sampleRate) % 1;
        const swellK = k * k;
        v = (Math.sin(TAU * phase) * 0.5 + rand() * 0.5 * k) * swellK;
        break;
      }
      case "sparkle": {
        // Decaying high sines, one after another: a glint on a glow.
        for (const p of partials) {
          const dt = t - p.at;
          if (dt < 0) continue;
          p.phase = (p.phase + p.hz / sampleRate) % 1;
          v += Math.sin(TAU * p.phase) * Math.exp(-dt * 22) * 0.3;
        }
        break;
      }
      case "impact": {
        // A low body that drops, under a short burst of noise: a title lands.
        const hz = 42 + 70 * Math.exp(-t * 28);
        phase = (phase + hz / sampleRate) % 1;
        v =
          Math.sin(TAU * phase) * Math.exp(-t * 8) +
          rand() * Math.exp(-t * 70) * 0.5;
        break;
      }
      case "drop": {
        // A sub that falls from 90 to 35 Hz: the payoff.
        const hz = 35 + 55 * Math.exp(-t * 6);
        phase = (phase + hz / sampleRate) % 1;
        v = Math.sin(TAU * phase) * Math.exp(-t * 5);
        break;
      }
      case "blip": {
        // Two quick notes a fifth apart: an interface answered.
        const hz = t < 0.04 ? 880 : 1320;
        phase = (phase + hz / sampleRate) % 1;
        const dt = t < 0.04 ? t : t - 0.04;
        v = Math.sin(TAU * phase) * Math.exp(-dt * 60);
        break;
      }
    }
    out[i] = v;
  }
  return out;
}
