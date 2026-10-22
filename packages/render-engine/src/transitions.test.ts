import { describe, expect, it } from "vitest";
import { fullClip } from "./schema";
import { transitionAt, transitionLength, transitionMix } from "./transitions";
import type { MainClip, SlideClip } from "./types";

const slide = (
  id: string,
  duration: number,
  transition: SlideClip["transition"] = null,
): SlideClip => ({
  id,
  kind: "slide",
  duration,
  background: { kind: "color", value: "#000000" },
  title: "",
  subtitle: "",
  color: "#ffffff",
  font: "Inter",
  animation: "none",
  transition,
});

describe("transitions", () => {
  const clips: MainClip[] = [
    slide("a", 2),
    { ...fullClip("b", 0, 4), transition: { kind: "fade", duration: 0.5 } },
  ];

  it("runs over the start of the incoming clip", () => {
    expect(transitionAt(clips, 1.9)).toBeNull();
    const at = transitionAt(clips, 2.25);
    expect(at?.kind).toBe("fade");
    expect(at?.progress).toBeCloseTo(0.5);
    expect(at?.prev.clip.id).toBe("a");
    expect(transitionAt(clips, 2.6)).toBeNull();
  });

  it("never takes more than half of either clip", () => {
    const short = slide("s", 0.4);
    expect(
      transitionLength(short, {
        ...fullClip("b", 0, 4),
        transition: { kind: "fade", duration: 2 },
      }),
    ).toBeCloseTo(0.2);
  });

  it("has no transition on the first clip", () => {
    const first: MainClip[] = [
      { ...fullClip("b", 0, 4), transition: { kind: "fade", duration: 1 } },
    ];
    expect(transitionAt(first, 0.2)).toBeNull();
  });

  it("ends with the incoming clip fully in place", () => {
    for (const kind of [
      "fade",
      "dip",
      "slide-left",
      "slide-up",
      "zoom",
      "wipe",
      "blur",
      "push",
    ] as const) {
      const m = transitionMix(kind, 1);
      expect(m.to.alpha).toBe(1);
      expect(m.to.dx).toBeCloseTo(0);
      expect(m.to.dy).toBeCloseTo(0);
      expect(m.to.scale).toBeCloseTo(1);
      expect(m.dip).toBeCloseTo(0);
      expect(m.reveal).toBe(1);
    }
  });

  it("dips through black at mid point", () => {
    expect(transitionMix("dip", 0.5).dip).toBeCloseTo(1);
  });

  it("goes soft at the cut and sharp again, and smears the slides", () => {
    expect(transitionMix("blur", 0).blur).toBe(0);
    expect(transitionMix("blur", 0.5).blur).toBeCloseTo(30 / 1080, 6);
    expect(transitionMix("blur", 1).blur).toBe(0);
    expect(transitionMix("slide-left", 0.5).samples).toBeGreaterThan(1);
    expect(transitionMix("fade", 0.5).samples).toBe(1);
    const push = transitionMix("push", 0.3);
    expect(push.from.scale).toBeGreaterThan(1);
    expect(push.to.scale).toBeGreaterThan(1);
    expect(push.fromOnTop).toBe(false);
  });
});

describe("zoom through", () => {
  it("dives into the focus with all the speed at the cut and lands settled", async () => {
    const { diveOffset, expoOut } = await import("./transitions");
    expect(expoOut(0)).toBe(0);
    expect(expoOut(1)).toBe(1);
    // Half the travel is done in the first fifth.
    expect(expoOut(0.2)).toBeGreaterThan(0.7);
    const early = transitionMix("zoomThrough", 0.1, { x: 0.8, y: 0.3 });
    expect(early.from.scale).toBeGreaterThan(1.4);
    expect(early.samples).toBe(3);
    expect(early.blur).toBeGreaterThan(0);
    // The focus point stays where it is while the picture grows.
    const off = diveOffset({ x: 0.8, y: 0.3 }, early.from.scale);
    expect(early.from.dx).toBeCloseTo(off.x);
    expect(0.5 + off.x + (0.8 - 0.5) * early.from.scale).toBeCloseTo(0.8);
    const done = transitionMix("zoomThrough", 1);
    expect(done.to).toEqual({ alpha: 1, dx: 0, dy: 0, scale: 1 });
    expect(done.from.alpha).toBe(0);
  });

  it("carries the clip's focus", () => {
    const clips: MainClip[] = [
      slide("a", 2),
      {
        ...fullClip("b", 0, 4),
        transition: { kind: "zoomThrough", duration: 0.5, focus: { x: 0.2, y: 0.7 } },
      },
    ];
    expect(transitionAt(clips, 2.1)?.focus).toEqual({ x: 0.2, y: 0.7 });
    const plain: MainClip[] = [
      slide("a", 2),
      { ...fullClip("b", 0, 4), transition: { kind: "fade", duration: 0.5 } },
    ];
    expect(transitionAt(plain, 2.1)?.focus).toEqual({ x: 0.5, y: 0.5 });
  });
});
