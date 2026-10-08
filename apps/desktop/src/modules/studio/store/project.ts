import {
  arrangeDevices,
  type DeviceInstance,
  resolveScreenLayout,
  SHADOW_PRESETS,
} from "@goscreen/device-engine";
import { create } from "zustand";
import { registry } from "@/lib/registry";
import { ASPECTS, type AspectId } from "./aspect";
import { BACKGROUND_PRESETS, type Background } from "./backgrounds";

// Project State: what gets saved to project.json. No UI or runtime flags.
type ProjectState = {
  version: 1;
  name: string;
  url: string;
  aspect: AspectId;
  background: Background;
  syncInteractions: boolean;
  devices: DeviceInstance[];
};

type ProjectActions = {
  setUrl: (url: string) => void;
  setAspect: (aspect: AspectId) => void;
  setBackground: (bg: Background) => void;
  setSyncInteractions: (on: boolean) => void;
  addDevice: (deviceId: string) => string | null;
  removeDevice: (id: string) => void;
  updateDevice: (id: string, patch: Partial<DeviceInstance>) => void;
  autoLayout: () => void;
};

function fitScaleFor(deviceId: string, orientation: DeviceInstance["orientation"], aspect: AspectId) {
  const device = registry.get(deviceId);
  if (!device) return 1;
  const stage = ASPECTS[aspect];
  const { frame } = resolveScreenLayout(device, orientation);
  return Math.min((stage.height * 0.78) / frame.height, (stage.width * 0.42) / frame.width);
}

function relayout(state: ProjectState): DeviceInstance[] {
  const stage = ASPECTS[state.aspect];
  const items = state.devices.flatMap((d) => {
    const device = registry.get(d.deviceId);
    return device ? [{ id: d.id, orientation: d.orientation, scale: d.scale, device }] : [];
  });
  const positions = arrangeDevices(items, stage, 90);
  return state.devices.map((d) => ({ ...d, ...positions.get(d.id) }));
}

let counter = 0;

export const useProject = create<ProjectState & ProjectActions>((set, get) => ({
  version: 1,
  name: "Untitled project",
  url: "https://example.com/",
  aspect: "16:9",
  background: BACKGROUND_PRESETS[0].value,
  syncInteractions: true,
  devices: [],

  setUrl: (url) => set({ url }),
  setAspect: (aspect) =>
    set((s) => {
      const next = { ...s, aspect };
      next.devices = s.devices.map((d) => ({ ...d, scale: fitScaleFor(d.deviceId, d.orientation, aspect) }));
      return { aspect, devices: relayout(next) };
    }),
  setBackground: (background) => set({ background }),
  setSyncInteractions: (syncInteractions) => set({ syncInteractions }),

  addDevice: (deviceId) => {
    const device = registry.get(deviceId);
    if (!device) return null;
    counter += 1;
    const id = `dev-${Date.now().toString(36)}-${counter}`;
    const instance: DeviceInstance = {
      id,
      deviceId,
      colorId: device.frame.colors[0].id,
      orientation: "portrait",
      x: 0,
      y: 0,
      scale: fitScaleFor(deviceId, "portrait", get().aspect),
      rotation: 0,
      tilt: -12,
      renderMode: "floating",
      shadow: SHADOW_PRESETS.floating,
      browserChrome: "none",
      statusBar: "auto",
    };
    set((s) => {
      const next = { ...s, devices: [...s.devices, instance] };
      return { devices: relayout(next) };
    });
    return id;
  },

  removeDevice: (id) =>
    set((s) => ({ devices: relayout({ ...s, devices: s.devices.filter((d) => d.id !== id) }) })),

  updateDevice: (id, patch) =>
    set((s) => {
      const devices = s.devices.map((d) => {
        if (d.id !== id) return d;
        const next = { ...d, ...patch };
        // A new model or orientation changes the frame size, so refit it.
        if (patch.deviceId || patch.orientation) {
          const device = registry.get(next.deviceId);
          if (patch.deviceId && device && !device.frame.colors.some((c) => c.id === next.colorId)) {
            next.colorId = device.frame.colors[0].id;
          }
          if (patch.scale === undefined) next.scale = fitScaleFor(next.deviceId, next.orientation, s.aspect);
        }
        return next;
      });
      return { devices };
    }),

  autoLayout: () => set((s) => ({ devices: relayout(s) })),
}));
