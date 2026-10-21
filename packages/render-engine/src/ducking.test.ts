import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT, fullClip } from "./schema";
import {
  audioPieces,
  DUCK,
  duckEnvelope,
  duckFor,
  duckGainAt,
  ducks,
  isVoiceClip,
  MIC_ASSET,
  mergeRanges,
  voiceSpans,
} from "./soundtrack";
import type { AudioClip, EditState } from "./types";

const depth = 10 ** (DUCK.depthDb / 20);

const music: AudioClip = {
  id: "m",
  lane: 1,
  start: 0,
  duration: 10,
  asset: "bed",
  in: 0,
  volume: 0.3,
  fadeIn: 0.4,
  fadeOut: 1.2,
};
const voice: AudioClip = {
  id: "v",
  lane: 0,
  start: 2,
  duration: 3,
  asset: "vo",
  in: 0,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
};
const edit: EditState = {
  ...DEFAULT_EDIT,
  assets: [
    { id: "bed", name: "Music", kind: "audio", file: "bed.wav", duration: 10 },
    { id: "vo", name: "Voice-over", kind: "audio", file: "vo.m4a", duration: 3 },
  ],
  audio: [music, voice],
  tracks: { hidden: [], muted: [], micMuted: true },
};

describe("duckEnvelope", () => {
  it("goes down before speech and back up after it", () => {
    const curve = duckEnvelope([[2, 3]]);
    expect(curve).toEqual([
      { t: 0, gain: 1 },
      { t: 1.92, gain: 1 },
      { t: 2, gain: depth },
      { t: 3, gain: depth },
      { t: 3.6, gain: 1 },
    ]);
    expect(duckGainAt(curve, 1)).toBe(1);
    expect(duckGainAt(curve, 2.5)).toBeCloseTo(depth, 6);
    expect(duckGainAt(curve, 3.3)).toBeCloseTo((1 + depth) / 2, 6);
    expect(duckGainAt(curve, 9)).toBe(1);
    expect(duckGainAt([], 9)).toBe(1);
  });

  it("stays down between close phrases and starts down at zero", () => {
    const curve = duckEnvelope([
      [0, 1],
      [1.3, 2],
      [5, 6],
    ]);
    expect(curve[0]).toEqual({ t: 0, gain: 1 });
    expect(duckGainAt(curve, 1.15)).toBeCloseTo(depth, 6);
    expect(duckGainAt(curve, 4)).toBe(1);
    expect(mergeRanges([[3, 4], [1, 2], [1.5, 2.5]])).toEqual([
      [1, 2.5],
      [3, 4],
    ]);
  });

  it("slices the curve for a piece from its own start", () => {
    const curve = duckEnvelope([[2, 3]]);
    expect(duckFor(curve, 1, 3)).toEqual([
      { at: 0, gain: 1 },
      { at: 0.92, gain: 1 },
      { at: 1, gain: depth },
      { at: 2, gain: depth },
      { at: 2.6, gain: 1 },
      { at: 3, gain: 1 },
    ]);
    expect(duckFor(curve, 5, 3)).toBeNull();
    expect(duckFor(curve, 2.2, 0.5)?.[0].gain).toBeCloseTo(depth, 6);
  });
});

describe("who ducks", () => {
  it("lowers music under the voice, never the voice itself", () => {
    expect(isVoiceClip(edit, voice)).toBe(true);
    expect(isVoiceClip(edit, music)).toBe(false);
    expect(ducks(edit, music)).toBe(true);
    expect(ducks(edit, voice)).toBe(false);
    expect(ducks(edit, { ...music, duck: false })).toBe(false);
    expect(isVoiceClip(edit, { ...music, asset: MIC_ASSET })).toBe(true);
  });

  it("finds the voice spans and attaches the curve to the pieces", () => {
    expect(voiceSpans(edit, false)).toEqual([[2, 5]]);
    const pieces = audioPieces(edit, false, voiceSpans(edit, false));
    const bed = pieces.find((p) => p.source.kind === "asset" && p.source.file === "bed.wav");
    const vo = pieces.find((p) => p.source.kind === "asset" && p.source.file === "vo.m4a");
    expect(vo?.duck).toBeUndefined();
    expect(bed?.duck?.map((p) => p.at)).toEqual([0, 1.92, 2, 5, 5.6, 10]);
    // Without voice ranges nothing changes.
    expect(audioPieces(edit, false).every((p) => p.duck === undefined)).toBe(true);
  });

  it("counts the mic under the clips when the take has one", () => {
    const withMic: EditState = {
      ...edit,
      audio: [music],
      tracks: { hidden: [], muted: [], micMuted: false },
      clips: [{ ...fullClip("c", 1, 4), speed: 2 }],
    };
    expect(voiceSpans(withMic, true)).toEqual([[0, 1.5]]);
    expect(voiceSpans(withMic, false)).toEqual([]);
  });
});
