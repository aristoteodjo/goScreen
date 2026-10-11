// A playing element is pulled back to the timeline only when it is well off and
// settled: each seek restarts its decoding, and seeking again before it plays
// again chops a voice into pieces nobody can follow.
export const DRIFT = 0.3;
export const SETTLE_MS = 1000;

export type FollowState = {
  playing: boolean;
  drift: number;
  seeking: boolean;
  msSinceSeek: number;
};

/** Whether a media element should jump to the timeline time now. */
export function shouldSeek(s: FollowState): boolean {
  if (!s.playing) return s.drift > 0.001;
  if (s.seeking || s.msSinceSeek < SETTLE_MS) return false;
  return s.drift > DRIFT;
}
