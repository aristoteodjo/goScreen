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
});
