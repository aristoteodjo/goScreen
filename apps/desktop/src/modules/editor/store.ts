import { DEFAULT_EDIT, type EditState } from "@goscreen/render-engine";
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
    const coalesce = key !== undefined && key === lastKey && now - lastAt < COALESCE_MS;
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
    set({ edit: prev, past: past.slice(0, -1), future: [edit, ...future], lastKey: null });
  },
  redo: () => {
    const { past, edit, future } = get();
    const next = future[0];
    if (!next) return;
    set({ edit: next, past: [...past, edit], future: future.slice(1), lastKey: null });
  },
}));

export type Panel = "devices" | "background" | "touch" | "zoom" | "camera" | "audio";
export type Quality = 1 | 0.5 | 0.25;

// Editor UI State: playback and panels. Never saved.
type PlaybackStore = {
  time: number;
  duration: number;
  playing: boolean;
  panel: Panel;
  quality: Quality;
  selectedZoom: string | null;
  selectedLayer: string | null;
  paletteOpen: boolean;
  setTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaying: (playing: boolean) => void;
  setPanel: (panel: Panel) => void;
  setQuality: (quality: Quality) => void;
  selectZoom: (id: string | null) => void;
  selectLayer: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
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
  paletteOpen: false,
  setTime: (time) => set({ time }),
  setDuration: (duration) => set({ duration }),
  setPlaying: (playing) => set({ playing }),
  setPanel: (panel) => set({ panel }),
  setQuality: (quality) => set({ quality }),
  selectZoom: (selectedZoom) => set(selectedZoom ? { selectedZoom, panel: "zoom" } : { selectedZoom }),
  selectLayer: (selectedLayer) =>
    set(selectedLayer ? { selectedLayer, selectedZoom: null, panel: "devices" } : { selectedLayer }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  reset: () => set({ time: 0, duration: 0, playing: false, selectedZoom: null, selectedLayer: null }),
}));

/** End of the kept range, in source seconds. */
export const trimEnd = (edit: EditState, duration: number) =>
  Math.min(duration, edit.trim.end ?? duration);
