import type { RecordedLayer, RecordedPointer } from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";
import { glassBounds, slug, splitParts, type TakeJournal } from "./split";

const layer = (
  instanceId: string,
  deviceId: string,
  x: number,
): RecordedLayer => ({
  instanceId,
  deviceId,
  colorId: "black",
  orientation: "portrait",
  screen: { width: 402, height: 874 },
  source: "web",
  rotation: 0,
  rects: [
    { t: 0, x, y: 0.1, width: 0.2, height: 0.8 },
    { t: 1, x, y: 0.1, width: 0.2, height: 0.8 },
  ],
});

const tap = (instanceId: string, u: number): RecordedPointer => ({
  t: 0.5,
  kind: "down",
  x: 0.9,
  y: 0.9,
  u,
  v: 0.5,
  instanceId,
  source: "web",
});

const take: TakeJournal = {
  version: 3,
  startedAt: 0,
  mode: "canvas",
  capture: { width: 1000, height: 500 },
  layers: [layer("a", "iPhone 17 Pro", 0.1), layer("b", "pixel-10", 0.6)],
  pointers: [
    tap("a", 0.25),
    tap("b", 0.75),
    { ...tap("a", 0.3), u: undefined },
  ],
  devices: [{ id: "a" }, { id: "b" }],
  events: [],
  camera: null,
};

describe("splitParts", () => {
  it("makes one part per device glass, cropped where it sat", () => {
    const parts = splitParts(take);
    expect(parts.map((p) => p.suffix)).toEqual([
      "dev1-iphone-17-pro",
      "dev2-pixel-10",
    ]);
    const r = parts[1].rect;
    expect([r.x, r.y, r.width, r.height].map((v) => +v.toFixed(6))).toEqual([
      0.6, 0.1, 0.2, 0.8,
    ]);
    expect(parts[0].journal.capture).toEqual({ width: 200, height: 400 });
  });

  it("turns the glass into the whole frame and keeps its own touches", () => {
    const [a] = splitParts(take);
    expect(a.journal.layers).toHaveLength(1);
    expect(a.journal.layers[0].rects).toEqual([
      { t: 0, x: 0, y: 0, width: 1, height: 1 },
    ]);
    expect(a.journal.pointers).toEqual([
      { ...tap("a", 0.25), x: 0.25, y: 0.5 },
    ]);
    expect(a.journal.devices).toEqual([{ id: "a" }]);
    expect(a.journal.mode).toBe("device");
  });

  it("does nothing for a single-device take", () => {
    expect(splitParts({ ...take, layers: [take.layers[0]] })).toEqual([]);
  });

  it("bounds a glass that moved and makes safe file names", () => {
    expect(
      glassBounds([
        { t: 0, x: 0.1, y: 0.2, width: 0.2, height: 0.2 },
        { t: 1, x: 0.2, y: 0.1, width: 0.2, height: 0.2 },
      ]),
    ).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.30000000000000004,
      height: 0.30000000000000004,
    });
    expect(slug("../Galaxy S25 Ultra!")).toBe("galaxy-s25-ultra");
  });
});
