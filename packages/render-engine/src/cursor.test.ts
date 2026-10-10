import { describe, expect, it } from "vitest";
import { buildAutoZooms } from "./autoZoom";
import { cursorAt } from "./cursor";
import { presses } from "./touches";
import type { RecordedPointer } from "./types";

const at = (
  t: number,
  kind: RecordedPointer["kind"],
  x = 0.5,
  instanceId = "a",
): RecordedPointer => ({ t, kind, x, y: 0.5, instanceId, source: "web" });
const id = (p: RecordedPointer) => ({ x: p.x, y: p.y });

describe("buildAutoZooms", () => {
  it("groups a burst of clicks into one zoom and ignores plain moves", () => {
    const pointers = [
      at(1, "move"),
      at(2, "down"),
      at(2.1, "up"),
      at(3, "down"),
      at(3.1, "up"),
      at(10, "down"),
      at(10.1, "up"),
      at(12, "move"),
    ];
    const zooms = buildAutoZooms(pointers, 11);
    expect(zooms.map((z) => [z.start, z.end])).toEqual([
      [1.4, 4.4],
      [9.4, 11],
    ]);
    expect(zooms.every((z) => z.focus === null && z.scale > 1)).toBe(true);
    expect(new Set(zooms.map((z) => z.id)).size).toBe(2);
  });

  it("proposes nothing without clicks", () => {
    expect(buildAutoZooms([at(1, "move"), at(2, "move")], 5)).toEqual([]);
  });
});

describe("cursorAt", () => {
  const moves = [at(0, "move", 0), at(0.2, "move", 1)];

  it("is absent before the first sample and glides between samples", () => {
    expect(cursorAt(moves, [], -1, id)).toBeNull();
    const mid = cursorAt(moves, [], 0.1, id);
    expect(mid?.x).toBeGreaterThan(0);
    expect(mid?.x).toBeLessThan(1);
  });

  it("jumps instead of gliding to another device", () => {
    const jump = [at(0, "move", 0), at(0.2, "move", 1, "b")];
    expect(cursorAt(jump, [], 0.1, id)?.x).toBe(0);
  });

  it("lands exactly on a click and reports the press", () => {
    const click = [at(0, "move", 0), at(0.1, "down", 0.8), at(0.3, "up", 0.8)];
    const c = cursorAt(click, presses(click), 0.2, id);
    expect(c?.pressed).toBe(1);
    expect(c?.x).toBeCloseTo(0.8);
  });
});
