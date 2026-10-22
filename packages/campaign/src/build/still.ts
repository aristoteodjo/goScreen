import { type EditState, sequenceDuration } from "@goscreen/render-engine";

/** A stretch of the timeline where nothing visibly changes. */
export interface Still {
  from: number;
  to: number;
}

const timelineOf = (edit: EditState) => {
  let at = 0;
  const clips = edit.clips.map((clip) => {
    const length =
      clip.kind === "slide"
        ? clip.duration
        : Math.max(0, clip.out - clip.in) / clip.speed;
    const row = { clip, at, length };
    at += length;
    return row;
  });
  return clips;
};

const timelineTime = (
  rows: ReturnType<typeof timelineOf>,
  source: number,
): number | null => {
  for (const { clip, at, length } of rows) {
    if (clip.kind !== "recording") continue;
    const out = clip.in + length * clip.speed;
    if (source >= clip.in && source <= out)
      return at + (source - clip.in) / clip.speed;
  }
  return null;
};

/**
 * The longest stretch of a montage without a visible change: no clip
 * boundary, no card animation, no layer entering or leaving, no keyframe,
 * no zoom starting or ending. A rendered block or composition layer moves
 * for its whole length (it is an animation), and so does a zoom (the camera
 * drifts on its plateau): both cover their own stretch.
 * Pure: the dynamic look's "nothing still for 2 s" rule is checked on this.
 */
export function longestStill(edit: EditState): Still {
  const rows = timelineOf(edit);
  const duration = sequenceDuration(edit.clips);
  const events = new Set<number>([0, duration]);
  const covered: Still[] = [];
  for (const { clip, at, length } of rows) {
    events.add(at);
    if (clip.kind === "slide" && clip.animation !== "none")
      events.add(at + Math.min(0.6, length));
  }
  for (const o of edit.overlays) {
    events.add(o.start);
    events.add(o.start + o.duration);
    if (o.kind === "video" && o.source)
      covered.push({ from: o.start, to: o.start + o.duration });
    for (const keys of Object.values(o.keyframes ?? {}))
      for (const k of keys ?? []) events.add(o.start + k.t);
  }
  for (const z of edit.zooms) {
    const s = timelineTime(rows, z.start);
    const e = timelineTime(rows, z.end);
    if (s !== null) events.add(s);
    if (e !== null) events.add(e);
    // The camera keeps pushing (4 % drift) for the whole zoom: it moves.
    if (s !== null && e !== null) covered.push({ from: s, to: e });
  }
  const times = [...events]
    .filter((t) => t >= 0 && t <= duration + 1e-6)
    .sort((a, b) => a - b);
  let best: Still = { from: 0, to: 0 };
  for (let i = 1; i < times.length; i += 1) {
    const from = times[i - 1];
    const to = times[i];
    // Trim the parts a moving layer covers.
    let a = from;
    for (const c of covered.sort((x, y) => x.from - y.from))
      if (c.from <= a + 1e-6 && c.to > a) a = Math.min(c.to, to);
    if (to - a > best.to - best.from) best = { from: a, to };
  }
  return { from: Number(best.from.toFixed(3)), to: Number(best.to.toFixed(3)) };
}
