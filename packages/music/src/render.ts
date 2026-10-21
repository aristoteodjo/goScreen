// The bed itself: a handful of sine-based voices (a pad that breathes with
// the bars, a plucked bass, an arpeggio, a soft kick), a one-pole low-pass,
// a dotted-eighth delay and a sidechain that lets the beat push the pad
// down. Everything is a function of the plan and the sample index, so the
// same plan gives the same samples on every machine.

import { type MusicPlan, type SectionKind, sectionAt } from "./plan.ts";
import { STYLE_SPECS } from "./styles.ts";

export const SAMPLE_RATE = 48_000;
const TAU = Math.PI * 2;

const midiHz = (n: number) => 440 * 2 ** ((n - 69) / 12);

type Mix = { pad: number; bass: number; arp: number; kick: number };

/** How much of each voice a section lets through. */
export const SECTION_MIX: Record<SectionKind, Mix> = {
  intro: { pad: 0.7, bass: 0, arp: 0, kick: 0 },
  build: { pad: 0.85, bass: 0.6, arp: 0.5, kick: 0 },
  full: { pad: 1, bass: 1, arp: 1, kick: 1 },
  break: { pad: 0.8, bass: 0, arp: 0.7, kick: 0 },
  outro: { pad: 0.6, bass: 0.4, arp: 0, kick: 0 },
};

/** Peak of the rendered bed, in linear gain (-3 dBFS): never clips, leaves headroom. */
export const RENDER_PEAK = 0.7;

/**
 * Renders `duration` seconds of the plan from plan time `offset`, mono,
 * as floating samples in -1..1. The pad and the arpeggio go through the
 * filter and the delay; bass and kick stay dry.
 */
export function renderMusic(
  plan: MusicPlan,
  duration: number,
  sampleRate = SAMPLE_RATE,
  offset = 0,
): Float32Array {
  const spec = STYLE_SPECS[plan.style];
  const sr = sampleRate;
  const n = Math.max(1, Math.round(duration * sr));
  const out = new Float32Array(n);
  const beat = 60 / plan.tempo;
  const bar = plan.bar;
  const arpStep = spec.arp > 0 ? beat / spec.arp : 0;
  const bassStep = spec.tempo < 80 ? beat * 2 : beat;

  // Oscillator phases (cycles), kept continuous across chord changes.
  const padPhase = [0, 0, 0];
  let bassPhase = 0;
  let arpPhase = 0;
  let kickPhase = 0;

  // Section mix, smoothed so a section change never steps.
  const mix: Mix = { ...SECTION_MIX[sectionAt(plan, offset).kind] };
  const smooth = 1 - Math.exp(-1 / (0.6 * sr));

  // One-pole low-pass and the dotted-eighth delay.
  const cutoff = 400 + spec.brightness * 8000;
  const lp = 1 - Math.exp((-TAU * cutoff) / sr);
  let filtered = 0;
  const delayLen = Math.max(1, Math.round(0.75 * beat * sr));
  const delay = new Float32Array(delayLen);
  let delayAt = 0;

  for (let i = 0; i < n; i += 1) {
    const t = offset + i / sr;
    const target = SECTION_MIX[sectionAt(plan, t).kind];
    mix.pad += (target.pad - mix.pad) * smooth;
    mix.bass += (target.bass - mix.bass) * smooth;
    mix.arp += (target.arp - mix.arp) * smooth;
    mix.kick += (target.kick - mix.kick) * smooth;

    const barIndex = Math.floor(t / bar);
    const chord = plan.chords[barIndex % plan.chords.length];
    const inBar = t - barIndex * bar;
    const inBeat = t - Math.floor(t / beat) * beat;

    // Pad: three harmonics a note, a slow vibrato, breathing with the bar.
    const vibrato = 1 + 0.002 * Math.sin(TAU * 4.5 * t);
    let pad = 0;
    for (let k = 0; k < 3; k += 1) {
      padPhase[k] = (padPhase[k] + (midiHz(chord[k]) * vibrato) / sr) % 1;
      const p = padPhase[k] * TAU;
      pad += Math.sin(p) + 0.3 * Math.sin(2 * p) + 0.08 * Math.sin(3 * p);
    }
    const breath = 0.25 + 0.75 * Math.min(1, inBar / 0.4, (bar - inBar) / 0.4);
    pad *= breath / 3;

    // Bass: a pluck on every beat (every other beat when slow).
    const bassNote = chord[0] - 12;
    bassPhase = (bassPhase + midiHz(bassNote) / sr) % 1;
    const sinceBass = t - Math.floor(t / bassStep) * bassStep;
    const bass =
      (Math.sin(TAU * bassPhase) + 0.2 * Math.sin(2 * TAU * bassPhase)) *
      Math.exp(-sinceBass * 2.5) *
      Math.min(1, sinceBass / 0.01);

    // Arpeggio: chord notes an octave up, cycling up then down.
    let arp = 0;
    if (arpStep > 0) {
      const step = Math.floor(t / arpStep);
      const cycle = [0, 1, 2, 1];
      const note = chord[cycle[step % cycle.length]] + 12;
      arpPhase = (arpPhase + midiHz(note) / sr) % 1;
      const sinceArp = t - step * arpStep;
      arp =
        (Math.sin(TAU * arpPhase) + 0.25 * Math.sin(3 * TAU * arpPhase)) *
        Math.exp(-sinceArp * 9) *
        Math.min(1, sinceArp / 0.004);
    }

    // Kick: a short sine sweep, and the sidechain it drives.
    let kick = 0;
    if (spec.kick) {
      const hz = 48 + 100 * Math.exp(-inBeat * 35);
      kickPhase = (kickPhase + hz / sr) % 1;
      kick = Math.sin(TAU * kickPhase) * Math.exp(-inBeat * 14);
    }
    const push = Math.max(mix.kick, 0.5 * mix.bass);
    const sidechain = 1 - spec.drive * push * Math.exp(-inBeat * 9);

    const wetIn = (pad * 0.3 * mix.pad + arp * 0.16 * mix.arp) * sidechain;
    filtered += (wetIn - filtered) * lp;
    const echo = delay[delayAt];
    delay[delayAt] = filtered + echo * 0.35;
    delayAt = (delayAt + 1) % delayLen;
    const wet = filtered + echo * 0.22;

    out[i] = wet + bass * 0.3 * mix.bass + kick * 0.45 * mix.kick;
  }

  // Anti-click edges and a fixed peak.
  const edge = Math.min(n, Math.round(0.01 * sr));
  for (let i = 0; i < edge; i += 1) {
    const g = i / edge;
    out[i] *= g;
    out[n - 1 - i] *= g;
  }
  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const g = RENDER_PEAK / peak;
    for (let i = 0; i < n; i += 1) out[i] *= g;
  }
  return out;
}
