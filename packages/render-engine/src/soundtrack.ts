import { recordingSpans } from "./sequence";
import type { AudioClip, EditState } from "./types";

export type AudioSource = { kind: "mic" } | { kind: "asset"; file: string };

/** An audio clip whose asset is this id plays the take's own microphone (detached voice). */
export const MIC_ASSET = "mic";

/** A point of a gain curve: `at` seconds from the piece's start, linear gain. */
export type DuckPoint = { at: number; gain: number };

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
  // Gain lowered under the voice, piecewise linear from the piece's start
  // (timeline seconds, after any speed change). Absent: nothing to duck.
  duck?: DuckPoint[];
};

/** Ducking as the guides set it: -20 dB under speech, 80 ms down, 600 ms back. */
export const DUCK = { depthDb: -20, attack: 0.08, release: 0.6 };
export type DuckOptions = typeof DUCK;

/** Default fades of a generated bed: in 0.4 s, out 1.2 s. */
export const MUSIC_FADE = { in: 0.4, out: 1.2 };

/** Volume that puts a bed rendered at -17 LUFS about 11 dB under a -16 LUFS voice. */
export const MUSIC_VOLUME = 0.28;

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Sorted ranges with overlaps joined; `slack` joins ranges closer than that. */
export function mergeRanges(
  ranges: [number, number][],
  slack = 0,
): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...ranges]
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + slack) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * The gain curve that keeps music under a voice: down to `depthDb` over
 * `attack` seconds before each spoken range, back to 1 over `release`
 * after it. Timeline seconds; linear between points. Two ranges closer
 * than attack + release stay ducked between them.
 */
export function duckEnvelope(
  voiceRanges: [number, number][],
  o: DuckOptions = DUCK,
): { t: number; gain: number }[] {
  const depth = 10 ** (o.depthDb / 20);
  const ranges = mergeRanges(voiceRanges, o.attack + o.release);
  const out: { t: number; gain: number }[] = [];
  for (const [a, b] of ranges) {
    const down = Math.max(0, a - o.attack);
    if (out.length === 0 && down > 0) out.push({ t: 0, gain: 1 });
    if (down > 0 || out.length === 0) out.push({ t: round(down), gain: 1 });
    out.push({ t: round(Math.max(down, a)), gain: depth });
    out.push({ t: round(b), gain: depth });
    out.push({ t: round(b + o.release), gain: 1 });
  }
  return out;
}

/** Linear interpolation of a gain curve at timeline time t (1 outside it). */
export function duckGainAt(
  curve: { t: number; gain: number }[],
  t: number,
): number {
  if (curve.length === 0) return 1;
  if (t <= curve[0].t) return curve[0].gain;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1];
    const b = curve[i];
    if (t <= b.t) {
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return a.gain + (b.gain - a.gain) * k;
    }
  }
  return curve[curve.length - 1].gain;
}

/**
 * The part of a gain curve a piece hears, from its own start: its gain at
 * 0, the curve's points inside it, its gain at the end. Null when the
 * piece is never ducked.
 */
export function duckFor(
  curve: { t: number; gain: number }[],
  at: number,
  duration: number,
): DuckPoint[] | null {
  if (duration <= 0) return null;
  const points: DuckPoint[] = [{ at: 0, gain: duckGainAt(curve, at) }];
  for (const p of curve)
    if (p.t > at && p.t < at + duration)
      points.push({ at: round(p.t - at), gain: p.gain });
  points.push({ at: round(duration), gain: duckGainAt(curve, at + duration) });
  return points.every((p) => p.gain > 0.999) ? null : points;
}

/** A voice-over take or the detached mic: what leads, never what is ducked. */
export function isVoiceClip(edit: EditState, clip: AudioClip): boolean {
  if (clip.asset === MIC_ASSET) return true;
  const name = edit.assets.find((a) => a.id === clip.asset)?.name ?? "";
  return name.startsWith("Voice-over");
}

/** Whether a clip is lowered under the voice: its own switch, else "not a voice". */
export function ducks(edit: EditState, clip: AudioClip): boolean {
  return clip.duck ?? !isVoiceClip(edit, clip);
}

/**
 * Timeline stretches where a voice may speak: the mic under each recording
 * clip, and every voice clip. Coarse (clip spans); the shell refines them
 * with the sounding ranges FFmpeg finds when it can.
 */
export function voiceSpans(edit: EditState, hasMic: boolean): [number, number][] {
  const out: [number, number][] = [];
  const { muted, micMuted } = edit.tracks;
  if (hasMic && edit.mic.volume > 0 && !micMuted)
    for (const { clip, start } of recordingSpans(edit.clips))
      if (!clip.muted)
        out.push([start, start + (clip.out - clip.in) / Math.max(0.01, clip.speed)]);
  for (const a of edit.audio) {
    if (a.volume <= 0 || muted.includes(a.lane) || !isVoiceClip(edit, a)) continue;
    if (a.asset === MIC_ASSET && !hasMic) continue;
    out.push([a.start, a.start + a.duration]);
  }
  return mergeRanges(out);
}

/**
 * Every sound of the edit: the mic under each recording clip, music, and
 * video overlays. With `voice` (timeline ranges where someone speaks),
 * sounds that duck carry their gain curve.
 */
export function audioPieces(
  edit: EditState,
  hasMic: boolean,
  voice: [number, number][] = [],
): AudioPiece[] {
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
  const curve = voice.length ? duckEnvelope(voice) : [];
  const fileOf = (id: string) => edit.assets.find((a) => a.id === id)?.file;
  for (const a of edit.audio) {
    if (a.volume <= 0 || muted.includes(a.lane)) continue;
    const mic = a.asset === MIC_ASSET;
    const file = mic ? null : fileOf(a.asset);
    if (mic ? !hasMic : !file) continue;
    const piece: AudioPiece = {
      // Detached voice: `in` is source time, like the mic under a clip.
      source: mic ? { kind: "mic" } : { kind: "asset", file: file as string },
      from: a.in,
      duration: a.duration,
      at: a.start,
      speed: 1,
      volume: a.volume,
      fadeIn: a.fadeIn,
      fadeOut: a.fadeOut,
    };
    if (curve.length && ducks(edit, a)) {
      const duck = duckFor(curve, a.start, a.duration);
      if (duck) piece.duck = duck;
    }
    out.push(piece);
  }
  for (const o of edit.overlays) {
    if (
      o.kind !== "video" ||
      o.volume <= 0 ||
      edit.tracks.hidden.includes(o.lane)
    )
      continue;
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
