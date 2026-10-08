import type { CaptureMode } from "@goscreen/render-engine";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { type CaptureRegion, ipc } from "@/lib/ipc";
import { canvasElement } from "@/modules/canvas/commands";
import { stageRegion } from "@/modules/studio/stageRef";
import { useEditor } from "@/modules/studio/store/editor";
import { useProject } from "@/modules/studio/store/project";
import { layerLog } from "./layerLog";
import { useCaptureSettings } from "./settings";
import { screenRect } from "./stagePoint";
import { interactionLog, useRecording } from "./store";

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function boxOf(el: HTMLElement | null): CaptureRegion | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
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
      const { mode, camera, microphone } = useCaptureSettings.getState();
      interactionLog.reset();
      if (mode === "scene") useEditor.getState().setView("scene");
      if (mode === "canvas") useEditor.getState().setView("canvas");
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
      if (started.companionWarning) toast.warning("Recording the screen only", { description: started.companionWarning });
    },
    onError: (e) => {
      layerLog.stop();
      setActive(false);
      toast.error("Could not start recording", { description: errorMessage(e) });
    },
  });

  const stop = useMutation({
    mutationFn: () => {
      const { startedAt, mode, region } = useRecording.getState();
      const project = useProject.getState();
      const { events, pointers } = interactionLog.drain();
      const layers = layerLog.stop();
      return ipc.recordingStop({
        version: 3,
        startedAt,
        mode: mode ?? "scene",
        capture: { width: region?.width ?? 1, height: region?.height ?? 1 },
        layers,
        pointers,
        devices: project.devices,
        events,
      });
    },
    onSuccess: (result) => {
      setActive(false);
      if (!result?.videoPath) {
        toast.error("Recording finished without a video file.");
        return;
      }
      // Straight into the editor, like a screen recorder should.
      navigate({ to: "/editor", search: { video: result.videoPath } });
    },
    onError: (e) => {
      setActive(false);
      toast.error("Recording failed", { description: errorMessage(e) });
    },
  });

  const screenshot = useMutation({
    mutationFn: async () => {
      useEditor.getState().setView("scene");
      setActive(true);
      await nextFrame();
      await nextFrame();
      const region = stageRegion();
      if (!region) {
        setActive(false);
        throw new Error("The stage is not visible.");
      }
      try {
        return await ipc.screenshot(region);
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
    isStarting: start.isPending,
    isStopping: stop.isPending,
    screenshot: () => screenshot.mutate(),
    isShooting: screenshot.isPending,
  };
}

export type CaptureControls = ReturnType<typeof useCapture>;
