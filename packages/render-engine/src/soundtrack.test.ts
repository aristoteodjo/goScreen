import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "./schema";
import { audioPieces, MIC_ASSET } from "./soundtrack";
import type { AudioClip, EditState } from "./types";

const voice: AudioClip = { id: "v", lane: 0, start: 2, duration: 3, asset: MIC_ASSET, in: 5, volume: 0.8, fadeIn: 0, fadeOut: 0.5 };

describe("detached voice", () => {
  const edit: EditState = { ...DEFAULT_EDIT, audio: [voice], tracks: { hidden: [], muted: [], micMuted: true } };

  it("plays the take's mic from its own place, not the attached one", () => {
    const pieces = audioPieces(edit, true);
    expect(pieces).toEqual([
      { source: { kind: "mic" }, from: 5, duration: 3, at: 2, speed: 1, volume: 0.8, fadeIn: 0, fadeOut: 0.5 },
    ]);
  });

  it("is silent when the take has no mic or its lane is muted", () => {
    expect(audioPieces(edit, false)).toEqual([]);
    expect(audioPieces({ ...edit, tracks: { ...edit.tracks, muted: [0] } }, true)).toEqual([]);
  });
});
