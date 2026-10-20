import { describe, expect, it } from "vitest";
import { quadMapper } from "./homography";
import { spring, springSettle } from "./keyframes";
import {
  driftAt,
  entranceAt,
  insideQuad,
  pop,
  popSpring,
  projectRect,
  quadBounds,
  sharp,
  sharpOut,
  sweepAngle,
} from "./look";

describe("sharp curves", () => {
  it("start at full speed and decelerate for long", () => {
    expect(sharp(0)).toBe(0);
    expect(sharp(1)).toBe(1);
    // Most of the way there in the first quarter of the time.
    expect(sharp(0.25)).toBeGreaterThan(0.75);
    expect(sharp(0.5)).toBeGreaterThan(0.9);
  });

  it("the exit curve accelerates instead", () => {
    expect(sharpOut(0.5)).toBeLessThan(0.2);
    expect(sharpOut(0.9)).toBeGreaterThan(0.45);
  });
});

describe("pop (4 frames + bounce)", () => {
  it("reaches the target in about four frames and overshoots by the amplitude", () => {
    const frame = 1 / 30;
    expect(pop(0)).toBe(0);
    expect(pop(4 * frame)).toBeGreaterThan(0.95);
    let peak = 0;
    for (let t = 0; t < 1; t += 1 / 240) peak = Math.max(peak, pop(t));
    expect(peak).toBeGreaterThan(1.2);
    expect(peak).toBeLessThan(1.3);
    // Wider gestures bounce more.
    let wide = 0;
    for (let t = 0; t < 1; t += 1 / 240) wide = Math.max(wide, pop(t, 50));
    expect(wide).toBeGreaterThan(1.45);
  });

  it("settles within a second", () => {
    expect(springSettle(popSpring(25))).toBeLessThan(1);
    expect(spring(2, popSpring(25))).toBeCloseTo(1, 3);
  });
});

describe("entrance", () => {
  it("pops in from below and leaning back, then rests", () => {
    const start = entranceAt(0);
    expect(start.dy).toBeGreaterThan(0);
    expect(start.tiltX).toBeLessThan(0);
    expect(start.opacity).toBe(0);
    const mid = entranceAt(0.15);
    expect(mid.dy).toBeLessThan(start.dy * 0.4);
    expect(mid.opacity).toBe(1);
    expect(entranceAt(0.6)).toEqual({ dy: 0, tiltX: 0, scale: 1, opacity: 1 });
    expect(entranceAt(5)).toEqual({ dy: 0, tiltX: 0, scale: 1, opacity: 1 });
  });

  it("drifts across the scene, centred on zero", () => {
    expect(driftAt(0, 4, 3)).toBe(-1.5);
    expect(driftAt(2, 4, 3)).toBe(0);
    expect(driftAt(4, 4, 3)).toBe(1.5);
    expect(driftAt(9, 4, 3)).toBe(1.5);
    expect(driftAt(1, 4, 0)).toBe(0);
    expect(sweepAngle(0, 4)).toBe(90);
    expect(sweepAngle(4, 4)).toBe(19);
  });
});

describe("projection", () => {
  const center = { x: 500, y: 300 };
  const size = { width: 400, height: 200 };

  it("is the plain rectangle without tilt", () => {
    const { quad, z } = projectRect(center, size, 0, { x: 0, y: 0 }, 2000);
    expect(quad[0]).toEqual({ x: 300, y: 200 });
    expect(quad[2]).toEqual({ x: 700, y: 400 });
    expect(z).toEqual([0, 0, 0, 0]);
  });

  it("leans the top away when x is positive (seen from below)", () => {
    const { quad, z } = projectRect(center, size, 0, { x: 20, y: 0 }, 2000);
    // Far corners are deeper and closer together.
    expect(z[0]).toBeGreaterThan(0);
    expect(z[3]).toBeLessThan(0);
    expect(quad[1].x - quad[0].x).toBeLessThan(quad[2].x - quad[3].x);
    // Symmetric about the centre line.
    expect(quad[0].x + quad[1].x).toBeCloseTo(1000, 6);
  });

  it("turns the right edge away when y is positive", () => {
    const { quad, z } = projectRect(center, size, 0, { x: 0, y: 25 }, 2000);
    expect(z[1]).toBeGreaterThan(0);
    expect(z[0]).toBeLessThan(0);
    expect(quad[1].y - quad[2].y).toBeGreaterThan(quad[0].y - quad[3].y);
  });

  it("keeps the homography and the hit test consistent", () => {
    const { quad } = projectRect(center, size, 0.2, { x: 12, y: -15 }, 2000);
    const map = quadMapper(quad);
    const inside = map(0.3, 0.7);
    expect(insideQuad(quad, inside)).toBe(true);
    expect(insideQuad(quad, map(1.2, 0.5))).toBe(false);
    const b = quadBounds(quad);
    expect(inside.x).toBeGreaterThanOrEqual(b.x);
    expect(inside.x).toBeLessThanOrEqual(b.x + b.width);
  });
});

describe("scene time", () => {
  it("groups plain cuts into one scene and opens a new one after a card or a transition", async () => {
    const { sceneTimeAt } = await import("./compose");
    const { fullClip } = await import("./schema");
    const rec = (id: string, from: number, to: number) => ({
      ...fullClip(id, from, to),
    });
    const card = {
      id: "card",
      kind: "slide" as const,
      duration: 2,
      background: { kind: "none" as const },
      title: "",
      subtitle: "",
      color: "#ffffff",
      font: "Inter",
      animation: "fade" as const,
      transition: null,
    };
    const clips = [
      rec("a", 0, 3),
      rec("b", 3, 5),
      card,
      rec("c", 10, 12),
      { ...rec("d", 20, 21), transition: { kind: "fade" as const, duration: 0.3 } },
    ];
    // a and b are one scene of 5 s.
    expect(sceneTimeAt(clips, 1)).toEqual({ local: 1, length: 5, opens: true });
    expect(sceneTimeAt(clips, 4)).toEqual({ local: 4, length: 5, opens: true });
    // The card is not a scene.
    expect(sceneTimeAt(clips, 6)).toBeNull();
    // c opens after the card; d opens with its transition.
    expect(sceneTimeAt(clips, 7.5)).toEqual({ local: 0.5, length: 2, opens: true });
    const d = sceneTimeAt(clips, 9.2);
    expect(d?.local).toBeCloseTo(0.2, 6);
    expect(d?.length).toBe(1);
  });
});
