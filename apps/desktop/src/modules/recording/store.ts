import type { CaptureMode, RecordedPointer } from "@goscreen/render-engine";
import { create } from "zustand";
import type { CaptureRegion } from "@/lib/ipc";
import type { BridgeEvent } from "@/modules/interaction/bridge";

export type RecordedInteraction = { instanceId: string; event: BridgeEvent };

// Recording State. Interactions are kept apart from the video so effects
// (touch rings, zooms, cursor) stay editable after capture.
type RecordingState = {
  active: boolean;
  startedAt: number | null;
  // performance.now() of the first video frame; null until FFmpeg runs.
  clockZero: number | null;
  // What is being captured, in window CSS px. Fixed for the whole take.
  mode: CaptureMode | null;
  region: CaptureRegion | null;
  // Pause keeps capturing; paused stretches (seconds from the first frame)
  // are cut out when the take opens in the editor.
  pausedAt: number | null;
  pauses: { start: number; end: number }[];
  // Site tour: when each page came on screen (seconds from the first frame).
  chapters: { url: string; start: number }[];
  markChapter: (url: string) => void;
  /** Chapters so far, each ending where the next starts (the last one now). */
  closedChapters: () => { url: string; start: number; end: number }[];
  setActive: (active: boolean) => void;
  togglePause: () => void;
  /** Pauses so far, the running one closed now. */
  closedPauses: () => { start: number; end: number }[];
  setClockZero: (t: number | null) => void;
  setCapture: (mode: CaptureMode | null, region: CaptureRegion | null) => void;
};

const takeTime = (clockZero: number | null) =>
  clockZero === null ? 0 : (performance.now() - clockZero) / 1000;

export const useRecording = create<RecordingState>((set, get) => ({
  active: false,
  startedAt: null,
  clockZero: null,
  mode: null,
  region: null,
  pausedAt: null,
  pauses: [],
  chapters: [],
  setActive: (active) =>
    set(
      active
        ? {
            active,
            startedAt: Date.now(),
            clockZero: null,
            pausedAt: null,
            pauses: [],
            chapters: [],
          }
        : {
            active,
            startedAt: null,
            clockZero: null,
            region: null,
            pausedAt: null,
          },
    ),
  togglePause: () => {
    const { active, clockZero, pausedAt, pauses } = get();
    if (!active || clockZero === null) return;
    const now = takeTime(clockZero);
    if (pausedAt === null) set({ pausedAt: now });
    else
      set({
        pausedAt: null,
        pauses: [...pauses, { start: pausedAt, end: now }],
      });
  },
  closedPauses: () => {
    const { clockZero, pausedAt, pauses } = get();
    return pausedAt === null
      ? pauses
      : [...pauses, { start: pausedAt, end: takeTime(clockZero) }];
  },
  markChapter: (url) =>
    set({
      chapters: [...get().chapters, { url, start: takeTime(get().clockZero) }],
    }),
  closedChapters: () => {
    const { chapters, clockZero } = get();
    const now = takeTime(clockZero);
    return chapters.map((c, i) => ({
      ...c,
      end: chapters[i + 1]?.start ?? now,
    }));
  },
  setClockZero: (clockZero) => set({ clockZero }),
  setCapture: (mode, region) => set({ mode, region }),
}));

let events: RecordedInteraction[] = [];
let pointers: RecordedPointer[] = [];

export const interactionLog = {
  reset: () => {
    events = [];
    pointers = [];
  },
  push: (entry: RecordedInteraction) => {
    events.push(entry);
  },
  pushPointer: (pointer: RecordedPointer) => {
    pointers.push(pointer);
  },
  drain: () => {
    const out = { events, pointers };
    events = [];
    pointers = [];
    return out;
  },
};
