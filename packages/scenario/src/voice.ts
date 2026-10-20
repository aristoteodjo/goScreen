// The voice leads the cut, as in the course: a scene lasts until the next
// phrase starts, so every scene change lands on the attack of a sentence
// and no scene opens on silence. Pure: the phrases come from a silence
// detection the shell runs, the montage is rewritten here.

import {
  type EditState,
  type MainClip,
  type Overlay,
  placeClips,
  type RecordingClip,
  SOURCE_END,
} from "@goscreen/render-engine";

export type Phrase = { start: number; end: number };

/**
 * Phrases from the sounding stretches of a voice clip, in timeline seconds:
 * stretches closer than `gap` belong to the same sentence.
 */
export function phrasesOf(
  ranges: [number, number][],
  clip: { start: number; in: number },
  gap = 0.35,
): Phrase[] {
  const out: Phrase[] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const start = clip.start + (a - clip.in);
    const end = clip.start + (b - clip.in);
    const last = out[out.length - 1];
    if (last && start - last.end <= gap) last.end = Math.max(last.end, end);
    else out.push({ start, end });
  }
  return out;
}

/** Slowest a scene is played to fill a long phrase. */
const MIN_SPEED = 0.6;
/** Shortest a scene may become. */
const MIN_SCENE = 0.4;

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Gives each recording scene the length of its phrase: scene i runs from
 * phrase i's attack to phrase i+1's attack (the last one to the end of its
 * phrase plus a beat). A scene with less source than that slows down (never
 * below MIN_SPEED); a scene with more is cut. Cards keep their length and
 * the voice is expected to start after an opening card. Texts that span a
 * scene (its caption, its kicker) follow it. Extra phrases or scenes are
 * left alone.
 */
export function alignScenesToVoice(
  edit: EditState,
  phrases: Phrase[],
  sourceEnd: number = SOURCE_END,
  tail = 0.6,
): EditState {
  if (phrases.length === 0) return edit;
  const placed = placeClips(edit.clips);
  const scenes = placed.filter(
    (p): p is typeof p & { clip: RecordingClip } => p.clip.kind === "recording",
  );
  if (scenes.length === 0) return edit;

  // Target timeline length of each scene.
  const targets = new Map<string, number>();
  scenes.forEach((s, i) => {
    const phrase = phrases[i];
    if (!phrase) return;
    const next = phrases[i + 1];
    const length = next ? next.start - phrase.start : phrase.end - phrase.start + tail;
    targets.set(s.clip.id, Math.max(MIN_SCENE, length));
  });

  const clips: MainClip[] = edit.clips.map((c, i) => {
    if (c.kind !== "recording") return c;
    const target = targets.get(c.id);
    if (target === undefined) return c;
    // Source available to this scene: up to the next recording clip's in.
    const after = edit.clips
      .slice(i + 1)
      .find((n): n is RecordingClip => n.kind === "recording");
    const limit = after && after.in > c.in ? after.in : sourceEnd;
    const available = Math.max(MIN_SCENE, limit - c.in);
    if (target <= available)
      return { ...c, out: round(c.in + target), speed: 1 };
    const speed = Math.max(MIN_SPEED, available / target);
    return { ...c, out: round(c.in + available), speed: round(speed) };
  });

  // Texts that covered a scene move and stretch with it.
  const before = placeClips(edit.clips);
  const now = placeClips(clips);
  const overlays: Overlay[] = edit.overlays.map((o) => {
    const i = before.findIndex(
      (p) =>
        p.clip.kind === "recording" &&
        Math.abs(p.start - o.start) < 0.05 &&
        Math.abs(p.end - p.start - o.duration) < 0.05,
    );
    if (i < 0) return o;
    return {
      ...o,
      start: round(now[i].start),
      duration: round(Math.max(0.1, now[i].end - now[i].start)),
    };
  });
  return { ...edit, clips, overlays };
}
