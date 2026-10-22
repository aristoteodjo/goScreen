import { describe, expect, it } from "vitest";
import {
  beatGrid,
  musicPlan,
  nearestBeat,
  renderSfx,
  SFX_KINDS,
  SFX_LENGTHS,
  SFX_LEVELS,
  SFX_MIN_GAP,
  SFX_PEAK,
  sfxBudget,
  soundDesign,
  thin,
  type MotionEvent,
} from "./index.ts";

const peakOf = (a: Float32Array) => {
  let p = 0;
  for (const s of a) p = Math.max(p, Math.abs(s));
  return p;
};

describe("sound effects", () => {
  it("render every kind at every level: length, peak, deterministic, distinct", () => {
    const sr = 16_000;
    const seen = new Set<string>();
    for (const kind of SFX_KINDS) {
      for (const level of SFX_LEVELS) {
        const a = renderSfx(kind, sr, level);
        const b = renderSfx(kind, sr, level);
        expect(a.length).toBe(Math.round(SFX_LENGTHS[kind] * sr));
        expect(peakOf(a)).toBeCloseTo(SFX_PEAK[level], 3);
        expect(Array.from(a)).toEqual(Array.from(b));
        // No click at the cut: the ends are faded.
        expect(Math.abs(a[0])).toBeLessThan(0.05);
        expect(Math.abs(a[a.length - 1])).toBeLessThan(0.05);
      }
      // Each kind is its own sound (compared at the same peak).
      const a = renderSfx(kind, sr, "full");
      const key = Array.from(a.slice(40, 120))
        .map((v) => v.toFixed(2))
        .join(",");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(SFX_LENGTHS.whoosh).toBe(0.35);
    expect(SFX_LENGTHS.swish).toBe(0.18);
    expect(SFX_LENGTHS.riser).toBe(1.2);
  });

  it("a whoosh swells then fades, a riser climbs to its end", () => {
    const sr = 16_000;
    const w = renderSfx("whoosh", sr);
    const third = Math.floor(w.length / 3);
    const rms = (a: Float32Array) =>
      Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(rms(w.slice(third, 2 * third))).toBeGreaterThan(
      rms(w.slice(2 * third + third / 2)),
    );
    const r = renderSfx("riser", sr);
    expect(rms(r.slice(r.length - 2000, r.length - 100))).toBeGreaterThan(
      rms(r.slice(0, 2000)) * 3,
    );
  });

  it("budgets effects as a density, never a hard cap", () => {
    expect(sfxBudget(20, "sparse")).toBe(4);
    expect(sfxBudget(60, "sparse")).toBe(12);
    expect(sfxBudget(20, "full")).toBe(60);
  });
});

const events: MotionEvent[] = [
  { t: 0, kind: "card", weight: 1, item: "intro" },
  { t: 3, kind: "scene", weight: 0.5, item: "scene-1" },
  { t: 3.2, kind: "enter", weight: 0.8, item: "caption-1" },
  { t: 3.2, kind: "title", weight: 0.8, item: "caption-1" },
  { t: 4, kind: "click", weight: 0.6 },
  { t: 4.05, kind: "click", weight: 0.4 },
  { t: 5, kind: "zoom-in", weight: 0.5, item: "z1" },
  { t: 6, kind: "tick", weight: 0.3, item: "counter" },
  { t: 6.2, kind: "tick", weight: 0.3, item: "counter" },
  { t: 7, kind: "exit", weight: 0.5, item: "caption-1" },
  { t: 8, kind: "card", weight: 1, item: "outro" },
];

describe("sound design", () => {
  it("full: one sound per movement, a riser and a drop on the payoff", () => {
    const cues = soundDesign(events, { density: "full", seed: 1 });
    const kinds = cues.map((c) => c.kind);
    expect(kinds).toContain("impact");
    expect(kinds).toContain("whoosh");
    expect(kinds).toContain("sparkle");
    expect(kinds).toContain("swish");
    expect(kinds).toContain("tick");
    expect(kinds).toContain("riser");
    expect(kinds).toContain("drop");
    // The whoosh starts before the entrance so its swell lands on it.
    const whoosh = cues.find((c) => c.event === "enter");
    expect(whoosh?.t).toBeCloseTo(3.2 - 0.14, 3);
    const riser = cues.find((c) => c.kind === "riser");
    expect(riser?.t).toBeCloseTo(8 - 1.2, 3);
    // Sorted, deterministic.
    for (let i = 1; i < cues.length; i += 1)
      expect(cues[i].t).toBeGreaterThanOrEqual(cues[i - 1].t);
    expect(soundDesign(events, { density: "full", seed: 1 })).toEqual(cues);
    expect(soundDesign(events, { density: "full", seed: 2 })).not.toEqual(cues);
  });

  it("never lays two identical sounds within the gap, keeps the heavier", () => {
    const cues = soundDesign(events, { density: "full", seed: 1 });
    const clicks = cues.filter((c) => c.kind === "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0].t).toBe(4);
    const ticks = cues.filter((c) => c.kind === "tick");
    expect(ticks).toHaveLength(2);
    const thinned = thin([
      { t: 1, kind: "pop", level: "soft", gain: 0.3, event: "pop" },
      { t: 1.1, kind: "pop", level: "full", gain: 0.9, event: "pop" },
      { t: 1.3, kind: "pop", level: "soft", gain: 0.2, event: "pop" },
    ]);
    expect(thinned).toHaveLength(2);
    expect(thinned[0].gain).toBe(0.9);
    expect(SFX_MIN_GAP).toBe(0.15);
  });

  it("sparse: only cards, clicks and the payoff; gain by importance", () => {
    const cues = soundDesign(events, { density: "sparse", seed: 1 });
    const kinds = new Set(cues.map((c) => c.event));
    expect([...kinds].sort()).toEqual(["card", "click"]);
    expect(cues.some((c) => c.kind === "riser")).toBe(true);
    const card = cues.find((c) => c.kind === "impact");
    const click = cues.find((c) => c.kind === "click");
    expect(card && click && card.gain > click.gain).toBe(true);
    expect(click?.level).toBe("soft");
  });
});

describe("beat grid", () => {
  it("lists the beats heard on the timeline and marks the downbeats", () => {
    const plan = musicPlan("pulse", 1, 30);
    const beat = 60 / plan.tempo;
    const grid = beatGrid(plan, { start: 2, duration: 10, offset: beat * 3 });
    expect(grid[0]).toEqual({ t: 2, strong: false, index: 3 });
    expect(grid[1].t).toBeCloseTo(2 + beat, 3);
    expect(grid[1].strong).toBe(true);
    expect(grid[grid.length - 1].t).toBeLessThanOrEqual(12.001);
    expect(grid.length).toBe(Math.floor(10 / beat) + 1);
    // An offset between beats: the first beat comes after the start.
    const late = beatGrid(plan, { start: 0, duration: 4, offset: beat * 0.5 });
    expect(late[0].t).toBeCloseTo(beat * 0.5, 3);
  });

  it("finds the nearest beat within the tolerance, strong first on a tie", () => {
    const grid = [
      { t: 0, strong: true, index: 0 },
      { t: 0.5, strong: false, index: 1 },
      { t: 1, strong: false, index: 2 },
    ];
    expect(nearestBeat(grid, 0.6, 0.25)?.t).toBe(0.5);
    expect(nearestBeat(grid, 0.6, 0.05)).toBeNull();
    expect(nearestBeat(grid, 0.25, 0.3)?.t).toBe(0);
  });
});
