import { describe, expect, it } from "vitest";
import {
  chunkPlan,
  DEFAULT_EDIT,
  type EditState,
  fnv64,
  type RecordingClip,
  type SlideClip,
  stableJson,
  type TextOverlay,
} from "./index";

const settings = {
  fps: 30,
  longSide: 1920,
  source: { width: 1280, height: 720 },
};

const slide = (id: string, duration: number): SlideClip => ({
  id,
  kind: "slide",
  duration,
  transition: null,
  background: DEFAULT_EDIT.background,
  title: id,
  subtitle: "",
  color: "#ffffff",
  font: "Inter",
  animation: "fade",
});

const text = (
  id: string,
  start: number,
  duration: number,
  label = "Hi",
): TextOverlay => ({
  id,
  kind: "text",
  lane: 0,
  start,
  duration,
  x: 0.5,
  y: 0.5,
  width: 0.4,
  height: 0.1,
  rotation: 0,
  opacity: 1,
  enter: "none",
  exit: "none",
  motion: 0.3,
  text: label,
  style: {
    font: "Inter",
    size: 0.06,
    weight: 700,
    color: "#ffffff",
    align: "center",
    background: null,
  },
});

// 40 s of recording: 8 chunks of 5 s.
const take: RecordingClip = {
  ...(DEFAULT_EDIT.clips[0] as RecordingClip),
  in: 0,
  out: 40,
};
const base: EditState = { ...DEFAULT_EDIT, clips: [take] };

describe("stableJson / fnv64", () => {
  it("ignores key order and is deterministic", () => {
    expect(stableJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      stableJson({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
    expect(fnv64("hello")).toBe(fnv64("hello"));
    expect(fnv64("hello")).not.toBe(fnv64("hellp"));
    expect(fnv64("")).toHaveLength(16);
  });
});

describe("chunkPlan", () => {
  it("cuts the sequence into chunks that cover every output frame", () => {
    const plan = chunkPlan(base, settings);
    expect(plan).toHaveLength(8);
    expect(plan[0]).toMatchObject({ index: 0, from: 0, to: 5, frame: 0, frames: 150 });
    expect(plan[7]).toMatchObject({ from: 35, to: 40, frame: 1050, frames: 150 });
    expect(plan.reduce((s, c) => s + c.frames, 0)).toBe(1200);
    const odd = chunkPlan({ ...base, clips: [slide("a", 7.4)] }, settings);
    expect(odd.map((c) => c.frames)).toEqual([150, 72]);
  });

  it("only changes the hashes of the chunks that see a new text", () => {
    const before = chunkPlan(base, settings);
    const after = chunkPlan({ ...base, overlays: [text("t", 30, 2)] }, settings);
    const changed = before
      .map((c, i) => (c.hash === after[i].hash ? null : c.index))
      .filter((i) => i !== null);
    // 30..32 s sits in chunk 6 (30..35); the margin reaches chunk 5 (25..30).
    expect(changed).toEqual([5, 6]);
  });

  it("re-renders a chunk when its text changes; a hidden lane does not count", () => {
    const plain = chunkPlan(base, settings);
    const one = chunkPlan({ ...base, overlays: [text("t", 10, 2, "One")] }, settings);
    const two = chunkPlan({ ...base, overlays: [text("t", 10, 2, "Two")] }, settings);
    expect(one[2].hash).not.toBe(two[2].hash);
    expect(one[0].hash).toBe(two[0].hash);
    const hidden = chunkPlan(
      {
        ...base,
        overlays: [text("t", 10, 2, "Two")],
        tracks: { ...base.tracks, hidden: [0] },
      },
      settings,
    );
    expect(hidden[2].hash).toBe(plain[2].hash);
  });

  it("shifts every later chunk when an earlier clip changes length", () => {
    const before = chunkPlan({ ...base, clips: [slide("card", 3), take] }, settings);
    const after = chunkPlan({ ...base, clips: [slide("card", 4), take] }, settings);
    expect(before[0].hash).not.toBe(after[0].hash);
    expect(before[3].hash).not.toBe(after[3].hash);
  });

  it("keeps chunks that a zoom does not touch; global settings touch all", () => {
    const plain = chunkPlan(base, settings);
    const zoomed = chunkPlan(
      { ...base, zooms: [{ id: "z", start: 20, end: 22, scale: 1.8, focus: null }] },
      settings,
    );
    expect(zoomed[4].hash).not.toBe(plain[4].hash);
    expect(zoomed[0].hash).toBe(plain[0].hash);
    const red = chunkPlan(
      { ...base, background: { kind: "none" } },
      settings,
    );
    expect(red.every((c, i) => c.hash !== plain[i].hash)).toBe(true);
    const faster = chunkPlan(base, { ...settings, fps: 60 });
    expect(faster[0].hash).not.toBe(plain[0].hash);
    expect(faster[0].frames).toBe(300);
  });
});
