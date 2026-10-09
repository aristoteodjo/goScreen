import { describe, expect, it } from "vitest";
import {
  audioPieces,
  clampToSource,
  clipsWithout,
  clipAt,
  DEFAULT_EDIT,
  dropIndex,
  fullClip,
  type MainClip,
  moveClip,
  parseEditState,
  removeClip,
  SOURCE_END,
  sequenceDuration,
  setSpeed,
  type SlideClip,
  sourceTimeAt,
  splitAt,
  timelineTimesOf,
  trimClip,
} from "./index";

const slide = (id: string, duration: number): SlideClip => ({
  id,
  kind: "slide",
  duration,
  transition: null,
  background: DEFAULT_EDIT.background,
  title: "Hello",
  subtitle: "",
  color: "#ffffff",
  font: "Inter",
  animation: "words",
});

describe("sequence", () => {
  const clips: MainClip[] = [fullClip("a", 0, 4), slide("s", 2), { ...fullClip("b", 6, 10), speed: 2 }];

  it("plays clips back to back", () => {
    expect(sequenceDuration(clips)).toBe(8);
    expect(clipAt(clips, 4.5)?.clip.id).toBe("s");
    expect(clipAt(clips, 99)?.clip.id).toBe("b");
  });

  it("maps timeline time to source time, through speed", () => {
    expect(sourceTimeAt(clips, 1)).toBe(1);
    expect(sourceTimeAt(clips, 5)).toBeNull();
    expect(sourceTimeAt(clips, 7)).toBe(8);
    expect(timelineTimesOf(clips, 8)).toEqual([7]);
    expect(timelineTimesOf(clips, 5)).toEqual([]);
  });

  it("splits a clip under the playhead and keeps the source continuous", () => {
    const next = splitAt(clips, 7, "c");
    expect(next.map((c) => c.id)).toEqual(["a", "s", "b", "c"]);
    expect(next[2]).toMatchObject({ in: 6, out: 8 });
    expect(next[3]).toMatchObject({ in: 8, out: 10, speed: 2 });
    expect(sequenceDuration(next)).toBe(8);
    // Too close to an edge: nothing to split.
    expect(splitAt(clips, 4.05, "x")).toBe(clips);
  });

  it("splits slides by duration", () => {
    const next = splitAt(clips, 5, "s2");
    expect(next[1]).toMatchObject({ id: "s", duration: 1 });
    expect(next[2]).toMatchObject({ id: "s2", duration: 1, title: "Hello" });
  });

  it("removes with ripple, but never the last clip", () => {
    expect(sequenceDuration(removeClip(clips, "s"))).toBe(6);
    expect(removeClip([fullClip("a")], "a")).toHaveLength(1);
  });

  it("reorders clips and finds where a dragged clip lands", () => {
    expect(moveClip(clips, "b", 0).map((c) => c.id)).toEqual(["b", "a", "s"]);
    expect(dropIndex(clips, "a", 0.5)).toBe(0);
    // Without "a", the slide spans 0..2 and "b" 2..4.
    expect(dropIndex(clips, "a", 3.5)).toBe(2);
  });

  it("trims within the source and never below the minimum", () => {
    const longer = trimClip(clips, "b", "end", 5, 12);
    expect(longer[2]).toMatchObject({ out: 12 });
    const shorter = trimClip(clips, "a", "start", 10, 12);
    expect((shorter[0] as { in: number }).in).toBeCloseTo(3.8);
    expect(trimClip(clips, "a", "start", -3, 12)[0]).toMatchObject({ in: 0 });
    expect(trimClip(clips, "s", "end", 1, 12)[1]).toMatchObject({ duration: 3 });
  });

  it("changes speed and duration together", () => {
    expect(sequenceDuration(setSpeed(clips, "a", 2))).toBe(6);
  });

  it("clamps open-ended clips once the source duration is known", () => {
    const open = [fullClip("a")];
    expect(open[0].out).toBe(SOURCE_END);
    expect(clampToSource(open, 12)[0]).toMatchObject({ in: 0, out: 12 });
    const exact = [fullClip("a", 0, 5)];
    expect(clampToSource(exact, 12)).toBe(exact);
  });
});

