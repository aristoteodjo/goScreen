import {
  arrangeDevices,
  type DeviceInstance,
  resolveScreenLayout,
  SHADOW_PRESETS,
  type Size,
} from "@goscreen/device-engine";
import { type ContentSourceRef, WEB_SOURCE } from "@goscreen/content-source";
import { create } from "zustand";
import { registry } from "@/lib/registry";
import { ASPECTS, type AspectId } from "./aspect";
import { BACKGROUND_PRESETS, type Background } from "./backgrounds";

// A device as the project knows it: engine instance, what it displays, and
// how it follows the shared URL. Unsynced devices browse on their own;
// Android devices show their own screen and never follow a URL.
export type ProjectDevice = DeviceInstance & {
  synced: boolean;
  url: string | null;
  source: ContentSourceRef;
};

export type NewDevice = {
  source?: ContentSourceRef;
  viewport?: Size | null;
  orientation?: DeviceInstance["orientation"];
};

const followsUrl = (d: ProjectDevice) => d.source.kind === "web";

export type CanvasPoint = { x: number; y: number };

// Project State: what gets saved to project.json. No UI or runtime flags.
type ProjectState = {
  version: 1;
  name: string;
  url: string;
  aspect: AspectId;
  background: Background;
  devices: ProjectDevice[];
  // Top-left of each frame on the infinite canvas, in canvas units.
  canvas: Record<string, CanvasPoint>;
};

type ProjectActions = {
  setUrl: (url: string) => void;
  navigateDevice: (id: string, url: string) => void;
  setAspect: (aspect: AspectId) => void;
  setBackground: (bg: Background) => void;
  setSynced: (id: string, synced: boolean) => void;
  setAllSynced: (synced: boolean) => void;
  addDevice: (deviceId: string, init?: NewDevice) => string | null;
  removeDevice: (id: string) => void;
  /** Scene stacking: later devices are drawn on top. */
  reorderDevice: (id: string, to: "front" | "back") => void;
  updateDevice: (id: string, patch: Partial<ProjectDevice>) => void;
  moveOnCanvas: (id: string, point: CanvasPoint) => void;
  arrangeCanvas: () => void;
  autoLayout: () => void;
};

export const CANVAS_GAP = 120;

export function frameSizeOf(d: Pick<DeviceInstance, "deviceId" | "orientation" | "viewport">): Size {
  const device = registry.get(d.deviceId);
  if (!device) return { width: 0, height: 0 };
  return resolveScreenLayout(device, d.orientation, d.viewport).frame;
}

export function deviceUrl(d: ProjectDevice, sharedUrl: string): string {
  return d.synced ? sharedUrl : (d.url ?? sharedUrl);
}

function fitScaleFor(d: Pick<DeviceInstance, "deviceId" | "orientation" | "viewport">, aspect: AspectId) {
  const frame = frameSizeOf(d);
  if (frame.width === 0) return 1;
  const stage = ASPECTS[aspect];
  return Math.min((stage.height * 0.78) / frame.height, (stage.width * 0.42) / frame.width);
}

function relayout(state: Pick<ProjectState, "aspect" | "devices">): ProjectDevice[] {
  const stage = ASPECTS[state.aspect];
  const items = state.devices.flatMap((d) => {
    const device = registry.get(d.deviceId);
    return device
      ? [{ id: d.id, orientation: d.orientation, scale: d.scale, viewport: d.viewport, device }]
      : [];
  });
  const positions = arrangeDevices(items, stage, 90);
  return state.devices.map((d) => ({ ...d, ...positions.get(d.id) }));
}

// Lays frames left to right, bottoms aligned like devices on a desk.
function canvasRow(devices: ProjectDevice[]): Record<string, CanvasPoint> {
  const sizes = devices.map(frameSizeOf);
  const tallest = Math.max(0, ...sizes.map((s) => s.height));
  const out: Record<string, CanvasPoint> = {};
  let x = 0;
  devices.forEach((d, i) => {
    out[d.id] = { x, y: tallest - sizes[i].height };
    x += sizes[i].width + CANVAS_GAP;
  });
  return out;
}

let counter = 0;

