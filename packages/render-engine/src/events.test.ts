import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDIT,
  type EditState,
  fullClip,
  motionEvents,
  type Overlay,
  type RecordedPointer,
  type SlideClip,
  snapToBeats,
} from "./index";

const slide = (id: string, duration: number, title = "Hello"): SlideClip => ({
  id,
  kind: "slide",
  duration,
  transition: null,
  background: DEFAULT_EDIT.background,
  title,
  subtitle: "",
  color: "#ffffff",
  font: "Inter",
  animation: "words",
});

const text = (id: string, start: number, duration: number): Overlay => ({
  id,
  kind: "text",
  lane: 0,
  start,
  duration,
  x: 0.5,
  y: 0.5,
  width: 0.5,
  height: 0.2,
  rotation: 0,
  opacity: 1,
  enter: "fade",
  exit: "fade",
  motion: 0.4,
  text: "Hi",
  style: {
    font: "Inter",
    size: 0.05,
    weight: 700,
    color: "#ffffff",
    align: "center",
    background: null,
  },
  animator: null,
});

// Intro card 2 s, a 4 s scene (source 10..14) with a 0.5 s fade, outro 2 s.
const base: EditState = {
  ...DEFAULT_EDIT,
  clips: [
    slide("intro", 2),
    { ...fullClip("scene-1", 10, 14), transition: { kind: "fade", duration: 0.5 } },
    slide("outro", 2),
  ],
  overlays: [
    { ...text("caption-1", 2.3, 2), style: { ...text("x", 0, 1).style, glow: 0.1 } },
    { ...text("t2", 4, 1), enter: "pop", keyframes: { scale: [
      { t: 0, value: 1, ease: "out" },
      { t: 0.2, value: 1.3, ease: "out" },
      { t: 0.7, value: 1, ease: "out" },
    ] } },
    {
      id: "counter",
      kind: "video",
      lane: 1,
      start: 5,
      duration: 3,
      x: 0.5, y: 0.5, width: 0.5, height: 0.3, rotation: 0, opacity: 1,
      enter: "fade", exit: "none", motion: 0.4,
      asset: "blk", in: 0, volume: 1, radius: 0,
      source: { block: "stat-counter", props: {} },
    },
  ],
  zooms: [{ id: "z1", start: 11, end: 12.5, scale: 1.5, focus: null }],
};

const pointers: RecordedPointer[] = [
  { t: 11, kind: "down", x: 0.5, y: 0.5, instanceId: "d", source: "web" },
  { t: 11.2, kind: "move", x: 0.5, y: 0.5, instanceId: "d", source: "web" },
  { t: 20, kind: "down", x: 0.5, y: 0.5, instanceId: "d", source: "web" },
];

describe("motion events", () => {
  it("lists cards, scenes, transitions, layers, pops, zooms, clicks and ticks on the timeline", () => {
    const ev = motionEvents(base, pointers);
    const at = (kind: string) => ev.filter((e) => e.kind === kind).map((e) => e.t);
    expect(at("card")).toEqual([0, 6]);
    expect(at("scene")).toEqual([2]);
    expect(at("transition")).toEqual([2]);
    expect(at("enter")).toEqual([2.3, 5]);
    expect(at("title")).toEqual([2.3]);
    // A pop entrance, then the scale key that jumps.
    expect(at("pop")).toEqual([4, 4.2]);
    expect(at("exit")).toEqual([4.3, 5]);
    expect(at("zoom-in")).toEqual([3]);
    expect(at("zoom-out")).toEqual([4.5]);
    // The click at source 11 shows at timeline 3; the one at 20 is cut.
    expect(at("click")).toEqual([3]);
    expect(at("tick")).toHaveLength(8);
    expect(at("tick")[0]).toBeCloseTo(5.2, 3);
    expect(at("tick")[7]).toBeCloseTo(6.8, 3);
    for (let i = 1; i < ev.length; i += 1)
      expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t);
    expect(motionEvents(base, pointers)).toEqual(ev);
  });

  it("skips hidden lanes and word-timed captions", () => {
    const hidden = { ...base, tracks: { ...base.tracks, hidden: [0] } };
    expect(motionEvents(hidden).some((e) => e.item === "t2")).toBe(false);
    const words = {
      ...base,
      overlays: [{ ...text("caption-word-1", 2.5, 1), words: [{ text: "a", start: 0, end: 0.5 }] }],
    };
    expect(motionEvents(words).some((e) => e.kind === "enter")).toBe(false);
  });
});

describe("snap to beats", () => {
  // 120 BPM: a beat every 0.5 s, a downbeat every 2 s.
  const grid = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.5, strong: i % 4 === 0 }));

  it("moves cards' ends, layers and zooms onto the nearest beat, never a take clip", () => {
    const edit: EditState = {
      ...base,
      clips: [slide("intro", 2.1), base.clips[1], slide("outro", 2)],
      overlays: [text("a", 2.4, 1), text("b", 3.9, 1), text("c", 4.3, 1)],
      zooms: [{ id: "z1", start: 10.6, end: 12, scale: 1.5, focus: null }],
    };
    const { edit: next, moves } = snapToBeats(edit, grid, { tolerance: 0.15 });
    expect(next.clips[0]).toMatchObject({ id: "intro", duration: 2 });
    expect(next.clips[1]).toEqual(edit.clips[1]);
    expect(next.overlays.map((o) => o.start)).toEqual([2.5, 4, 4.3]);
    // Source 10.6 showed at 2.7 before the card shrank; at 2.6 after, so it
    // moves to 2.5: source 10.5. Layer c at 4.3 is too far from a beat.
    expect(next.zooms[0]).toMatchObject({ start: 10.5, end: 11.9 });
    expect(moves.map((m) => `${m.what}:${m.item}:${m.from}>${m.to}`)).toEqual([
      "card:intro:2.1>2",
      "layer:a:2.4>2.5",
      "layer:b:3.9>4",
      "zoom:z1:2.6>2.5",
    ]);
  });

  it("leaves word captions, synced layers and an already snapped edit alone", () => {
    const edit: EditState = {
      ...base,
      overlays: [
        { ...text("caption-word-1", 2.4, 1), words: [{ text: "a", start: 0, end: 0.5 }] },
        { ...text("s", 2.4, 1), syncWord: { word: "a", nth: 0 } },
      ],
      zooms: [],
    };
    const r = snapToBeats(edit, grid);
    expect(r.moves).toEqual([]);
    expect(r.edit).toBe(edit);
    expect(snapToBeats(edit, []).moves).toEqual([]);
  });
});
