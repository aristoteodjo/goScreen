import { create } from "zustand";
import type { BridgeEvent } from "@/modules/interaction/bridge";

export type RecordedInteraction = { instanceId: string; event: BridgeEvent };

// Recording State. Interactions are kept apart from the video so effects
// (touch rings, zooms, cursor) stay editable after capture.
type RecordingState = {
  active: boolean;
  startedAt: number | null;
  setActive: (active: boolean) => void;
};

export const useRecording = create<RecordingState>((set) => ({
  active: false,
  startedAt: null,
  setActive: (active) => set({ active, startedAt: active ? Date.now() : null }),
}));

let buffer: RecordedInteraction[] = [];

export const interactionLog = {
  reset: () => {
    buffer = [];
  },
  push: (entry: RecordedInteraction) => {
    buffer.push(entry);
  },
  drain: () => {
    const out = buffer;
    buffer = [];
    return out;
  },
};
