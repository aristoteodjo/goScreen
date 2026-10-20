import {
  DEFAULT_EDIT,
  type EditState,
  fullClip,
  type Overlay,
  placeClips,
} from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";
import { alignScenesToVoice, phrasesOf } from "./voice";

const card = (id: string, duration: number) => ({
  id,
  kind: "slide" as const,
  duration,
  background: { kind: "none" as const },
  title: "",
  subtitle: "",
  color: "#ffffff",
  font: "Inter",
  animation: "fade" as const,
  transition: null,
});

const caption = (id: string, start: number, duration: number): Overlay => ({
  id,
  kind: "text",
  lane: 0,
  start,
  duration,
  x: 0.5,
  y: 0.1,
  width: 0.8,
  height: 0.1,
  rotation: 0,
  opacity: 1,
  enter: "fade",
  exit: "fade",
  motion: 0.3,
  text: id,
  style: {
    font: "Inter",
    size: 0.05,
    weight: 700,
    color: "#ffffff",
    align: "center",
    background: null,
  },
});

describe("phrasesOf", () => {
  it("maps sounding stretches to the timeline and merges breaths", () => {
    const phrases = phrasesOf(
      [
        [0.2, 1.4],
        [1.6, 2.5],
        [3.4, 4.0],
      ],
      { start: 3, in: 0 },
    );
    expect(phrases).toEqual([
      { start: 3.2, end: 5.5 },
      { start: 6.4, end: 7 },
    ]);
  });
});

describe("alignScenesToVoice", () => {
  const edit: EditState = {
    ...DEFAULT_EDIT,
    clips: [
      card("intro", 3),
      fullClip("scene-0", 0, 3.2),
      fullClip("scene-1", 3.2, 6.1),
      fullClip("scene-2", 6.1, 12),
    ],
    overlays: [
      caption("caption-0", 3, 3.2),
      caption("caption-1", 6.2, 2.9),
      caption("caption-2", 9.1, 5.9),
    ],
  };

  it("cuts each scene on the next phrase's attack and moves its caption", () => {
    const phrases = [
      { start: 3.1, end: 4.5 },
      { start: 5.0, end: 7.4 },
      { start: 8.0, end: 9.6 },
    ];
    const out = alignScenesToVoice(edit, phrases, 12);
    const placed = placeClips(out.clips);
    // Scene 0: 3.1 -> 5.0 = 1.9 s; scene 1: 5.0 -> 8.0 = 3 s (slowed: only 2.9 s of source).
    expect(placed[1].end - placed[1].start).toBeCloseTo(1.9, 3);
    expect(out.clips[1]).toMatchObject({ in: 0, out: 1.9, speed: 1 });
    expect(out.clips[2]).toMatchObject({ in: 3.2, out: 6.1 });
    expect((out.clips[2] as { speed: number }).speed).toBeCloseTo(2.9 / 3, 2);
    expect(placed[2].end - placed[2].start).toBeCloseTo(3, 2);
    // Last scene: its phrase plus a beat.
    expect(placed[3].end - placed[3].start).toBeCloseTo(2.2, 3);
    // Captions follow their scenes; the card is untouched.
    expect(out.overlays[0]).toMatchObject({ start: 3, duration: 1.9 });
    expect(out.overlays[1].start).toBeCloseTo(4.9, 3);
    expect(out.overlays[1].duration).toBeCloseTo(3, 2);
    expect(out.clips[0]).toEqual(edit.clips[0]);
  });

  it("never plays slower than the floor and leaves extra scenes alone", () => {
    const out = alignScenesToVoice(edit, [{ start: 3, end: 20 }], 12);
    expect((out.clips[1] as { speed: number }).speed).toBe(0.6);
    expect(out.clips[2]).toEqual(edit.clips[2]);
    expect(out.clips[3]).toEqual(edit.clips[3]);
  });

  it("is a no-op without phrases", () => {
    expect(alignScenesToVoice(edit, [], 12)).toBe(edit);
  });
});
