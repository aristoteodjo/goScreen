import {
  DEFAULT_EDIT,
  type EditState,
  type MainClip,
  type TextOverlay,
} from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";
import { qcMarkdown, qcReport } from "./qc";
import type { Word } from "./words";

const words: Word[] = [
  { text: "Voici", start: 1.0, end: 1.3, p: 0.9 },
  { text: "goScreen", start: 1.4, end: 1.9, p: 0.9 },
  { text: "zoom", start: 5.0, end: 5.3, p: 0.9 },
];

const clip = (id: string, inAt: number, outAt: number): MainClip => ({
  id,
  kind: "recording",
  in: inAt,
  out: outAt,
  speed: 1,
  muted: false,
  cameraHidden: false,
  transition: null,
});

const card = (id: string, title: string): MainClip => ({
  id,
  kind: "slide",
  duration: 2,
  background: { kind: "color", value: "#000000" },
  title,
  subtitle: "",
  color: "#ffffff",
  font: "Inter",
  animation: "fade",
  transition: null,
});

const text = (
  id: string,
  start: number,
  extra: Partial<TextOverlay> = {},
): TextOverlay => ({
  id,
  lane: 0,
  start,
  duration: 1,
  x: 0.5,
  y: 0.8,
  width: 0.4,
  height: 0.1,
  rotation: 0,
  opacity: 1,
  enter: "fade",
  exit: "fade",
  motion: 0.3,
  kind: "text",
  text: `Text ${id}`,
  style: {
    font: "Inter",
    size: 0.06,
    weight: 700,
    color: "#ffffff",
    align: "center",
    background: null,
  },
  ...extra,
});

// Clip A shows source 0.5..2 at timeline 0..1.5, clip B source 4.5..6 at 1.5..3.
const edit: EditState = {
  ...DEFAULT_EDIT,
  clips: [clip("a", 0.5, 2), clip("b", 4.5, 6)],
  overlays: [
    // "zoom" starts at source 5 = timeline 2.0; this one is 1 frame late.
    text("t1", 2.0 + 1 / 30, { syncWord: { word: "zoom", nth: 1 } }),
  ],
};

describe("qcReport", () => {
  it("passes a clean montage", () => {
    const report = qcReport(edit, words, { loop: true });
    expect(report.pass).toBe(true);
    expect(report.checks.map((c) => c.id)).toEqual([
      "sync",
      "face",
      "safe-zone",
      "mid-word",
      "loop",
      "frozen",
    ]);
    expect(report.stats).toEqual({
      durationSeconds: 3,
      clips: 2,
      words: 3,
      syncedEffects: 1,
      failed: 0,
    });
    expect(qcMarkdown(report)).toContain(
      "| pass | Effects land on their word |",
    );
  });

  it("fails an effect more than two frames from its word", () => {
    const late: EditState = {
      ...edit,
      overlays: [text("t1", 2.3, { syncWord: { word: "zoom", nth: 1 } })],
    };
    const check = qcReport(late, words).checks[0];
    expect(check.pass).toBe(false);
    expect(check.detail).toContain("+9 frames");
    const cut: EditState = {
      ...edit,
      overlays: [text("t1", 0, { syncWord: { word: "Voici", nth: 1 } })],
      clips: [clip("b", 4.5, 6)],
    };
    expect(qcReport(cut, words).checks[0].detail).toContain("was cut");
  });

  it("flags text over the face and outside the safe zone", () => {
    const over: EditState = {
      ...edit,
      overlays: [
        text("face", 0.2, { y: 0.4 }),
        text("edge", 0.2, { x: 0.05, width: 0.2 }),
      ],
    };
    const report = qcReport(over, words, {
      faceBoxes: [{ t: 1, u: 0.35, v: 0.2, w: 0.3, h: 0.4 }],
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.face.pass).toBe(false);
    expect(byId.face.detail).toContain("Text face");
    expect(byId["safe-zone"].pass).toBe(false);
    expect(byId["safe-zone"].detail).toContain("Text edge");
  });

  it("flags a cut inside a word and a frozen clip", () => {
    const bad: EditState = {
      ...edit,
      clips: [clip("a", 1.15, 2), clip("z", 3, 3.01)],
      overlays: [],
    };
    const byId = Object.fromEntries(
      qcReport(bad, words).checks.map((c) => [c.id, c]),
    );
    expect(byId["mid-word"].pass).toBe(false);
    expect(byId["mid-word"].detail).toContain("a at 1.15s");
    expect(byId.frozen.pass).toBe(false);
    expect(byId.frozen.detail).toBe("z");
  });

  it("judges the loop by the first and last cards", () => {
    const looped: EditState = {
      ...edit,
      clips: [card("i", "goScreen"), clip("a", 0.5, 2), card("o", "goScreen")],
      overlays: [],
    };
    expect(qcReport(looped, words).checks[4].pass).toBe(true);
    expect(qcReport(edit, words).checks[4].pass).toBe(false);
  });
});
