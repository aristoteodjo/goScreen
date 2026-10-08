import { describe, expect, it } from "vitest";
import {
  arrangeLayers,
  composeFrame,
  DEFAULT_EDIT,
  hitLayer,
  parseRecordingFile,
  rectAt,
  stageArea,
  timelineOf,
  webcamRect,
} from "./index";
import type { EditState, RecordedLayer } from "./types";

const recorded: RecordedLayer = {
  instanceId: "a",
  deviceId: "phone",
  colorId: "black",
  orientation: "portrait",
  screen: { width: 400, height: 800 },
  source: "web",
  rotation: 0,
  rects: [
    { t: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.8 },
    { t: 5, x: 0.5, y: 0.1, width: 0.2, height: 0.8 },
  ],
};

const geometry = () => ({
  frame: { width: 440, height: 840 },
  screen: { x: 20, y: 20, width: 400, height: 800 },
});

describe("layers", () => {
  it("picks the layer rect in effect", () => {
    expect(rectAt(recorded.rects, 1)?.x).toBe(0.1);
    expect(rectAt(recorded.rects, 6)?.x).toBe(0.5);
  });

  it("lays devices side by side, bottoms aligned", () => {
    const [a, b] = arrangeLayers([{ width: 100, height: 200 }, { width: 100, height: 100 }], { width: 1000, height: 1000 });
    expect(a.scale).toBeCloseTo(0.8);
    expect(a.y + a.scale / 2).toBeCloseTo(b.y + b.scale / 2);
    expect(a.x).toBeLessThan(b.x);
  });

  it("places the webcam in a corner or a split column", () => {
    const cam = DEFAULT_EDIT.camera;
    const out = { width: 1000, height: 500 };
    expect(webcamRect(out, cam, false)).toBeNull();
    const r = webcamRect(out, { ...cam, corner: 8, size: 0.2 }, true);
    expect(r).toEqual({ x: 1000 - 100 - 20, y: 500 - 100 - 20, width: 100, height: 100 });
    expect(stageArea(out, { ...cam, layout: "split" }, true).width).toBeCloseTo(660);
  });
});

describe("layered compose", () => {
  const edit: EditState = {
    ...DEFAULT_EDIT,
    layers: [{ instanceId: "a", deviceId: "phone", colorId: "black", frame: true, x: 0.5, y: 0.5, scale: 0.84, rotation: 0 }],
  };
  const timeline = timelineOf(
    { width: 2000, height: 1000 },
    [{ t: 1, kind: "down", x: 0.2, y: 0.5, u: 0.5, v: 0.5, instanceId: "a", source: "web" }],
    { layers: [recorded], geometry },
  );

  it("crops each screen from the capture and places its frame", () => {
    const frame = composeFrame(edit, timeline, { width: 1000, height: 1000 }, 1.05);
    expect(frame.layers).toHaveLength(1);
    expect(frame.layers[0].crop).toEqual({ x: 200, y: 100, width: 400, height: 800 });
    expect(frame.layers[0].scale).toBeCloseTo(1);
    // The tap sits at the screen center, which is the frame center here.
    expect(frame.touches[0].x).toBeCloseTo(500);
    expect(frame.touches[0].y).toBeCloseTo(500);
    expect(hitLayer(frame.layers, { x: 500, y: 500 })).toBe("a");
    expect(hitLayer(frame.layers, { x: 5, y: 5 })).toBeNull();
  });

  it("reads v3 recordings with layers and media offset", () => {
    const file = parseRecordingFile({
      version: 3,
      mode: "canvas",
      capture: { width: 1200, height: 800 },
      layers: [recorded],
      pointers: [],
      media: { camera: "x.camera.mp4", mic: null, offsetMs: 150 },
    });
    expect(file.layers[0].rects).toHaveLength(2);
    expect(file.mode).toBe("canvas");
    expect(file.mediaOffset).toBeCloseTo(0.15);
  });
});
