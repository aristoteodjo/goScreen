import type { CaptureMode } from "@goscreen/render-engine";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { type CaptureRegion, ipc } from "@/lib/ipc";
import { canvasCommands, canvasElement } from "@/modules/canvas/commands";
import type { View } from "@/modules/canvas/math";
import { useCanvasView } from "@/modules/canvas/view";
import { stageRegion } from "@/modules/studio/stageRef";
import { useEditor } from "@/modules/studio/store/editor";
import { useProject } from "@/modules/studio/store/project";
import { layerLog } from "./layerLog";
import { splitParts, type TakeJournal } from "./split";
import { captureMode, useCaptureSettings } from "./settings";
import { screenRect } from "./stagePoint";
import { interactionLog, useRecording } from "./store";

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** A "fix it" button for errors caused by a missing macOS permission. */
function settingsAction(message: string) {
  const pane = message.includes("Screen Recording")
    ? "screen"
    : message.includes("Camera and Microphone")
      ? "camera"
      : null;
  if (!pane) return undefined;
  return { label: "Open Settings", onClick: () => void ipc.openPrivacySettings(pane).catch(() => {}) };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Canvas view to restore after a Device take, which zooms onto the device.
let viewBeforeTake: View | null = null;

function restoreCanvasView() {
  if (viewBeforeTake) useCanvasView.getState().setView(viewBeforeTake);
  viewBeforeTake = null;
}

/**
 * A Device take records the glass at its on-screen size, so the device is
 * first fitted to the canvas: more real pixels, a sharper video.
 */
async function frameDeviceForTake() {
  const id = useEditor.getState().selectedId ?? useProject.getState().devices[0]?.id;
  if (!id || useEditor.getState().view !== "canvas") return;
  const { zoom, panX, panY } = useCanvasView.getState();
  viewBeforeTake = { zoom, panX, panY };
  canvasCommands.focus(id);
  // Let the eased zoom land and the pages re-rasterize at the new scale.
  await wait(400);
}

function boxOf(el: HTMLElement | null): CaptureRegion | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
}

/**
 * "Separately" on the canvas: devices are packed to fill the view before the
 * take, so each one gets as many real pixels as the window allows.
 */
async function packDevicesForTake() {
  if (useEditor.getState().view !== "canvas") return;
  const { zoom, panX, panY } = useCanvasView.getState();
  viewBeforeTake = { zoom, panX, panY };
  canvasCommands.fit(16);
  await wait(400);
}

/** The window area a mode records. Only device screens inside it matter. */
function regionFor(mode: CaptureMode): CaptureRegion {
  if (mode === "scene") {
    const r = stageRegion();
    if (!r) throw new Error("The scene is not visible.");
    return r;
  }
  if (mode === "canvas") {
    const r = boxOf(canvasElement());
    if (!r) throw new Error("The canvas is not visible.");
    return r;
  }
  const id = useEditor.getState().selectedId ?? useProject.getState().devices[0]?.id;
  const r = id ? screenRect(id) : null;
  if (!r) throw new Error("Select the device to record first.");
  return r;
}

