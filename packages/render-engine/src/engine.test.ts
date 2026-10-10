import { describe, expect, it } from "vitest";
import {
  autoFocus,
  cameraAt,
  composeFrame,
  constrainSegment,
  contentRect,
  DEFAULT_EDIT,
  formatTime,
  fullClip,
  outputSize,
  parseEditState,
  parseRecordingFile,
  placeZoom,
  presses,
  quadMapper,
  tapTimes,
  timelineOf,
  touchesAt,
  zoomAmount,
} from "./index";
import type { RecordedPointer, ZoomSegment } from "./types";

const tap = (
  t: number,
  x: number,
  y: number,
  kind: RecordedPointer["kind"] = "down",
): RecordedPointer => ({
  t,
  kind,
  x,
  y,
  instanceId: "a",
  source: "web",
});

const zoom = (
  start: number,
  end: number,
  extra: Partial<ZoomSegment> = {},
): ZoomSegment => ({
  id: `z${start}`,
  start,
  end,
  scale: 2,
  focus: null,
  ...extra,
});

describe("homography", () => {
  it("maps the unit square onto an axis-aligned rect", () => {
    const map = quadMapper([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 220 },
      { x: 10, y: 220 },
    ]);
    expect(map(0.5, 0.5)).toEqual({ x: 60, y: 120 });
    expect(map(1, 1)).toEqual({ x: 110, y: 220 });
  });

  it("hits every corner of a perspective quad", () => {
    const quad = [
      { x: 0, y: 0 },
      { x: 100, y: 10 },
      { x: 90, y: 90 },
      { x: 5, y: 100 },
    ] as const;
    const map = quadMapper([...quad] as never);
    const corners = [map(0, 0), map(1, 0), map(1, 1), map(0, 1)];
    corners.forEach((c, i) => {
      expect(c.x).toBeCloseTo(quad[i].x, 6);
      expect(c.y).toBeCloseTo(quad[i].y, 6);
    });
  });
});

describe("layout", () => {
  it("keeps the source ratio on auto, with even sides", () => {
    expect(outputSize("auto", { width: 1000, height: 1001 })).toEqual({
      width: 1918,
      height: 1920,
    });
    expect(outputSize("16:9", { width: 1, height: 1 })).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(outputSize("9:16", { width: 1, height: 1 })).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it("letterboxes the video inside the padding", () => {
    const r = contentRect(
      { width: 1000, height: 1000 },
      { width: 200, height: 100 },
      0.1,
    );
    expect(r).toEqual({ x: 100, y: 300, width: 800, height: 400 });
  });
});

describe("camera", () => {
  it("eases in and out of a zoom", () => {
    const seg = zoom(1, 5);
    expect(zoomAmount(seg, 0.5)).toBe(0);
    expect(zoomAmount(seg, 3)).toBe(1);
    expect(zoomAmount(seg, 1.35)).toBeGreaterThan(0);
    expect(zoomAmount(seg, 1.35)).toBeLessThan(1);
  });

  it("never shows outside the frame", () => {
    const out = { width: 1000, height: 500 };
    const cam = cameraAt(zoom(0, 10), 5, out, { x: 0, y: 0 });
    expect(cam.scale).toBe(2);
    expect(cam.center).toEqual({ x: 250, y: 125 });
  });

  it("follows the latest tap and glides to the next", () => {
    const seg = zoom(0, 10);
    const pointers = [tap(1, 0.1, 0.1), tap(5, 0.9, 0.9)];
    expect(autoFocus(pointers, seg, 2)).toEqual({ x: 0.1, y: 0.1 });
    expect(autoFocus(pointers, seg, 6)).toEqual({ x: 0.9, y: 0.9 });
    const mid = autoFocus(pointers, seg, 4.75);
    expect(mid?.x).toBeGreaterThan(0.1);
    expect(mid?.x).toBeLessThan(0.9);
  });
});

describe("touches", () => {
  it("pairs downs with ups and fades rings after release", () => {
    const list = presses([tap(1, 0.5, 0.5), tap(1.3, 0.5, 0.5, "up")]);
    expect(list).toHaveLength(1);
    expect(touchesAt(list, 0.9)).toHaveLength(0);
    expect(touchesAt(list, 1.2)[0].opacity).toBe(1);
    const fading = touchesAt(list, 1.5)[0];
    expect(fading.opacity).toBeLessThan(1);
    expect(fading.scale).toBeGreaterThan(1);
    expect(touchesAt(list, 2)).toHaveLength(0);
  });

  it("times click sounds on the timeline, skipping cut and muted parts", () => {
    const taps = [tap(1, 0, 0), tap(3, 0, 0), tap(9, 0, 0)];
    expect(tapTimes(taps, [fullClip("a", 2, 8)])).toEqual([1]);
    // 3s sits in the second clip, played at 2x after a 1s clip.
    const clips = [fullClip("a", 0, 1), { ...fullClip("b", 2, 10), speed: 2 }];
    expect(tapTimes(taps, clips)).toEqual([1.5, 4.5]);
    expect(
      tapTimes(taps, [
        fullClip("a", 0, 1),
        { ...fullClip("b", 2, 10), muted: true },
      ]),
    ).toEqual([]);
  });
});

describe("timeline", () => {
  it("formats times", () => {
    expect(formatTime(32.06, true)).toBe("0:32.06");
    expect(formatTime(75)).toBe("1:15");
  });

  it("places new zooms only in free gaps", () => {
    const zooms = [zoom(2, 4)];
    expect(placeZoom(zooms, 3, 10)).toBeNull();
    expect(placeZoom(zooms, 5, 10)).toEqual({ start: 4, end: 6.5 });
    expect(placeZoom(zooms, 0.5, 10)).toEqual({ start: 0, end: 2 });
  });

  it("stops a dragged segment at its neighbours", () => {
    const zooms = [zoom(0, 2), zoom(3, 4), zoom(6, 8)];
    expect(constrainSegment(zooms, "z3", 1, 2, 10, "move")).toEqual({
      start: 2,
      end: 3,
    });
    expect(constrainSegment(zooms, "z3", 3, 7, 10, "end")).toEqual({
      start: 3,
      end: 6,
    });
  });
});

describe("files", () => {
  it("reads v2 interactions and tolerates v1", () => {
    const file = parseRecordingFile({
      version: 2,
      stage: { width: 1920, height: 1080 },
      pointers: [tap(2, 0, 0), tap(-1, 0, 0), tap(1, 0, 0)],
    });
    expect(file.pointers.map((p) => p.t)).toEqual([1, 2]);
    expect(parseRecordingFile({ version: 1, events: [] }).pointers).toEqual([]);
    expect(() => parseRecordingFile({ nope: true })).toThrow();
  });

  it("repairs a bad field without losing the others", () => {
    const edit = parseEditState({ ...DEFAULT_EDIT, padding: 9, aspect: "1:1" });
    expect(edit?.padding).toBe(DEFAULT_EDIT.padding);
    expect(edit?.aspect).toBe("1:1");
  });
});

describe("compose", () => {
  it("projects touches through the padded content rect", () => {
    const timeline = timelineOf({ width: 100, height: 100 }, [
      tap(1, 0.5, 0.5),
    ]);
    const frame = composeFrame(
      { ...DEFAULT_EDIT, padding: 0.1 },
      timeline,
      { width: 1000, height: 1000 },
      1.05,
    );
    expect(frame.content).toEqual({ x: 100, y: 100, width: 800, height: 800 });
    expect(frame.touches[0]).toMatchObject({ x: 500, y: 500 });
    expect(frame.camera.scale).toBe(1);
  });
});
