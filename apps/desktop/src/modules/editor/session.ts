import {
  type Chapter,
  clipAt,
  type EditState,
  MIC_ASSET,
  type RecordedLayer,
  type RecordedPointer,
  type Size,
  type Timeline,
  timelineOf,
} from "@goscreen/render-engine";
import { create } from "zustand";
import { geometryOf } from "./devices";
import { followMove } from "./drift";
import { pooledEntries } from "./media";
import { timelineEnd, useEdit, usePlayback } from "./store";
import { startVoices, stopVoices } from "./voices";

type Opened = {
  videoPath: string;
  name: string;
  // null: a montage without a recording (cards and layers only).
  videoUrl: string | null;
  cameraUrl: string | null;
  micUrl: string | null;
  pointers: RecordedPointer[];
  layers: RecordedLayer[];
  // Site tour pages, in source seconds (empty for other takes).
  chapters: Chapter[];
  // Camera/mic start, in seconds after the first screen frame.
  mediaOffset: number;
  // Imported asset file name -> local media URL.
  assetUrls: Record<string, string>;
};

// The opened recording. Runtime only: the source of truth is on disk.
type SessionStore = Opened & {
  source: Size | null;
  video: HTMLVideoElement | null;
  camera: HTMLVideoElement | null;
  mic: HTMLAudioElement | null;
  // `source` is given up front for a montage without a recording.
  open: (s: Opened, source?: Size) => void;
  setVideo: (video: HTMLVideoElement | null) => void;
  setCamera: (camera: HTMLVideoElement | null) => void;
  setMic: (mic: HTMLAudioElement | null) => void;
  setSource: (source: Size) => void;
  addAssetUrl: (file: string, url: string) => void;
};

export const useSession = create<SessionStore>((set) => ({
  videoPath: "",
  name: "",
  videoUrl: null,
  cameraUrl: null,
  micUrl: null,
  pointers: [],
  layers: [],
  chapters: [],
  mediaOffset: 0,
  assetUrls: {},
  source: null,
  video: null,
  camera: null,
  mic: null,
  open: (s, source = undefined) => set({ ...s, source: source ?? null }),
  setVideo: (video) => set({ video }),
  setCamera: (camera) => set({ camera }),
  setMic: (mic) => set({ mic }),
  setSource: (source) => set({ source }),
  addAssetUrl: (file, url) =>
    set((s) => ({ assetUrls: { ...s.assetUrls, [file]: url } })),
}));

let cachedTimeline: { key: unknown[]; value: Timeline } | null = null;