export const useProject = create<ProjectState & ProjectActions>((set, get) => ({
  version: 1,
  name: "Untitled project",
  url: "https://example.com/",
  aspect: "16:9",
  background: BACKGROUND_PRESETS[0].value,
  devices: [],
  canvas: {},

  setUrl: (url) => set({ url }),
  navigateDevice: (id, url) => {
    const d = get().devices.find((x) => x.id === id);
    if (!d) return;
    if (d.synced) set({ url });
    else get().updateDevice(id, { url });
  },
  setAspect: (aspect) =>
    set((s) => {
      const devices = s.devices.map((d) => ({ ...d, scale: fitScaleFor(d, aspect) }));
      return { aspect, devices: relayout({ aspect, devices }) };
    }),
  setBackground: (background) => set({ background }),
  setSynced: (id, synced) =>
    set((s) => ({
      devices: s.devices.map((d) =>
        d.id === id && followsUrl(d) ? { ...d, synced, url: synced ? null : (d.url ?? s.url) } : d,
      ),
    })),
  setAllSynced: (synced) =>
    set((s) => ({
      devices: s.devices.map((d) =>
        followsUrl(d) ? { ...d, synced, url: synced ? null : (d.url ?? s.url) } : d,
      ),
    })),

  addDevice: (deviceId, init = {}) => {
    const device = registry.get(deviceId);
    if (!device) return null;
    counter += 1;
    const id = `dev-${Date.now().toString(36)}-${counter}`;
    const source = init.source ?? WEB_SOURCE;
    const base = { deviceId, orientation: init.orientation ?? ("portrait" as const), viewport: init.viewport ?? null };
    const instance: ProjectDevice = {
      id,
      ...base,
      colorId: device.frame.colors[0].id,
      x: 0,
      y: 0,
      scale: fitScaleFor(base, get().aspect),
      rotation: 0,
      tilt: -12,
      renderMode: "floating",
      shadow: SHADOW_PRESETS.floating,
      browserChrome: "none",
      statusBar: "auto",
      synced: source.kind === "web",
      url: null,
      source,
    };
    set((s) => {
      const devices = [...s.devices, instance];
      // New frames land to the right of the rightmost one, bottom-aligned.
      let right = 0;
      let bottom = 0;
      for (const d of s.devices) {
        const p = s.canvas[d.id];
        const f = frameSizeOf(d);
        if (!p) continue;
        right = Math.max(right, p.x + f.width + CANVAS_GAP);
        bottom = Math.max(bottom, p.y + f.height);
      }
      const f = frameSizeOf(instance);
      const y = s.devices.length === 0 ? 0 : bottom - f.height;
      return {
        devices: relayout({ aspect: s.aspect, devices }),
        canvas: { ...s.canvas, [id]: { x: right, y } },
      };
    });
    return id;
  },

  removeDevice: (id) =>
    set((s) => {
      const { [id]: _removed, ...canvas } = s.canvas;
      return {
        devices: relayout({ aspect: s.aspect, devices: s.devices.filter((d) => d.id !== id) }),
        canvas,
      };
    }),

  reorderDevice: (id, to) =>
    set((s) => {
      const d = s.devices.find((x) => x.id === id);
      if (!d) return s;
      const rest = s.devices.filter((x) => x.id !== id);
      return { devices: to === "front" ? [...rest, d] : [d, ...rest] };
    }),

  updateDevice: (id, patch) =>
    set((s) => {
      const devices = s.devices.map((d) => {
        if (d.id !== id) return d;
        const next = { ...d, ...patch };
        if (patch.deviceId) {
          const device = registry.get(next.deviceId);
          if (device && !device.frame.colors.some((c) => c.id === next.colorId)) {
            next.colorId = device.frame.colors[0].id;
          }
          // Another model has another native size; a custom size would lie.
          // A live source keeps its real size whatever frame shows it.
          if (patch.viewport === undefined && followsUrl(next)) next.viewport = null;
        }
        if ((patch.deviceId || patch.orientation) && patch.scale === undefined) {
          next.scale = fitScaleFor(next, s.aspect);
        }
        return next;
      });
      return { devices };
    }),

  moveOnCanvas: (id, point) => set((s) => ({ canvas: { ...s.canvas, [id]: point } })),
  arrangeCanvas: () => set((s) => ({ canvas: canvasRow(s.devices) })),
  autoLayout: () => set((s) => ({ devices: relayout(s) })),
}));
