import { describe, expect, it } from "vitest";
import {
  boundsOf,
  clampZoom,
  fitView,
  screenToCanvas,
  stepZoom,
  zoomAt,
} from "./math";

describe("canvas math", () => {
  it("keeps the point under the cursor fixed when zooming", () => {
    const v = { zoom: 1, panX: 40, panY: -20 };
    const before = screenToCanvas(300, 200, v);
    const after = screenToCanvas(300, 200, zoomAt(v, 2.5, 300, 200));
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps and steps zoom", () => {
    expect(clampZoom(10)).toBe(4);
    expect(clampZoom(0)).toBe(0.05);
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.6, -1)).toBe(0.5);
  });

  it("fits and centers content without zooming past 100%", () => {
    const bounds = boundsOf([
      { x: 0, y: 0, width: 400, height: 800 },
      { x: 500, y: 100, width: 400, height: 700 },
    ]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 900, height: 800 });
    if (!bounds) return;
    const v = fitView(bounds, { width: 1200, height: 1000 }, 100);
    expect(v.zoom).toBe(1);
    expect(v.panX).toBeCloseTo((1200 - 900) / 2);
    const small = fitView(bounds, { width: 600, height: 600 }, 50);
    expect(small.zoom).toBeCloseTo(500 / 900);
  });
});
