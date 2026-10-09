import { recordingSpans } from "./sequence";
import type { EditState } from "./types";

export type AudioSource = { kind: "mic" } | { kind: "asset"; file: string };

// One stretch of sound on the exported timeline. `from` and `duration` are
// in the file's own time (source time for the mic); `at` is timeline time.
export type AudioPiece = {
  source: AudioSource;
  from: number;
  duration: number;
  at: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
};

/** Every sound of the edit: the mic under each recording clip, music, and video overlays. */
export function audioPieces(edit: EditState, hasMic: boolean): AudioPiece[] {
  const out: AudioPiece[] = [];
  const { muted, micMuted } = edit.tracks;
  if (hasMic && edit.mic.volume > 0 && !micMuted) {
    for (const { clip, start } of recordingSpans(edit.clips)) {
      if (clip.muted) continue;
      out.push({
        source: { kind: "mic" },
        from: clip.in,
        duration: clip.out - clip.in,
        at: start,
        speed: clip.speed,
        volume: edit.mic.volume,
        fadeIn: 0,
        fadeOut: 0,
      });
    }
  }
  const fileOf = (id: string) => edit.assets.find((a) => a.id === id)?.file;
  for (const a of edit.audio) {
    const file = fileOf(a.asset);
    if (!file || a.volume <= 0 || muted.includes(a.lane)) continue;
    out.push({
      source: { kind: "asset", file },
      from: a.in,
      duration: a.duration,
      at: a.start,
      speed: 1,
      volume: a.volume,
      fadeIn: a.fadeIn,
      fadeOut: a.fadeOut,
    });
  }
  for (const o of edit.overlays) {
    if (o.kind !== "video" || o.volume <= 0 || edit.tracks.hidden.includes(o.lane)) continue;
    const file = fileOf(o.asset);
    if (!file) continue;
    out.push({
      source: { kind: "asset", file },
      from: o.in,
      duration: o.duration,
      at: o.start,
      speed: 1,
      volume: o.volume,
      fadeIn: 0,
      fadeOut: 0,
    });
  }
  return out;
}
