// Keeping a playing media element on the timeline. A seek restarts decoding
// from the previous keyframe, which freezes the picture and chops a voice; a
// small drift is caught up by playing a little faster or slower instead, and
// a seek aims where the timeline will be once the seek is done.
export const IN_SYNC = 0.04;
export const CATCH_UP = 1;
export const SETTLE_MS = 1000;
const MAX_NUDGE = 0.1;
const MAX_LEAD = 1.5;

export type FollowState = {
  playing: boolean;
  // Element time where the timeline is now.
  target: number;
  current: number;
  seeking: boolean;
  msSinceSeek: number;
  // Seconds the last seek of this element took to land.
  seekLatency: number;
  rate: number;
};

export type FollowMove = { seekTo: number | null; rate: number };

/** What to do to an element so it shows the timeline time. */
export function followMove(s: FollowState): FollowMove {
  const drift = s.target - s.current;
  if (!s.playing)
    return {
      seekTo: Math.abs(drift) > 0.001 ? s.target : null,
      rate: s.rate,
    };
  if (s.seeking || s.msSinceSeek < SETTLE_MS)
    return { seekTo: null, rate: s.rate };
  if (Math.abs(drift) <= IN_SYNC) return { seekTo: null, rate: s.rate };
  if (Math.abs(drift) <= CATCH_UP) {
    const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, drift / 2));
    return { seekTo: null, rate: s.rate * (1 + nudge) };
  }
  const lead = Math.min(MAX_LEAD, s.seekLatency) * s.rate;
  return { seekTo: s.target + lead, rate: s.rate };
}