describe("edit files", () => {
  it("upgrades a v1 trim into one clip", () => {
    const edit = parseEditState({ ...DEFAULT_EDIT, version: 1, clips: undefined, trim: { start: 2, end: 9 } });
    expect(edit?.version).toBe(2);
    expect(edit?.clips).toEqual([fullClip("clip-1", 2, 9)]);
    const open = parseEditState({ ...DEFAULT_EDIT, version: 1, clips: undefined, trim: { start: 1, end: null } });
    expect(open?.clips[0]).toMatchObject({ in: 1, out: SOURCE_END });
  });

  it("drops a broken overlay alone and media without an asset", () => {
    const edit = parseEditState({
      ...DEFAULT_EDIT,
      overlays: [
        { kind: "image", id: "i", asset: "gone", lane: 0, start: 0, duration: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
        { kind: "shape", id: "bad" },
        {
          kind: "shape",
          id: "arrow",
          shape: "arrow",
          color: "#ff0000",
          lane: 0,
          start: 1,
          duration: 2,
          x: 0.5,
          y: 0.5,
          width: 0.2,
          height: 0.1,
        },
      ],
    });
    expect(edit?.overlays.map((o) => o.id)).toEqual(["arrow"]);
    expect(edit?.overlays[0]).toMatchObject({ enter: "fade", motion: 0.4, opacity: 1 });
  });

  it("refuses asset files that are paths", () => {
    const edit = parseEditState({
      ...DEFAULT_EDIT,
      assets: [
        { id: "a", name: "x", kind: "image", file: "../secret.png", duration: null },
        { id: "b", name: "logo", kind: "image", file: "logo.png", duration: null },
      ],
    });
    expect(edit?.assets.map((a) => a.id)).toEqual(["b"]);
  });
});

describe("soundtrack", () => {
  it("cuts the mic along the clips and adds music", () => {
    const edit = {
      ...DEFAULT_EDIT,
      clips: [fullClip("a", 1, 3), { ...fullClip("b", 5, 9), speed: 2 }, { ...fullClip("c", 9, 10), muted: true }],
      assets: [{ id: "m", name: "song", kind: "audio" as const, file: "m.mp3", duration: 60 }],
      audio: [{ id: "x", lane: 0, start: 1, duration: 4, asset: "m", in: 10, volume: 0.5, fadeIn: 1, fadeOut: 1 }],
    };
    const pieces = audioPieces(edit, true);
    expect(pieces.filter((p) => p.source.kind === "mic").map((p) => [p.from, p.duration, p.at, p.speed])).toEqual([
      [1, 2, 0, 1],
      [5, 4, 2, 2],
    ]);
    expect(pieces.find((p) => p.source.kind === "asset")).toMatchObject({ from: 10, duration: 4, at: 1, volume: 0.5 });
    expect(audioPieces(edit, false).every((p) => p.source.kind === "asset")).toBe(true);
  });
});

describe("clipsWithout", () => {
  const id = (i: number) => `c${i}`;

  it("cuts the paused stretches out of the take", () => {
    const clips = clipsWithout([{ start: 4, end: 9 }, { start: 15, end: 16 }], id);
    expect(clips.map((c) => [c.in, c.out])).toEqual([
      [0, 4],
      [9, 15],
      [16, SOURCE_END],
    ]);
    expect(clips.map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
  });

  it("merges overlapping pauses and skips slivers", () => {
    const clips = clipsWithout([{ start: 3, end: 6 }, { start: 5, end: 8 }, { start: 8.1, end: 10 }, { start: 1, end: 1.01 }], id);
    expect(clips.map((c) => [c.in, c.out])).toEqual([
      [0, 3],
      [10, SOURCE_END],
    ]);
  });

  it("is one full clip without pauses, and starts later after a pause at 0", () => {
    expect(clipsWithout([], id).map((c) => [c.in, c.out])).toEqual([[0, SOURCE_END]]);
    expect(clipsWithout([{ start: 0, end: 2 }], id).map((c) => [c.in, c.out])).toEqual([[2, SOURCE_END]]);
  });
});
