import { describe, expect, it } from "vitest";
import { composeFrame, timelineOf } from "./compose";
import { changeTimes, energize, popBox, popOutOverlay } from "./dynamic";
import { DEFAULT_EDIT, fullClip, parseEditState } from "./schema";
import type { EditState, SlideClip, TextOverlay } from "./types";

const slide = (id: string, duration: number): SlideClip => ({
  id,
  kind: "slide",
  duration,
  background: { kind: "color", value: "#000000" },
  title: "",
  subtitle: "",
  color: "#ffffff",
  font: "Inter",
  animation: "none",
  transition: null,
});

const text = (id: string, start: number, duration: number): TextOverlay => ({
  id,
  kind: "text",
  lane: 0,
  start,
  duration,
  x: 0.5,
  y: 0.2,
  width: 0.8,
  height: 0.1,
  rotation: 0,
  opacity: 1,
  enter: "fade",
  exit: "fade",
  motion: 0.3,
  text: "Hello",
  style: {
    font: "Inter",
    size: 0.05,
    weight: 700,
    color: "#ffffff",
    align: "center",
    background: null,
  },
});

const output = { width: 1920, height: 1080 };
const source = { width: 1920, height: 1080 };

describe("popBox", () => {
  const edit: EditState = { ...DEFAULT_EDIT, background: { kind: "none" } };
  const timeline = timelineOf(source, []);

  it("maps a glass rectangle onto the output, as fractions", () => {
    const frame = composeFrame(edit, timeline, output, 1);
    const box = popBox(frame, null, { u: 0.25, v: 0.5, w: 0.5, h: 0.25 });
    expect(box).not.toBeNull();
    expect(box?.x).toBeCloseTo(0.25);
    expect(box?.y).toBeCloseTo(0.5);
    expect(box?.width).toBeCloseTo(0.5);
    expect(box?.height).toBeCloseTo(0.25);
  });

  it("goes through the zoom camera", () => {
    const zoomed: EditState = {
      ...edit,
      zooms: [{ id: "z", start: 0, end: 10, scale: 2, focus: { x: 0.5, y: 0.5 } }],
    };
    const frame = composeFrame(zoomed, timeline, output, 5);
    const box = popBox(frame, null, { u: 0.25, v: 0.25, w: 0.5, h: 0.5 });
    // Half the frame around the centre, seen twice as big (plus the zoom's
    // slow push): about the whole frame.
    expect(box?.x).toBeCloseTo(0, 1);
    expect(box?.width).toBeCloseTo(1, 1);
  });

  it("knows no layer of that id", () => {
    const frame = composeFrame(edit, timeline, output, 1);
    expect(popBox(frame, "ghost", { u: 0, v: 0, w: 1, h: 1 })).toBeNull();
  });
});

describe("popOutOverlay", () => {
  const o = popOutOverlay({
    id: "pop-1",
    asset: "a1",
    lane: 2,
    start: 3,
    duration: 2.4,
    box: { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
    glow: "#4cc2ff",
  });

  it("sits exactly on its box and rises from there", () => {
    expect(o.x).toBeCloseTo(0.4);
    expect(o.y).toBeCloseTo(0.4);
    expect(o.width).toBeCloseTo(0.4);
    expect(o.keyframes?.scale?.[0]).toMatchObject({ t: 0, value: 1 });
    expect(o.keyframes?.scale?.[1].value).toBeCloseTo(1.08);
    expect(o.keyframes?.x?.[0].value).toBeCloseTo(0.4);
    expect(o.shadow).toBeGreaterThan(0);
    expect(o.glow).toBe("#4cc2ff");
    expect(o.enter).toBe("none");
  });

  it("is a valid overlay the schema keeps whole", () => {
    const parsed = parseEditState({
      ...DEFAULT_EDIT,
      assets: [{ id: "a1", name: "pop", kind: "image", file: "pop.png", duration: null }],
      overlays: [o],
    });
    const back = parsed?.overlays[0];
    expect(back).toMatchObject({ kind: "image", shadow: o.shadow, glow: "#4cc2ff" });
    expect(back && "keyframes" in back && back.keyframes?.scale).toHaveLength(3);
  });
});

describe("changeTimes", () => {
  it("lists clip starts, overlay bounds, zooms in timeline time and keys", () => {
    const edit: EditState = {
      ...DEFAULT_EDIT,
      clips: [slide("s", 2), fullClip("c", 10, 20)],
      overlays: [{ ...text("t", 3, 2), keyframes: { scale: [{ t: 0.5, value: 1, ease: "out" }] } }],
      zooms: [{ id: "z", start: 14, end: 16, scale: 1.5, focus: null }],
    };
    expect(changeTimes(edit)).toEqual([0, 2, 3, 3.5, 5, 6, 8]);
  });
});

describe("energize", () => {
  it("fills every still stretch with one movement and never stacks two", () => {
    const edit: EditState = {
      ...DEFAULT_EDIT,
      clips: [slide("intro", 5), fullClip("c1", 0, 10), fullClip("c2", 10, 16)],
      overlays: [text("t", 6, 8)],
    };
    const { edit: next, changes } = energize(edit, { every: 2 });
    expect(next.drift).toBeDefined();
    const kinds = changes.map((c) => c.kind);
    expect(kinds).toContain("drift");
    expect(kinds).toContain("card-push");
    expect(kinds).toContain("zoom");
    expect(kinds).toContain("zoom-through");
    // The card pushes once, the cuts into both clips are zoom-throughs.
    expect((next.clips[0] as SlideClip).push).toBeCloseTo(1.06);
    expect(next.clips[1].transition?.kind).toBe("zoomThrough");
    expect(next.clips[2].transition?.kind).toBe("zoomThrough");
    const times = changes.map((c) => c.t).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1)
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(0.2);
    // Changes are reported in time order and name their target.
    expect(times).toEqual(changes.map((c) => c.t));
    for (const c of changes) expect(c.target).toBeTruthy();
    // On the recording, no stretch longer than a zoom (2.6 s) stays without
    // a change (a card's push is continuous, so it is not listed).
    const after = changeTimes(next);
    for (let i = 1; i < after.length; i += 1)
      if (after[i - 1] >= 5)
        expect(after[i] - after[i - 1]).toBeLessThanOrEqual(2.65);
    expect(next.zooms.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves transitions, pushes and the drift already there alone", () => {
    const edit: EditState = {
      ...DEFAULT_EDIT,
      drift: { scale: 0.05, pan: 0 },
      clips: [
        { ...slide("intro", 1.5), push: 1.1 },
        { ...fullClip("c1", 0, 1.5), transition: { kind: "fade", duration: 0.4 } },
      ],
    };
    const { edit: next, changes } = energize(edit);
    expect(changes).toEqual([]);
    expect(next).toEqual(edit);
  });

  it("pops a text when the recording is already zoomed", () => {
    const edit: EditState = {
      ...DEFAULT_EDIT,
      drift: { scale: 0.03, pan: 0.01 },
      clips: [fullClip("c1", 0, 6)],
      zooms: [{ id: "z", start: 0, end: 6, scale: 1.3, focus: null }],
      overlays: [text("t", 0, 6)],
    };
    const { edit: next, changes } = energize(edit, { every: 2 });
    expect(changes.map((c) => c.kind)).toEqual(["text-pop", "text-pop"]);
    const t = next.overlays[0] as TextOverlay;
    expect(t.keyframes?.scale?.[1].value).toBeCloseTo(1.04);
    expect(t.keyframes?.scale).toHaveLength(6);
  });
});
