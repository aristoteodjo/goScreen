// Five sober sound effects, synthesised like the tap click of the export:
// no whoosh, nothing that would date the film. A film takes at most four.

import { z } from "zod";

export const SFX_KINDS = ["tap", "pop", "thud", "tick", "riser"] as const;
export type SfxKind = (typeof SFX_KINDS)[number];
export const sfxKindSchema = z.enum(SFX_KINDS);

/** More than this many effects in a film reads as noise. */
export const MAX_SFX = 4;

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
};

/** The effect's samples (mono, -1..1, peak at 0.8). */
export function renderSfx(kind: SfxKind, sampleRate = 48_000): Float32Array {
  const n = Math.round(SFX_LENGTHS[kind] * sampleRate);
  const out = new Float32Array(n);
  const rand = noise(0x2545_f491);
  let phase = 0;
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
      case "riser": {
        // Filtered noise that swells and climbs, cut at its top.
        const k = t / SFX_LENGTHS.riser;
        const hz = 180 + 900 * k * k;
        phase = (phase + hz / sampleRate) % 1;
        const swell = k * k;
        v = (Math.sin(TAU * phase) * 0.5 + rand() * 0.5 * k) * swell;
        break;
      }
    }
    out[i] = v;
  }
  // A one-pole low-pass tames the noise, then a fixed peak.
  let y = 0;
  const lp = 1 - Math.exp((-TAU * 6000) / sampleRate);
  for (let i = 0; i < n; i += 1) {
    y += (out[i] - y) * lp;
    out[i] = y;
  }
  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i += 1) out[i] *= 0.8 / peak;
  return out;
}
