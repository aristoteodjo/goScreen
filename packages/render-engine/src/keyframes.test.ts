import { describe, expect, it } from "vitest";
import { animate, interpolate, spring, springSettle } from "./index";

describe("interpolate", () => {
  it("maps piece by piece and clamps by default", () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(15, [0, 10, 20], [0, 100, 0])).toBe(50);
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(0);
    expect(interpolate(30, [0, 10], [0, 100])).toBe(100);
  });

  it("extends or passes through when asked", () => {
    expect(
      interpolate(20, [0, 10], [0, 100], { extrapolateRight: "extend" }),
    ).toBe(200);
    expect(
      interpolate(-3, [0, 10], [0, 100], { extrapolateLeft: "identity" }),
    ).toBe(-3);
  });

  it("applies the easing inside a piece", () => {
    expect(interpolate(5, [0, 10], [0, 100], { easing: (x) => x * x })).toBe(
      25,
    );
  });

  it("refuses ranges it cannot map", () => {
    expect(() => interpolate(1, [0], [0])).toThrow();
    expect(() => interpolate(1, [0, 1], [0, 1, 2])).toThrow();
    expect(() => interpolate(1, [1, 1], [0, 1])).toThrow();
  });
});

describe("spring", () => {
  it("starts at 0, overshoots, then settles on 1", () => {
    expect(spring(0)).toBe(0);
    const samples = Array.from({ length: 200 }, (_, i) => spring(i / 60));
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(spring(5)).toBeCloseTo(1, 3);
  });

  it("never passes 1 when clamped or overdamped", () => {
    for (let i = 0; i < 300; i++) {
      expect(spring(i / 60, { overshootClamping: true })).toBeLessThanOrEqual(
        1,
      );
      expect(spring(i / 60, { damping: 40 })).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("settles faster when stiffer", () => {
    expect(springSettle({ stiffness: 300, damping: 30 })).toBeLessThan(
      springSettle(),
    );
  });

  it("drives the spring animation into place", () => {
    expect(animate("spring", 0).opacity).toBe(0);
    const end = animate("spring", 1);
    expect(end.opacity).toBe(1);
    expect(end.dy).toBeCloseTo(0, 2);
    expect(end.scale).toBeCloseTo(1, 2);
  });
});
