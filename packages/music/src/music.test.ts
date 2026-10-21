import { describe, expect, it } from "vitest";
import {
  alignToPayoff,
  encodeWav,
  MAX_SFX,
  musicPlan,
  musicPlanSchema,
  pickStyle,
  RENDER_PEAK,
  renderMusic,
  renderSfx,
  SFX_KINDS,
  sectionAt,
  sectionsFor,
  triad,
} from "./index.ts";

describe("music plan", () => {
  it("is deterministic and covers the length in whole bars", () => {
    const a = musicPlan("pulse", 7, 30);
    const b = musicPlan("pulse", 7, 30);
    expect(a).toEqual(b);
    expect(musicPlanSchema.safeParse(a).success).toBe(true);
    expect(a.duration).toBeGreaterThanOrEqual(30);
    expect(a.duration - 30).toBeLessThan(a.bar);
    // Sections are contiguous from 0 to the end.
    let t = 0;
    for (const s of a.sections) {
      expect(s.start).toBeCloseTo(t, 3);
      expect(s.end).toBeGreaterThan(s.start);
      t = s.end;
    }
    expect(t).toBeCloseTo(a.duration, 3);
    expect(a.sections[0].kind).toBe("intro");
    expect(a.sections[a.sections.length - 1].kind).toBe("outro");
  });

  it("changes with the seed and keeps a long piece breathing", () => {
    const plans = [0, 1, 2, 3].map((seed) => musicPlan("warm", seed, 20));
    const roots = new Set(plans.map((p) => p.root));
    const chords = new Set(plans.map((p) => JSON.stringify(p.chords)));
    expect(roots.size + chords.size).toBeGreaterThan(2);
    const long = musicPlan("focus", 1, 90);
    expect(long.sections.some((s) => s.kind === "break")).toBe(true);
    const sections = sectionsFor(3, 2);
    expect(sections.map((s) => s.kind)).toEqual(["full", "outro"]);
  });

  it("spells triads and finds the section at a time", () => {
    expect(triad(60, "major", 0)).toEqual([60, 64, 67]);
    expect(triad(60, "minor", 0)).toEqual([60, 63, 67]);
    expect(triad(60, "major", 4)).toEqual([67, 71, 74]);
    const plan = musicPlan("calm", 3, 40);
    expect(sectionAt(plan, 0).kind).toBe("intro");
    expect(sectionAt(plan, 1000).kind).toBe("outro");
  });

  it("aligns the full section on the payoff", () => {
    const plan = musicPlan("rise", 2, 40);
    const full = plan.sections.find((s) => s.kind === "full");
    if (!full) throw new Error("no full section");
    expect(alignToPayoff(plan, 0)).toBeCloseTo(full.start, 3);
    expect(alignToPayoff(plan, 2)).toBeCloseTo(full.start - 2, 3);
    expect(alignToPayoff(plan, full.start + 10)).toBe(0);
  });

  it("picks a style from the tone, then the genre", () => {
    expect(pickStyle("Playful and cheerful")).toBe("bright");
    expect(pickStyle("bold", "explainer")).toBe("pulse");
    expect(pickStyle(undefined, "product-launch")).toBe("rise");
    expect(pickStyle("", "walkthrough")).toBe("focus");
    expect(pickStyle(null, null)).toBe("focus");
  });
});

describe("rendering", () => {
  it("writes the asked length, under 0 dBFS, the same every time", () => {
    const plan = musicPlan("pulse", 11, 12);
    const sr = 8000;
    const a = renderMusic(plan, 4, sr);
    const b = renderMusic(plan, 4, sr);
    expect(a.length).toBe(4 * sr);
    expect(Array.from(a)).toEqual(Array.from(b));
    let peak = 0;
    let energy = 0;
    for (const s of a) {
      peak = Math.max(peak, Math.abs(s));
      energy += s * s;
    }
    expect(peak).toBeLessThan(1);
    expect(peak).toBeCloseTo(RENDER_PEAK, 2);
    expect(energy / a.length).toBeGreaterThan(0.001);
    // An offset plays a later part of the plan.
    const later = renderMusic(plan, 1, sr, 6);
    expect(Array.from(later.slice(100, 200))).not.toEqual(
      Array.from(a.slice(100, 200)),
    );
  });

  it("renders every style and effect without clipping", () => {
    for (const style of ["calm", "warm", "rise", "focus", "bright"] as const) {
      const out = renderMusic(musicPlan(style, 1, 6), 2, 8000);
      expect(out.length).toBe(16_000);
      expect(Math.max(...Array.from(out).map(Math.abs))).toBeLessThan(1);
    }
    for (const kind of SFX_KINDS) {
      const out = renderSfx(kind, 8000);
      expect(out.length).toBeGreaterThan(50);
      const peak = Math.max(...Array.from(out).map(Math.abs));
      expect(peak).toBeLessThan(1);
      expect(peak).toBeGreaterThan(0.5);
    }
    expect(MAX_SFX).toBe(4);
  });

  it("encodes a WAV header", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1, 2]), 8000);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(wav.length).toBe(44 + 8);
    const v = new DataView(wav.buffer);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getInt16(46, true)).toBe(16384);
    expect(v.getInt16(50, true)).toBe(32767);
  });
});
