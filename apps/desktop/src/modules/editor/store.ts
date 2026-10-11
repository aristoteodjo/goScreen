import {
  DEFAULT_EDIT,
  type EditState,
  sequenceDuration,
} from "@goscreen/render-engine";
import { create } from "zustand";

const HISTORY_LIMIT = 100;
/** Changes with the same key this close together undo as one step. */
const COALESCE_MS = 700;

// Edit State: everything layered on top of the recording, saved to
// `<video>.edit.json`. The MP4 itself is never modified.
type EditStore = {
  edit: EditState;
  past: EditState[];
  future: EditState[];
  lastKey: string | null;
  lastAt: number;
  load: (edit: EditState) => void;
  /** `key` groups a continuous gesture (slider drag, segment drag) into one undo step. */
  change: (fn: (edit: EditState) => EditState, key?: string) => void;
  undo: () => void;
  redo: () => void;
};

export const useEdit = create<EditStore>((set, get) => ({
  edit: DEFAULT_EDIT,
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
  load: (edit) => set({ edit, past: [], future: [], lastKey: null }),
  change: (fn, key) => {
    const { edit, past, lastKey, lastAt } = get();
    const next = fn(edit);
    if (next === edit) return;
    const now = Date.now();
    const coalesce =
      key !== undefined && key === lastKey && now - lastAt < COALESCE_MS;
    set({
      edit: next,
      past: coalesce ? past : [...past, edit].slice(-HISTORY_LIMIT),
      future: [],
      lastKey: key ?? null,
      lastAt: now,
    });
  },
  undo: () => {
    const { past, edit, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({
      edit: prev,
      past: past.slice(0, -1),
      future: [edit, ...future],
      lastKey: null,
    });
  },
  redo: () => {
    const { past, edit, future } = get();
    const next = future[0];
    if (!next) return;
    set({
      edit: next,
      past: [...past, edit],
      future: future.slice(1),
      lastKey: null,
    });
  },
}));

export type Panel =
  | "film"
  | "proposals"
  | "devices"
  | "background"
  | "touch"
  | "zoom"
  | "camera"
  | "audio"
  | "clip"
  | "overlay"
  | "music";
export type Quality = 1 | 0.5 | 0.25;
/** Timeline tool, as in Premiere: select (V), blade (C), hand (H). */
export type Tool = "select" | "blade" | "hand";

/** A selected timeline item other than a zoom. */
export type Selection = { kind: "clip" | "overlay" | "audio"; id: string };

const PANEL_OF: Record<Selection["kind"], Panel> = {
  clip: "clip",
  overlay: "overlay",
  audio: "music",
};

// Editor UI State: playback and panels. Never saved. `time` is timeline
// time (the sequence of clips); `duration` is the source recording's.
type PlaybackStore = {
  time: number;
  duration: number;
  playing: boolean;
  panel: Panel;
  quality: Quality;
  selectedZoom: string | null;
  selectedLayer: string | null;
  selection: Selection | null;
  // Pixels per timeline second; null fits the whole sequence.
  scale: number | null;
  paletteOpen: boolean;
  tool: Tool;
  // Timeline items snap to the playhead, cuts and other items.
  snapping: boolean;
  // Preview zoom: null fits the panel, 1 shows output pixels 1:1 (CSS px).
  viewZoom: number | null;
  setTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaying: (playing: boolean) => void;
  setPanel: (panel: Panel) => void;
  setQuality: (quality: Quality) => void;
  selectZoom: (id: string | null) => void;
  selectLayer: (id: string | null) => void;
  select: (selection: Selection | null) => void;
  setScale: (scale: number | null) => void;
  setPaletteOpen: (open: boolean) => void;
  setTool: (tool: Tool) => void;
  setSnapping: (snapping: boolean) => void;
  setViewZoom: (viewZoom: number | null) => void;
  reset: () => void;
};

export const usePlayback = create<PlaybackStore>((set) => ({
  time: 0,
  duration: 0,
  playing: false,
  panel: "background",
  quality: 1,
  selectedZoom: null,
  selectedLayer: null,
  selection: null,
  scale: null,
  paletteOpen: false,
  tool: "select",
  snapping: true,
  viewZoom: null,
  setTime: (time) => set({ time }),
  setDuration: (duration) => set({ duration }),
  setPlaying: (playing) => set({ playing }),
  setPanel: (panel) => set({ panel }),
  setQuality: (quality) => set({ quality }),
  selectZoom: (selectedZoom) =>
    set(
      selectedZoom
        ? { selectedZoom, selection: null, panel: "zoom" }
        : { selectedZoom },
    ),
  selectLayer: (selectedLayer) =>
    set(
      selectedLayer
        ? {
            selectedLayer,
            selectedZoom: null,
            selection: null,
            panel: "devices",
          }
        : { selectedLayer },
    ),
  select: (selection) =>
    set(
      selection
        ? {
            selection,
            selectedZoom: null,
            selectedLayer: null,
            panel: PANEL_OF[selection.kind],
          }
        : { selection: null },
    ),
  setScale: (scale) => set({ scale }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setTool: (tool) => set({ tool }),
  setSnapping: (snapping) => set({ snapping }),
  setViewZoom: (viewZoom) => set({ viewZoom }),
  reset: () =>
    set({
      time: 0,
      duration: 0,
      playing: false,
      selectedZoom: null,
      selectedLayer: null,
      selection: null,
      scale: null,
    }),
}));

/** Length of the edited video, in timeline seconds. */
export const timelineEnd = (edit: EditState) => sequenceDuration(edit.clips);

/** A short unique id for new timeline items. */
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
