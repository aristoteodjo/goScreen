import type { AudioClip } from "@goscreen/render-engine";

/** One audio clip to play from timeline time t: when, from where in the file, how long, how loud. */
export type PlannedVoice = {
  clip: AudioClip;
  // Seconds from now until it sounds.
  lead: number;
  // Seconds into the clip it starts from (0 unless t is inside it).
  into: number;
  // Seconds into the file.
  offset: number;
  duration: number;
};

const MIN_LENGTH = 0.01;

/** The clips still to sound from timeline time t, in the order they come. */
export function planVoices(
  clips: AudioClip[],
  t: number,
  skip: (clip: AudioClip) => boolean,
): PlannedVoice[] {
  return clips
    .filter((clip) => !skip(clip) && clip.start + clip.duration > t)
    .map((clip) => {
      const into = Math.max(0, t - clip.start);
      return {
        clip,
        lead: Math.max(0, clip.start - t),
        into,
        offset: clip.in + into,
        duration: clip.duration - into,
      };
    })
    .filter((v) => v.duration > MIN_LENGTH)
    .sort((a, b) => a.lead - b.lead);
}

/** Starts a planned voice `late` seconds after planned (decoding took that long). */
export function delayed(v: PlannedVoice, late: number): PlannedVoice | null {
  const lead = v.lead - late;
  if (lead >= 0) return { ...v, lead };
  const skipped = -lead;
  const duration = v.duration - skipped;
  if (duration <= MIN_LENGTH) return null;
  return {
    ...v,
    lead: 0,
    into: v.into + skipped,
    offset: v.offset + skipped,
    duration,
  };
}

/** Gain at time x into a clip: its volume, faded in and out as the export does. */
export function gainAt(clip: AudioClip, x: number): number {
  const volume = Math.min(2, Math.max(0, clip.volume));
  const fadeIn = clip.fadeIn > 0 ? Math.min(1, x / clip.fadeIn) : 1;
  const fadeOut =
    clip.fadeOut > 0 ? Math.min(1, (clip.duration - x) / clip.fadeOut) : 1;
  return volume * Math.max(0, Math.min(fadeIn, fadeOut));
}

/** Points of the gain curve from x to the clip's end, as (seconds from x, gain). */
export function envelope(
  clip: AudioClip,
  from: number,
): { at: number; gain: number }[] {
  const marks = [
    from,
    clip.fadeIn,
    clip.duration - clip.fadeOut,
    clip.duration,
  ].filter((x) => x >= from && x <= clip.duration);
  return [...new Set(marks)]
    .sort((a, b) => a - b)
    .map((x) => ({ at: x - from, gain: gainAt(clip, x) }));
}
