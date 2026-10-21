import {
  DEFAULT_EDIT,
  type EditState,
  fullClip,
  type MainClip,
} from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";
import {
  captionLook,
  lastWordEnd,
  timelineWords,
  withCaptions,
  withMusic,
  withSfx,
} from "./sound";

const words = [
  { text: "One", start: 1, end: 1.3, p: 1 },
  { text: "two", start: 1.4, end: 1.7, p: 1 },
  { text: "cut", start: 5, end: 5.4, p: 1 },
  { text: "three", start: 11, end: 11.5, p: 1 },
];

// Two scenes: source 0..4 at normal speed, then 10..14 at double speed.
const clips: MainClip[] = [
  fullClip("a", 0, 4),
  { ...fullClip("b", 10, 14), speed: 2 },
];
const edit: EditState = { ...DEFAULT_EDIT, clips, film: undefined };

describe("words on the timeline", () => {
  it("follows the cuts and the speed, drops what is cut", () => {
    expect(timelineWords(clips, words)).toEqual([
      { text: "One", start: 1, end: 1.3 },
      { text: "two", start: 1.4, end: 1.7 },
      { text: "three", start: 4.5, end: 4.75 },
    ]);
    expect(lastWordEnd(edit, words)).toBe(4.75);
    expect(lastWordEnd(edit, null)).toBeNull();
    expect(
      lastWordEnd(edit, [{ text: "x", start: 7, end: 8, p: 1 }]),
    ).toBeNull();
  });

  it("writes captions in the film's colours and replaces the old ones", () => {
    const stale = {
      ...withCaptions(edit, timelineWords(clips, words)).edit,
    };
    expect(
      stale.overlays.filter((o) => o.id.startsWith("caption-word-")),
    ).toHaveLength(2);
    const look = captionLook({
      ...stale,
      film: { settings: { accent: "#ff0000", font: "Georgia" }, locale: "fr" },
    });
    expect(look).toMatchObject({ accent: "#ff0000", font: "Georgia", lane: 0 });
    const again = withCaptions(
      stale,
      timelineWords(clips, words.slice(0, 2)),
      look,
    );
    expect(again.count).toBe(1);
    expect(again.edit.overlays).toHaveLength(1);
    expect(again.edit.overlays[0]).toMatchObject({
      kind: "text",
      style: { accent: "#ff0000", font: "Georgia" },
    });
    // Without a film: the touch colour is the accent.
    expect(captionLook(edit).accent).toBe(edit.touch.color);
  });
});

describe("generated sound in the montage", () => {
  const bed = {
    id: "music-calm-1-6s",
    name: "Music (calm)",
    file: "music-calm-1-6s.wav",
    seconds: 6,
  };

  it("lays the bed from the start to the last word, ducked", () => {
    const r = withMusic(edit, bed, 4.75, "m");
    expect(r.clip).toMatchObject({
      id: "m",
      start: 0,
      duration: 5.05,
      duck: true,
      fadeIn: 0.4,
      fadeOut: 1.2,
    });
    expect(r.edit.assets.find((a) => a.id === bed.id)?.duration).toBe(6);
    // Without words: the end of the montage, never past the file.
    expect(withMusic(edit, bed, null, "m").clip.duration).toBe(6);
    expect(
      withMusic(edit, { ...bed, seconds: 3 }, null, "m").clip.duration,
    ).toBe(3);
    // Rendered twice: one asset record.
    const twice = withMusic(r.edit, bed, null, "m2");
    expect(twice.edit.assets.filter((a) => a.id === bed.id)).toHaveLength(1);
    expect(twice.clip.lane).not.toBe(r.clip.lane);
  });

  it("counts the effects of the film", () => {
    const pop = {
      id: "sfx-pop",
      name: "SFX pop",
      file: "sfx-pop.wav",
      seconds: 0.09,
    };
    let e = edit;
    let count = 0;
    for (let i = 0; i < 5; i += 1) {
      const r = withSfx(e, pop, "pop", i, `s${i}`);
      e = r.edit;
      count = r.count;
    }
    expect(count).toBe(5);
    expect(e.audio[0]).toMatchObject({ start: 0, duration: 0.09, duck: false });
    expect(e.assets.filter((a) => a.id === "sfx-pop")).toHaveLength(1);
  });
});