export function currentTimeline(): Timeline | null {
  const { source, pointers, layers, cameraUrl } = useSession.getState();
  if (!source) return null;
  const key = [source, pointers, layers, cameraUrl];
  if (!cachedTimeline || key.some((k, i) => cachedTimeline?.key[i] !== k)) {
    cachedTimeline = {
      key,
      value: timelineOf(source, pointers, {
        layers,
        hasCamera: cameraUrl !== null,
        geometry: geometryOf,
      }),
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

/** URL of an imported asset, by asset id. */
export function assetUrl(edit: EditState, id: string): string | null {
  if (id === MIC_ASSET) return useSession.getState().micUrl;
  const file = edit.assets.find((a) => a.id === id)?.file;
  return file ? (useSession.getState().assetUrls[file] ?? null) : null;
}

const lastSeek = new WeakMap<HTMLMediaElement, number>();
const seekLatency = new WeakMap<HTMLMediaElement, number>();

function seekTo(m: HTMLMediaElement, at: number, now: number) {
  m.currentTime = at;
  lastSeek.set(m, now);
  m.addEventListener(
    "seeked",
    () => seekLatency.set(m, (performance.now() - now) / 1000),
    { once: true },
  );
}

function follow(
  m: HTMLMediaElement,
  local: number | null,
  playing: boolean,
  rate = 1,
) {
  if (
    local === null ||
    local < 0 ||
    (Number.isFinite(m.duration) && local > m.duration)
  ) {
    if (!m.paused) m.pause();
    return;
  }
  const now = performance.now();
  // An element about to start lands exactly on the playhead first.
  const move = followMove({
    playing: playing && !m.paused,
    target: local,
    current: m.currentTime,
    seeking: m.seeking,
    msSinceSeek: now - (lastSeek.get(m) ?? -Infinity),
    seekLatency: seekLatency.get(m) ?? 0.3,
    rate,
  });
  if (Math.abs(m.playbackRate - move.rate) > 1e-3) m.playbackRate = move.rate;
  if (move.seekTo !== null) seekTo(m, move.seekTo, now);
  if (playing && m.paused) void m.play().catch(() => {});
  if (!playing && !m.paused) m.pause();
}

/** Puts the recording, its companions and every imported media at timeline time T. */
// Off while a voice-over records: the speakers would bleed into the mic.
let monitorOff = false;
export function setMonitorMuted(muted: boolean) {
  monitorOff = muted;
  syncMedia(usePlayback.getState().time, usePlayback.getState().playing);
  restartVoices();
}

/** Audio clips sound through Web Audio (voices.ts); a detached mic voice keeps its element. */
function voicesFrom(t: number) {
  const { edit } = useEdit.getState();
  startVoices(
    edit.audio,
    t,
    (clip) => assetUrl(edit, clip.asset),
    (clip) =>
      clip.asset === MIC_ASSET ||
      monitorOff ||
      edit.tracks.muted.includes(clip.lane),
  );
}

/** The audio clips changed during playback: schedule them again from now. */
export function restartVoices() {
  const { playing, time } = usePlayback.getState();
  if (playing) voicesFrom(time);
  else stopVoices();
}

function syncMedia(t: number, playing: boolean) {
  const { video, camera, mic, mediaOffset } = useSession.getState();
  const { edit } = useEdit.getState();
  const p = clipAt(edit.clips, t);
  const rec = p && p.clip.kind === "recording" ? p.clip : null;
  const source =
    rec && p ? Math.min(rec.out, rec.in + (t - p.start) * rec.speed) : null;
  const rate = rec?.speed ?? 1;
  if (video) follow(video, source, playing, rate);
  if (camera)
    follow(
      camera,
      source === null ? null : source - mediaOffset,
      playing,
      rate,
    );
  if (mic) {
    mic.muted = monitorOff || (rec?.muted ?? true) || edit.tracks.micMuted;
    follow(mic, source === null ? null : source - mediaOffset, playing, rate);
  }
  for (const [id, { el }] of pooledEntries()) {
    const o = edit.overlays.find((x) => x.id === id);
    const a = o ? null : edit.audio.find((x) => x.id === id);
    if (a && a.asset !== MIC_ASSET) continue;
    const item =
      o?.kind === "video"
        ? { start: o.start, duration: o.duration, in: o.in, volume: o.volume }
        : a;
    if (!item) continue;
    // Detached voice: `in` is source time; the mic file starts mediaOffset later.
    const shift = a?.asset === MIC_ASSET ? mediaOffset : 0;
    const local =
      t >= item.start && t <= item.start + item.duration
        ? t - item.start + item.in - shift
        : null;
    el.volume = Math.min(1, item.volume);
    // A muted music lane is silent (video overlays are muted by the painter).
    if (a) el.muted = monitorOff || edit.tracks.muted.includes(a.lane);
    follow(el, local, playing);
  }
}

let loop = 0;
// Wall clock anchor of the running playback.
let anchor = { wall: 0, t: 0 };

function tick() {
  const end = timelineEnd(useEdit.getState().edit);
  const t = anchor.t + (performance.now() - anchor.wall) / 1000;
  if (t >= end) {
    usePlayback.getState().setTime(end);
    usePlayback.getState().setPlaying(false);
    syncMedia(end, false);
    stopVoices();
    painter?.();
    return;
  }
  usePlayback.getState().setTime(t);
  syncMedia(t, true);
  painter?.();
  loop = requestAnimationFrame(tick);
}

export const player = {
  play() {
    const end = timelineEnd(useEdit.getState().edit);
    let t = usePlayback.getState().time;
    if (t >= end - 0.05) t = 0;
    anchor = { wall: performance.now(), t };
    usePlayback.getState().setTime(t);
    usePlayback.getState().setPlaying(true);
    syncMedia(t, true);
    voicesFrom(t);
    cancelAnimationFrame(loop);
    loop = requestAnimationFrame(tick);
  },
  pause() {
    cancelAnimationFrame(loop);
    usePlayback.getState().setPlaying(false);
    syncMedia(usePlayback.getState().time, false);
    stopVoices();
  },
  toggle() {
    if (usePlayback.getState().playing) player.pause();
    else player.play();
  },
  seek(t: number) {
    const end = timelineEnd(useEdit.getState().edit);
    const clamped = Math.max(0, Math.min(end, t));
    usePlayback.getState().setTime(clamped);
    anchor = { wall: performance.now(), t: clamped };
    syncMedia(clamped, usePlayback.getState().playing);
    restartVoices();
    requestPaint();
  },
  step(dt: number) {
    player.seek(usePlayback.getState().time + dt);
  },
  first() {
    player.seek(0);
  },
  last() {
    player.seek(timelineEnd(useEdit.getState().edit));
  },
};
