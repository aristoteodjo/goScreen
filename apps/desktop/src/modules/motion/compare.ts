import { create } from "zustand";

// One clock for the reference and its rendering, side by side: the
// reference leads, the rendering follows it. Shots and the strip seek here.

type Compare = {
  time: number;
  playing: boolean;
};

export const useCompare = create<Compare>(() => ({ time: 0, playing: false }));

const videos = new Set<HTMLVideoElement>();
let leader: HTMLVideoElement | null = null;
let frame = 0;

/** Followers further than this from the leader jump to it. */
const MAX_DRIFT = 0.08;

function tick() {
  frame = 0;
  if (!leader) return;
  const t = leader.currentTime;
  for (const v of videos) {
    if (v !== leader && Math.abs(v.currentTime - t) > MAX_DRIFT && !v.seeking) v.currentTime = t;
  }
  useCompare.setState({ time: t, playing: !leader.paused });
  if (!leader.paused) frame = requestAnimationFrame(tick);
}

export function register(video: HTMLVideoElement, lead: boolean) {
  videos.add(video);
  if (lead) leader = video;
  video.currentTime = useCompare.getState().time;
  return () => {
    videos.delete(video);
    if (leader === video) leader = null;
  };
}

export function seek(t: number) {
  for (const v of videos) v.currentTime = Math.max(0, t);
  useCompare.setState({ time: Math.max(0, t) });
}

export function togglePlay() {
  const playing = !useCompare.getState().playing;
  for (const v of videos) {
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }
  useCompare.setState({ playing });
  if (playing && !frame) frame = requestAnimationFrame(tick);
  if (!playing && leader) seek(leader.currentTime);
}

/** The leader reached its end, or was paused by the system. */
export function stopped() {
  for (const v of videos) v.pause();
  useCompare.setState({ playing: false });
}
