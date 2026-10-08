import { type RecordedLayer, type RecordedPointer, type Size, type Timeline, timelineOf } from "@goscreen/render-engine";
import { create } from "zustand";
import { geometryOf } from "./devices";
import { trimEnd, useEdit, usePlayback } from "./store";

type Opened = {
  videoPath: string;
  name: string;
  videoUrl: string;
  cameraUrl: string | null;
  micUrl: string | null;
  pointers: RecordedPointer[];
  layers: RecordedLayer[];
  // Camera/mic start, in seconds after the first screen frame.
  mediaOffset: number;
};

// The opened recording. Runtime only: the source of truth is on disk.
type SessionStore = Opened & {
  source: Size | null;
  video: HTMLVideoElement | null;
  camera: HTMLVideoElement | null;
  mic: HTMLAudioElement | null;
  open: (s: Opened) => void;
  setVideo: (video: HTMLVideoElement | null) => void;
  setCamera: (camera: HTMLVideoElement | null) => void;
  setMic: (mic: HTMLAudioElement | null) => void;
  setSource: (source: Size) => void;
};

export const useSession = create<SessionStore>((set) => ({
  videoPath: "",
  name: "",
  videoUrl: "",
  cameraUrl: null,
  micUrl: null,
  pointers: [],
  layers: [],
  mediaOffset: 0,
  source: null,
  video: null,
  camera: null,
  mic: null,
  open: (s) => set({ ...s, source: null }),
  setVideo: (video) => set({ video }),
  setCamera: (camera) => set({ camera }),
  setMic: (mic) => set({ mic }),
  setSource: (source) => set({ source }),
}));

let cachedTimeline: { key: unknown[]; value: Timeline } | null = null;

export function currentTimeline(): Timeline | null {
  const { source, pointers, layers, cameraUrl } = useSession.getState();
  if (!source) return null;
  const key = [source, pointers, layers, cameraUrl];
  if (!cachedTimeline || key.some((k, i) => cachedTimeline?.key[i] !== k)) {
    cachedTimeline = {
      key,
      value: timelineOf(source, pointers, { layers, hasCamera: cameraUrl !== null, geometry: geometryOf }),
    };
  }
  return cachedTimeline.value;
}

// One painter at a time (the preview canvas); playback and edits ask it to repaint.
let painter: (() => void) | null = null;
let queued = false;

export function setPainter(fn: (() => void) | null) {
  painter = fn;
}

export function requestPaint() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    painter?.();
  });
}

/** Companion media (camera, mic) follow the screen video with their offset. */
function companions(): HTMLMediaElement[] {
  const { camera, mic } = useSession.getState();
  return [camera, mic].filter((m): m is HTMLVideoElement | HTMLAudioElement => m !== null);
}

function syncCompanions(t: number, playing: boolean) {
  const offset = useSession.getState().mediaOffset;
  for (const m of companions()) {
    const local = t - offset;
    if (local < 0 || (Number.isFinite(m.duration) && local > m.duration)) {
      if (!m.paused) m.pause();
      continue;
    }
    // Small drift is left alone: seeking a playing element stutters.
    if (!playing || Math.abs(m.currentTime - local) > 0.15) m.currentTime = local;
    if (playing && m.paused) void m.play().catch(() => {});
    if (!playing && !m.paused) m.pause();
  }
}

let loop = 0;

function tick() {
  const video = useSession.getState().video;
  const { duration, setTime, setPlaying } = usePlayback.getState();
  if (!video) return;
  const end = trimEnd(useEdit.getState().edit, duration);
  if (video.currentTime >= end - 0.01 || video.ended) {
    video.pause();
    video.currentTime = end;
    setTime(end);
    setPlaying(false);
    syncCompanions(end, false);
    painter?.();
    return;
  }
  setTime(video.currentTime);
  syncCompanions(video.currentTime, true);
  painter?.();
  loop = requestAnimationFrame(tick);
}

export const player = {
  play() {
    const video = useSession.getState().video;
    if (!video) return;
    const { duration } = usePlayback.getState();
    const { trim } = useEdit.getState().edit;
    const end = trimEnd(useEdit.getState().edit, duration);
    if (video.currentTime >= end - 0.05 || video.currentTime < trim.start) video.currentTime = trim.start;
    usePlayback.getState().setPlaying(true);
    void video.play().catch(() => usePlayback.getState().setPlaying(false));
    cancelAnimationFrame(loop);
    loop = requestAnimationFrame(tick);
  },
  pause() {
    useSession.getState().video?.pause();
    cancelAnimationFrame(loop);
    usePlayback.getState().setPlaying(false);
    syncCompanions(usePlayback.getState().time, false);
  },
  toggle() {
    if (usePlayback.getState().playing) player.pause();
    else player.play();
  },
  seek(t: number) {
    const video = useSession.getState().video;
    const { duration } = usePlayback.getState();
    const clamped = Math.max(0, Math.min(duration, t));
    usePlayback.getState().setTime(clamped);
    if (video) video.currentTime = clamped;
    syncCompanions(clamped, usePlayback.getState().playing);
    requestPaint();
  },
  step(dt: number) {
    player.seek(usePlayback.getState().time + dt);
  },
  first() {
    player.seek(useEdit.getState().edit.trim.start);
  },
  last() {
    player.seek(trimEnd(useEdit.getState().edit, usePlayback.getState().duration));
  },
};
