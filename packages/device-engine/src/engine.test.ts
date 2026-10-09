import { builtinPack } from "@goscreen/device-registry";
import { describe, expect, it } from "vitest";
import { fitScale, resizeViewport, resolveScreenLayout } from "./geometry";
import { arrangeDevices } from "./layout";
import { SHADOW_PRESETS, shadowToCss } from "./style";

const found = builtinPack.devices.find((d) => d.id === "iphone-17-pro");
if (!found) throw new Error("iphone-17-pro missing from the builtin pack");
const iphone = found;

describe("geometry", () => {
  it("swaps the viewport and moves the top inset in landscape", () => {
    const p = resolveScreenLayout(iphone, "portrait");
    const l = resolveScreenLayout(iphone, "landscape");
    expect(l.screen).toEqual({ width: p.screen.height, height: p.screen.width });
    expect(l.safeArea.left).toBe(p.safeArea.top);
    expect(l.safeArea.top).toBe(0);
  });

  it("adds the bezel on each side of the frame", () => {
    const { frame, screen, bezel } = resolveScreenLayout(iphone, "portrait");
    expect(frame.width).toBe(screen.width + bezel * 2);
  });

  it("fits content inside a box", () => {
    expect(fitScale({ width: 100, height: 200 }, { width: 100, height: 100 })).toBe(0.5);
  });
});

describe("layout", () => {
  it("centers a row of devices on the stage", () => {
    const stage = { width: 1920, height: 1080 };
    const items = ["a", "b"].map((id) => ({
      id,
      device: iphone,
      orientation: "portrait" as const,
      scale: 1,
      viewport: null,
    }));
    const pos = arrangeDevices(items, stage);
    const a = pos.get("a") ?? { x: Number.NaN, y: Number.NaN };
    const b = pos.get("b") ?? { x: Number.NaN, y: Number.NaN };
    expect((a.x + b.x) / 2).toBeCloseTo(stage.width / 2);
    expect(a.y).toBeCloseTo(stage.height / 2);
  });

  const phones = (n: number, scale: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      device: iphone,
      orientation: "portrait" as const,
      scale,
      viewport: null,
    }));
  const frame = resolveScreenLayout(iphone, "portrait").frame;

  it("shrinks devices as more are added so they all fit the stage", () => {
    const stage = { width: 1920, height: 1080 };
    // Each phone alone fills 78% of the stage height.
    const alone = (stage.height * 0.78) / frame.height;
    const scaleOf = (n: number) => arrangeDevices(phones(n, alone), stage).get("p0")?.scale ?? 0;
    expect(scaleOf(1)).toBeCloseTo(alone);
    expect(scaleOf(6)).toBeLessThan(scaleOf(3));
    for (const p of arrangeDevices(phones(6, alone), stage).values()) {
      const w = frame.width * p.scale;
      const h = frame.height * p.scale;
      expect(p.x - w / 2).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x + w / 2).toBeLessThanOrEqual(stage.width + 1e-6);
      expect(p.y - h / 2).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y + h / 2).toBeLessThanOrEqual(stage.height + 1e-6);
    }
  });

  it("stacks rows on a portrait stage when that keeps devices bigger", () => {
    const stage = { width: 1080, height: 1920 };
    const alone = (stage.width * 0.42) / frame.width;
    const pos = [...arrangeDevices(phones(4, alone), stage).values()];
    const rows = new Set(pos.map((p) => Math.round(p.y)));
    expect(rows.size).toBeGreaterThan(1);
  });
});

describe("style", () => {
  it("disables the shadow at zero opacity", () => {
    expect(shadowToCss(SHADOW_PRESETS.none)).toBe("none");
    expect(shadowToCss(SHADOW_PRESETS.soft)).toContain("drop-shadow");
  });
});

describe("resize", () => {
  const start = { width: 400, height: 800 };

  it("grows width only from the right edge", () => {
    expect(resizeViewport(start, "portrait", "right", 50, 999)).toEqual({ width: 450, height: 800 });
  });

  it("maps displayed axes back to portrait storage in landscape", () => {
    // Shown as 800x400; dragging the right edge widens the stored height.
    expect(resizeViewport(start, "landscape", "right", 100, 0)).toEqual({ width: 400, height: 900 });
  });

  it("clamps to the minimum viewport", () => {
    const r = resizeViewport(start, "portrait", "corner", -1000, -1000);
    expect(r.width).toBe(240);
    expect(r.height).toBe(320);
  });

  it("uses the override for the frame", () => {
    const l = resolveScreenLayout(iphone, "portrait", { width: 500, height: 900 });
    expect(l.screen).toEqual({ width: 500, height: 900 });
  });
});
