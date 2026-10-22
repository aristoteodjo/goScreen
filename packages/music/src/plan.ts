// A music plan is the whole piece written down before a sample is made:
// tempo, key, one chord a bar, and sections with their times. The same
// style and seed give the same plan, so a bed can be rendered again
// anywhere (and the editor can tell where the "full" section lands).

import { z } from "zod";
import { type MusicStyle, musicStyleSchema, STYLE_SPECS } from "./styles.ts";

export const SECTION_KINDS = [
  "intro",
  "build",
  "full",
  "break",
  "outro",
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const sectionSchema = z.object({
  kind: z.enum(SECTION_KINDS),
  // Plan seconds.
  start: z.number().min(0),
  end: z.number().min(0),
});

export const musicPlanSchema = z.object({
  style: musicStyleSchema,
  seed: z.number().int().min(0),
  tempo: z.number().min(40).max(200),
  // MIDI note of the key's root.
  root: z.number().int().min(24).max(84),
  mode: z.enum(["major", "minor"]),
  // MIDI notes of each bar's chord, cycled over the piece.
  chords: z.array(z.array(z.number().int())).min(1),
  // Seconds of one bar (four beats).
  bar: z.number().positive(),
  sections: z.array(sectionSchema).min(1),
  duration: z.number().positive(),
});
export type MusicPlan = z.infer<typeof musicPlanSchema>;
export type Section = z.infer<typeof sectionSchema>;

/** Mulberry32: a small deterministic generator, enough for musical choices. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** The triad on a scale degree, as MIDI notes above the root. */
export function triad(
  root: number,
  mode: "major" | "minor",
  degree: number,
): number[] {
  const scale = mode === "major" ? MAJOR : MINOR;
  const note = (d: number) =>
    root + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];
  return [note(degree), note(degree + 2), note(degree + 4)];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Sections by bars: intro (pad alone), build (bass joins), full (everything),
 * a break in the middle of a long piece (the bed breathes), full again, and
 * an outro of two bars. Short pieces keep the same shape with fewer bars.
 */
export function sectionsFor(bars: number, bar: number): Section[] {
  const at = (b: number) => round(b * bar);
  if (bars <= 4) {
    return [
      { kind: "full", start: 0, end: at(Math.max(1, bars - 1)) },
      { kind: "outro", start: at(Math.max(1, bars - 1)), end: at(bars) },
    ];
  }
  const intro = bars >= 12 ? 2 : 1;
  const build = bars >= 12 ? 2 : 1;
  const outro = 2;
  const body = bars - intro - build - outro;
  const out: Section[] = [
    { kind: "intro", start: 0, end: at(intro) },
    { kind: "build", start: at(intro), end: at(intro + build) },
  ];
  let b = intro + build;
  if (body >= 12) {
    const first = Math.floor(body / 2) - 1;
    out.push({ kind: "full", start: at(b), end: at(b + first) });
    b += first;
    out.push({ kind: "break", start: at(b), end: at(b + 2) });
    b += 2;
    out.push({ kind: "full", start: at(b), end: at(bars - outro) });
  } else {
    out.push({ kind: "full", start: at(b), end: at(bars - outro) });
  }
  out.push({ kind: "outro", start: at(bars - outro), end: at(bars) });
  return out;
}

/** A deterministic plan for `duration` seconds of a style (rounded up to whole bars). */
export function musicPlan(
  style: MusicStyle,
  seed: number,
  duration: number,
): MusicPlan {
  const spec = STYLE_SPECS[style];
  const rand = seeded(seed);
  const root = spec.roots[Math.floor(rand() * spec.roots.length)];
  const progression =
    spec.progressions[Math.floor(rand() * spec.progressions.length)];
  const bar = round((60 / spec.tempo) * 4);
  const bars = Math.max(2, Math.ceil(Math.max(1, duration) / bar));
  const chords = progression.map((degree) => triad(root, spec.mode, degree));
  return {
    style,
    seed,
    tempo: spec.tempo,
    root,
    mode: spec.mode,
    chords,
    bar,
    sections: sectionsFor(bars, bar),
    duration: round(bars * bar),
  };
}

/**
 * Plan seconds rendered beyond the film, so an offset towards the payoff
 * never runs out of music. The renderer and the editor (which rebuilds the
 * plan to read its beats) must agree on it.
 */
export const PLAN_SLACK = 24;

/** The section playing at plan time t. */
export function sectionAt(plan: MusicPlan, t: number): Section {
  return (
    plan.sections.find((s) => t >= s.start && t < s.end) ??
    plan.sections[plan.sections.length - 1]
  );
}

/**
 * The offset (plan seconds) to start the bed from so that its first "full"
 * section lands on the payoff (film seconds): the music opens up when the
 * product does. Never negative; a payoff later than the full section plays
 * the plan from its start.
 */
export function alignToPayoff(plan: MusicPlan, payoffTime: number): number {
  const full = plan.sections.find((s) => s.kind === "full");
  if (!full) return 0;
  return round(Math.max(0, full.start - Math.max(0, payoffTime)));
}
