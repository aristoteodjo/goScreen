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

describe("beam and ring", () => {
  it("builds a beam of the brand's light on a near-black canvas", () => {
    const beam = meshPreset("beam", "#4cc2ff");
    expect(hexToHsl(beam.base)[2]).toBeLessThan(0.06);
    expect(beam.colors).toHaveLength(3);
    expect(hexToHsl(beam.colors[0])[2]).toBeGreaterThan(hexToHsl(beam.colors[2])[2]);
    const shapes = meshShapes(beam);
    const core = shapes[2];
    expect(core.rx).toBeLessThan(0.06);
    expect(core.ry).toBeGreaterThan(0.6);
    // It breathes: wider at one moment than another, never still.
    const a = meshAt(beam, 0).shapes[1].rx;
    const b = meshAt(beam, 1.4).shapes[1].rx;
    expect(a).not.toBeCloseTo(b, 4);
  });

  it("turns a ring slowly", () => {
    const ring = meshPreset("ring", "#e9a100");
    const shapes = meshShapes(ring);
    expect(shapes.filter((s) => s.hole).length).toBe(2);
    for (const s of shapes.filter((s) => s.hole)) expect(s.hole).toBeGreaterThan(0.5);
    expect(meshAt(ring, 10).rotation).toBeCloseTo((60 / 180) * Math.PI);
    expect(ring.blur).toBeLessThan(0.1);
  });
});
