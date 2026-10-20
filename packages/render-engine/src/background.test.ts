import { describe, expect, it } from "vitest";
import {
  hexToHsl,
  hslToHex,
  meshAt,
  meshPalette,
  meshPreset,
  meshShapes,
} from "./background";

describe("colour helpers", () => {
  it("round-trips hex through hsl", () => {
    for (const hex of ["#000000", "#ffffff", "#e9a100", "#102820", "#3366cc"]) {
      const [h, s, l] = hexToHsl(hex);
      expect(hslToHex(h, s, l)).toBe(hex);
    }
  });

  it("builds a dark, desaturated family from a brand colour", () => {
    const { base, colors } = meshPalette("#e9a100");
    expect(hexToHsl(base)[2]).toBeLessThan(0.1);
    expect(colors).toHaveLength(5);
    for (const c of colors) {
      const [, s, l] = hexToHsl(c);
      expect(s).toBeLessThanOrEqual(0.52);
      expect(l).toBeLessThan(0.4);
    }
    expect(hexToHsl(meshPalette("#e9a100", "light").base)[2]).toBeGreaterThan(0.9);
  });
});

describe("mesh", () => {
  const circles = meshPreset("circles", "#3366cc");

  it("covers a frame twice the output with nine discs", () => {
    const shapes = meshShapes(circles);
    expect(shapes).toHaveLength(9);
    for (const s of shapes) {
      expect(s.rx).toBeGreaterThan(0.3);
      expect(Math.hypot(s.x - 0.5, s.y - 0.5)).toBeLessThan(0.85);
    }
  });

  it("turns circles at 20 degrees a second and is deterministic", () => {
    expect(meshAt(circles, 0).rotation).toBe(0);
    expect(meshAt(circles, 1).rotation).toBeCloseTo((20 / 180) * Math.PI, 9);
    expect(meshAt({ ...circles, speed: 0.5 }, 2).rotation).toBeCloseTo(
      (20 / 180) * Math.PI,
      9,
    );
    expect(meshAt(circles, 3.3)).toEqual(meshAt(circles, 3.3));
  });

  it("breathes the blob and slides the waves without turning", () => {
    const blob = meshPreset("blob", "#3366cc");
    const a = meshAt(blob, 0).shapes[0];
    const b = meshAt(blob, 0.4).shapes[0];
    expect(meshAt(blob, 0.4).rotation).toBe(0);
    expect(a.x === b.x && a.rx === b.rx).toBe(false);
    const waves = meshPreset("waves", "#3366cc");
    const w = meshShapes(waves);
    expect(w).toHaveLength(3);
    expect(w[2].soft).toBeGreaterThan(w[0].soft);
    expect(meshAt(waves, 2).shapes[0].x).not.toBe(w[0].x);
  });
});
