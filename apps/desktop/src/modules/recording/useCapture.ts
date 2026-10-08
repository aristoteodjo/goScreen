import { useMutation } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { stageRegion } from "@/modules/studio/stageRef";
import { ASPECTS } from "@/modules/studio/store/aspect";
import { useEditor } from "@/modules/studio/store/editor";
import { useProject } from "@/modules/studio/store/project";
import { interactionLog, useRecording } from "./store";

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function useCapture() {
  const active = useRecording((s) => s.active);
  const setActive = useRecording((s) => s.setActive);

  const start = useMutation({
    mutationFn: async () => {
      // Selection outlines hide once `active` renders, before ffmpeg starts.
      interactionLog.reset();
      // The recorded region is the scene stage, never the free canvas.
      useEditor.getState().setView("scene");
      setActive(true);
      await nextFrame();
      await nextFrame();
      const region = stageRegion();
      if (!region) throw new Error("The stage is not visible.");
      return ipc.recordingStart(region);
    },
    onSuccess: (path) => {
      if (typeof path !== "string" || path.length === 0) {
        setActive(false);
        toast.error("Recording did not start.");
      }
    },
    onError: (e) => {
      setActive(false);
      toast.error("Could not start recording", { description: errorMessage(e) });
    },
  });

  const stop = useMutation({
    mutationFn: () => {
      const { startedAt } = useRecording.getState();
      const project = useProject.getState();
      return ipc.recordingStop({
        version: 1,
        startedAt,
        stage: { aspect: project.aspect, ...ASPECTS[project.aspect] },
        devices: project.devices,
        events: interactionLog.drain(),
      });
    },
    onSuccess: (result) => {
      setActive(false);
      if (!result?.videoPath) {
        toast.error("Recording finished without a video file.");
        return;
      }
      toast.success("Recording saved", {
        description: `${(result.durationMs / 1000).toFixed(1)}s, interactions saved alongside.`,
        action: { label: "Show", onClick: () => revealItemInDir(result.videoPath) },
      });
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
