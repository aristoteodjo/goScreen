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
  setActive: (active: boolean) => void;
  setClockZero: (t: number | null) => void;
  setCapture: (mode: CaptureMode | null, region: CaptureRegion | null) => void;
};

export const useRecording = create<RecordingState>((set) => ({
  active: false,
  startedAt: null,
  clockZero: null,
  mode: null,
  region: null,
  setActive: (active) =>
    set(active ? { active, startedAt: Date.now(), clockZero: null } : { active, startedAt: null, clockZero: null, region: null }),
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
