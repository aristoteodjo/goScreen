import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT, fullClip } from "./schema";
import type { EditState, TextOverlay } from "./types";
import {
  describeDiff,
  diffEdits,
  type EditVersionMeta,
  isEmptyDiff,
  pruneHistory,
} from "./versions";

const text = (id: string, text: string, start = 1): TextOverlay => ({
  id,
  kind: "text",
  lane: 0,
  start,
  duration: 2,
  x: 0.5,
  y: 0.5,
  width: 0.5,
  height: 0.2,
  rotation: 0,
  opacity: 1,
  enter: "fade",
  exit: "fade",
  motion: 0.4,
  text,
  style: {
    font: "Inter",
    size: 0.06,
    weight: 700,
    color: "#ffffff",
    align: "center",
    background: null,
  },
  animator: null,
});

const base: EditState = {
  ...DEFAULT_EDIT,
  clips: [fullClip("clip-1", 0, 10)],
  overlays: [text("t1", "Hello")],
  zooms: [{ id: "z1", start: 1, end: 3, scale: 2, focus: null }],
};

describe("diffEdits", () => {
  it("finds nothing between identical edits", () => {
    const d = diffEdits(base, structuredClone(base));
    expect(isEmptyDiff(d)).toBe(true);
    expect(describeDiff(d)).toBe("No changes.");
  });

  it("lists items added, removed and changed by id, with their fields", () => {
    const next: EditState = {
      ...base,
      clips: [
        { ...base.clips[0], out: 8, speed: 1.5 } as (typeof base.clips)[0],
        {
          id: "intro",
          kind: "slide",
          transition: null,
          duration: 3,
          background: { kind: "color", value: "#000000" },
          title: "A very long title that will be shortened",
          subtitle: "",
          color: "#ffffff",
          font: "Inter",
          animation: "fade",
        },
      ],
      overlays: [text("t2", "World", 4)],
      zooms: [],
      touch: { ...base.touch, style: "ripple" },
      background: { kind: "color", value: "#101010" },
    };
    const d = diffEdits(base, next);
    expect(d.clips.added.map((a) => a.id)).toEqual(["intro"]);
    expect(d.clips.added[0].label).toContain("card");
    expect(d.clips.changed).toEqual([
      { id: "clip-1", label: "clip 0–8s", fields: ["out", "speed"] },
    ]);
    expect(d.overlays.added[0]).toEqual({ id: "t2", label: 'text "World"' });
    expect(d.overlays.removed[0].id).toBe("t1");
    expect(d.zooms.removed[0].id).toBe("z1");
    expect(d.settings).toEqual([
      { field: "background.angle", from: 160, to: undefined },
      { field: "background.from", from: "#1e2a78", to: undefined },
      { field: "background.kind", from: "gradient", to: "color" },
      { field: "background.to", from: "#ff6f91", to: undefined },
      { field: "background.value", from: undefined, to: "#101010" },
      { field: "touch.style", from: "ring", to: "ripple" },
    ]);
    const summary = describeDiff(d);
    expect(summary).toContain(
      'clips: +1: intro (card "A very long title that …")',
    );
    expect(summary).toContain("~1: clip-1 (clip 0–8s) [out, speed]");
    expect(summary).toContain('touch.style: "ring" -> "ripple"');
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  it("compares device layers by instance id and a removed film as a setting", () => {
    const a: EditState = {
      ...base,
      layers: [
        {
          instanceId: "d1",
          deviceId: "iphone",
          colorId: "black",
          frame: true,
          x: 0.5,
          y: 0.5,
          scale: 0.8,
          rotation: 0,
          hidden: false,
        },
      ],
      film: { settings: { format: "9:16" }, locale: "fr" },
    };
    const b: EditState = {
      ...a,
      layers: [{ ...(a.layers ?? [])[0], scale: 0.6 }],
      film: undefined,
    };
    const d = diffEdits(a, b);
    expect(d.layers.changed).toEqual([
      { id: "d1", label: "device iphone", fields: ["scale"] },
    ]);
    expect(d.settings).toEqual([
      {
        field: "film",
        from: { settings: { format: "9:16" }, locale: "fr" },
        to: undefined,
      },
    ]);
  });
});

const at = (minutesAgo: number, now: number) =>
  new Date(now - minutesAgo * 60_000).toISOString();

const version = (
  id: string,
  minutesAgo: number,
  now: number,
  extra: Partial<EditVersionMeta> = {},
): EditVersionMeta => ({
  id,
  at: at(minutesAgo, now),
  author: "person",
  ...extra,
});

describe("pruneHistory", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");

  it("keeps explicit and AI versions, recent autosaves, and one old autosave per bucket", () => {
    const versions = [
      version("old-a", 200, now),
      version("old-b", 199, now),
      version("old-c", 198, now),
      version("ai", 150, now, { author: "ai", command: "edit.setFilm" }),
      version("saved", 140, now, { command: "save", message: "Final" }),
      version("far", 130, now),
      version("recent-a", 30, now),
      version("recent-b", 2, now),
    ];
    const { keep, drop } = pruneHistory(versions, now);
    expect(drop.map((v) => v.id)).toEqual(["old-a", "old-b"]);
    expect(keep.map((v) => v.id)).toEqual([
      "old-c",
      "ai",
      "saved",
      "far",
      "recent-a",
      "recent-b",
    ]);
  });

  it("never exceeds the limit and never drops the newest version", () => {
    const versions = Array.from({ length: 30 }, (_, i) =>
      version(`v${i}`, 30 - i, now, i % 2 ? { command: "save" } : {}),
    );
    const { keep } = pruneHistory(versions, now, { limit: 10 });
    expect(keep.length).toBe(10);
    expect(keep[keep.length - 1].id).toBe("v29");
    // Autosaves went first; the explicit ones that remain are the newest.
    expect(keep.filter((v) => !v.command).length).toBeLessThanOrEqual(1);
  });

  it("keeps an old autosave when it is the only version", () => {
    const only = [version("v", 500, now)];
    expect(pruneHistory(only, now).keep).toEqual(only);
  });
});
