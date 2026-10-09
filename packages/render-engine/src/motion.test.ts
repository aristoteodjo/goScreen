import { describe, expect, it } from "vitest";
import { activeOverlays, animate, motionAt, type Overlay, slideMotion, typedText, wordOpacities } from "./index";

const shape = (id: string, lane: number, start: number, duration: number): Overlay => ({
  id,
  kind: "shape",
  shape: "arrow",
  color: "#ff0000",
  stroke: 0.01,
  lane,
  start,
  duration,
  x: 0.5,
  y: 0.5,
  width: 0.2,
  height: 0.1,
  rotation: 0,
  opacity: 1,
  enter: "fade",
  exit: "fade",
  motion: 0.5,
});

describe("motion", () => {
  it("fades and slides in, then settles", () => {
    expect(animate("fade", 0).opacity).toBe(0);
    expect(animate("fade", 1).opacity).toBe(1);
    expect(animate("slide-up", 0).dy).toBeGreaterThan(0);
    expect(animate("slide-up", 1).dy).toBe(0);
    expect(animate("pop", 1).scale).toBeCloseTo(1);
    expect(animate("pop", 0.7).scale).toBeGreaterThan(1);
  });

  it("plays enter, holds, then exit, and is hidden outside its life", () => {
    expect(motionAt("fade", "fade", 0.5, 4, -0.1).opacity).toBe(0);
    expect(motionAt("fade", "fade", 0.5, 4, 0.25).opacity).toBeCloseTo(0.5);
    expect(motionAt("fade", "fade", 0.5, 4, 2).opacity).toBe(1);
    expect(motionAt("fade", "fade", 0.5, 4, 3.75).opacity).toBeCloseTo(0.5);
    expect(motionAt("typewriter", "none", 0.5, 4, 0.25).reveal).toBeCloseTo(0.5);
  });

  it("types text and reveals words in order", () => {
    expect(typedText("Hello", 0.4)).toBe("He");
    expect(typedText("Héllo 👋", 1)).toBe("Héllo 👋");
    const words = wordOpacities(3, 0.4);
    expect(words[0]).toBeGreaterThan(words[1]);
    expect(words[2]).toBe(0);
    expect(wordOpacities(3, 1)).toEqual([1, 1, 1]);
  });

  it("reveals the subtitle after the title", () => {
    const m = slideMotion("fade", 4, 0.3);
    expect(m.title.opacity).toBeGreaterThan(m.subtitle.opacity);
  });

  it("lists active overlays bottom lane first", () => {
    const list = [shape("top", 2, 0, 5), shape("bottom", 0, 1, 2), shape("later", 1, 6, 1)];
    expect(activeOverlays(list, 1.5).map((o) => o.id)).toEqual(["bottom", "top"]);
  });
});
