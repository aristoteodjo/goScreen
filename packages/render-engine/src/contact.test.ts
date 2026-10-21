import { describe, expect, it } from "vitest";
import {
  contactSheet,
  DEFAULT_EDIT,
  type EditState,
  playingAt,
  type RecordingClip,
  type SlideClip,
  stillTimes,
} from "./index";

describe("stillTimes", () => {
  it("takes one every two seconds by default, inside the montage", () => {
    expect(stillTimes({ duration: 7 })).toEqual([0, 2, 4, 6]);
    expect(stillTimes({ duration: 7, from: 3, to: 20, every: 1 })).toEqual([
      3, 4, 5, 6, 7,
    ]);
  });
  it("keeps explicit times, sorted, clamped and unique", () => {
    expect(stillTimes({ duration: 10, times: [12, 3, 3, -1] })).toEqual([
      0, 3, 10,
    ]);
  });
  it("widens the step rather than exceed the cell limit", () => {
    const t = stillTimes({ duration: 600, every: 0.5, maxCells: 48 });
    expect(t.length).toBeLessThanOrEqual(48);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeCloseTo(600, 0);
  });
});

describe("contactSheet", () => {
  it("lays cells on a grid of N columns and bounds the width", () => {
    const sheet = contactSheet({
      times: [0, 2, 4, 6, 8],
      aspect: 16 / 9,
      columns: 4,
      width: 1600,
    });
    expect(sheet.width).toBe(1600);
    expect(sheet.cells).toHaveLength(5);
    expect(sheet.cells[4].x).toBe(sheet.cells[0].x);
    expect(sheet.cells[4].y).toBeGreaterThan(sheet.cells[3].y);
    expect(sheet.cells[1].x).toBeGreaterThan(sheet.cells[0].x);
    expect(sheet.frame.width / sheet.frame.height).toBeCloseTo(16 / 9, 1);
    expect(sheet.cells[0].labelY).toBe(sheet.cells[0].y + sheet.frame.height);
    expect(sheet.height).toBeGreaterThan(sheet.cells[4].labelY);
    expect(contactSheet({ times: [0], aspect: 1, width: 10 }).width).toBe(480);
    expect(contactSheet({ times: [0], aspect: 1, width: 99999 }).width).toBe(
      3200,
    );
    expect(contactSheet({ times: [0], aspect: 1, columns: 40 }).columns).toBe(8);
  });
});

describe("playingAt", () => {
  const card: SlideClip = {
    id: "intro",
    kind: "slide",
    duration: 2,
    transition: null,
    background: DEFAULT_EDIT.background,
    title: "Welcome",
    subtitle: "",
    color: "#fff",
    font: "Inter",
    animation: "fade",
  };
  const take: RecordingClip = {
    ...(DEFAULT_EDIT.clips[0] as RecordingClip),
    in: 0,
    out: 10,
  };
  const edit: EditState = { ...DEFAULT_EDIT, clips: [card, take] };
  it("names the card, the scene caption or the clip", () => {
    const chapters = [{ url: "u", start: 0, end: 10, caption: "Search" }];
    expect(playingAt(edit.clips, chapters, 1)).toBe("Welcome");
    expect(playingAt(edit.clips, chapters, 5)).toBe("Search");
    expect(playingAt(edit.clips, [], 5)).toBe("Clip 2");
    expect(playingAt([], [], 5)).toBe("");
  });
});