export function useCapture() {
  const navigate = useNavigate();
  const active = useRecording((s) => s.active);
  const setActive = useRecording((s) => s.setActive);

  const start = useMutation({
    mutationFn: async () => {
      if (useProject.getState().devices.length === 0) throw new Error("Add a device to record first.");
      const { camera, microphone } = useCaptureSettings.getState();
      // Canvas and Scene record the view on screen; the view never changes here.
      const mode = captureMode();
      interactionLog.reset();
      if (mode === "device") await frameDeviceForTake();
      else if (useCaptureSettings.getState().separate && useProject.getState().devices.length > 1) {
        await packDevicesForTake();
      }
      // `active` flattens frames and hides UI chrome before FFmpeg starts.
      setActive(true);
      await nextFrame();
      await nextFrame();
      const region = regionFor(mode);
      useRecording.getState().setCapture(mode, region);
      const called = performance.now();
      const started = await ipc.recordingStart(region, { camera, microphone });
      return { started, called, region };
    },
    onSuccess: ({ started, called, region }) => {
      if (typeof started?.videoPath !== "string" || started.videoPath.length === 0) {
        setActive(false);
        toast.error("Recording did not start.");
        return;
      }
      // Interactions and layers are timed from the first video frame.
      const zero = called + started.spawnOffsetMs;
      useRecording.getState().setClockZero(zero);
      layerLog.start(region, () => (performance.now() - zero) / 1000);
      useCaptureSettings.getState().setBarOpen(false);
      if (started.companionWarning) {
        toast.warning("Recording the screen only", {
          description: started.companionWarning,
          action: settingsAction(started.companionWarning),
        });
      }
    },
    onError: (e) => {
      layerLog.stop();
      setActive(false);
      restoreCanvasView();
      const message = errorMessage(e);
      toast.error("Could not start recording", {
        description: message,
        action: settingsAction(message),
        duration: 15_000,
      });
    },
  });

  const stop = useMutation({
    mutationFn: async () => {
      const { startedAt, mode, region } = useRecording.getState();
      const project = useProject.getState();
      const { events, pointers } = interactionLog.drain();
      const layers = layerLog.stop();
      const { camera, bubble, separate } = useCaptureSettings.getState();
      const journal: TakeJournal = {
        version: 3,
        startedAt,
        mode: mode ?? "scene",
        capture: { width: region?.width ?? 1, height: region?.height ?? 1 },
        layers,
        pointers,
        devices: project.devices,
        events,
        pauses: useRecording.getState().closedPauses(),
        // The editor opens the webcam where the bubble sat in the studio.
        camera: camera === null ? null : { ...bubble, visible: true, layout: "overlay" },
      };
      const result = await ipc.recordingStop(journal);
      const parts = separate && mode !== "device" ? splitParts(journal) : [];
      if (parts.length === 0 || !result?.videoPath) return { result, split: [] as string[] };
      try {
        return { result, split: await ipc.recordingSplit(result.videoPath, parts) };
      } catch (e) {
        // The take itself is safe; only the per-device copies failed.
        toast.error("Could not save one video per device", { description: errorMessage(e) });
        return { result, split: [] as string[] };
      }
    },
    onSuccess: ({ result, split }) => {
      setActive(false);
      restoreCanvasView();
      if (Array.isArray(split) && split.length > 0) {
        toast.success(`${split.length} device videos saved`, {
          description: "Each one opens on its own from Recordings, ready for a user test.",
          action: { label: "Show", onClick: () => revealItemInDir(split[0]) },
        });
      }
      if (!result?.videoPath) {
        toast.error("Recording finished without a video file.");
        return;
      }
      // Straight into the editor, like a screen recorder should.
      navigate({ to: "/editor", search: { video: result.videoPath } });
    },
    onError: (e) => {
      setActive(false);
      restoreCanvasView();
      toast.error("Recording failed", { description: errorMessage(e) });
    },
  });

  const screenshot = useMutation({
    mutationFn: async () => {
      // Same area as the next recording, from the view on screen.
      setActive(true);
      await nextFrame();
      await nextFrame();
      try {
        return await ipc.screenshot(regionFor(captureMode()));
      } finally {
        setActive(false);
      }
    },
    onSuccess: (path) => {
      if (typeof path !== "string" || path.length === 0) return;
      toast.success("Screenshot saved", {
        action: { label: "Show", onClick: () => revealItemInDir(path) },
      });
    },
    onError: (e) => toast.error("Screenshot failed", { description: errorMessage(e) }),
  });

  return {
    recording: active,
    toggleRecording: () => {
      if (start.isPending || stop.isPending) return;
      if (active) stop.mutate();
      else start.mutate();
    },
    /** Resolves once FFmpeg delivers frames; rejects when it cannot start. */
    startAsync: () => start.mutateAsync(),
    stopAsync: () => stop.mutateAsync(),
    togglePause: () => useRecording.getState().togglePause(),
    isStarting: start.isPending,
    isStopping: stop.isPending,
    screenshot: () => screenshot.mutate(),
    isShooting: screenshot.isPending,
  };
}

export type CaptureControls = ReturnType<typeof useCapture>;
