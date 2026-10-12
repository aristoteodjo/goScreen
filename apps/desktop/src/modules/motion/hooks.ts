import { agreement, ShotReview } from "@goscreen/motion";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { z } from "zod";
import { create } from "zustand";
import {
  type MotionProgress,
  localAiIpc,
  motionIpc,
  parseInstallProgress,
  parseMotionProgress,
} from "./ipc";
import { FILES, latestReport, loadExamples, loadSpec, type RenderReport } from "./pipeline";
import { motionKeys } from "./store";

// What the Reproduce screens read. Every view reads files of the reference
// folder, so a change made by an AI through MCP shows up after
// `refreshMotion()`, like one made here.

export function useReferences() {
  return useQuery({
    queryKey: motionKeys.references(),
    queryFn: motionIpc.references,
  });
}

export function useReference(id: string) {
  const list = useReferences();
  return { ...list, data: list.data?.find((r) => r.id === id) };
}

export function useSpec(id: string, enabled: boolean) {
  return useQuery({
    queryKey: motionKeys.spec(id),
    queryFn: () => loadSpec(id),
    enabled,
  });
}

/** The renderings of a reference, newest first ("render-3.mp4"…). */
export const renderingsOf = (files: string[]) =>
  files
    .filter((f) => /^render-\d+\.mp4$/.test(f))
    .sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]));

export function useReport(id: string, render: string | null) {
  return useQuery({
    queryKey: [...motionKeys.report(id), render],
    queryFn: async (): Promise<RenderReport | null> => {
      if (!render) return null;
      try {
        return (await motionIpc.readJson(id, render.replace(/\.mp4$/, ".report.json"))) as RenderReport;
      } catch {
        return null;
      }
    },
  });
}

export { FILES, latestReport };

const studentSchema = z.object({ prompt: z.string(), review: ShotReview });

/** What the local model last answered about a shot, if it looked. */
export function useStudentAnswer(id: string, shot: string, files: string[]) {
  const file = `review-${shot}.local.json`;
  const exists = files.includes(file);
  return useQuery({
    queryKey: [...motionKeys.all, id, "student", shot, exists],
    queryFn: async () => (exists ? studentSchema.parse(await motionIpc.readJson(id, file)).review : null),
  });
}

/** A frame of a video of the reference; frames never change, so kept. */
export function useFrame(id: string, video: string, time: number, width = 480) {
  return useQuery({
    queryKey: ["motion-frame", id, video, Math.round(time * 100), width],
    queryFn: () => motionIpc.frame(id, video, time, width),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
  });
}

export function useVideoUrl(id: string, video: string | null) {
  return useQuery({
    queryKey: ["motion-video", id, video],
    queryFn: () => motionIpc.videoUrl(id, video as string),
    enabled: !!video,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useLocalAi() {
  return useQuery({
    queryKey: motionKeys.localAi(),
    queryFn: localAiIpc.status,
    // A download or a crash changes it from Rust.
    refetchInterval: (q) => (q.state.data?.downloading ? 1000 : 5000),
  });
}

export function useTraining() {
  return useQuery({
    queryKey: motionKeys.training(),
    queryFn: async () => agreement(await loadExamples(false)),
  });
}

// The analyser and the renderer report as they go; one job at a time.
type Progress = {
  job: MotionProgress | null;
  install: { model: string; done: number; total: number } | null;
};

export const useMotionProgress = create<Progress>(() => ({ job: null, install: null }));

/** Listens to Rust progress while a Reproduce screen is open. */
export function useProgressEvents() {
  useEffect(() => {
    const off = [
      listen("motion-progress", (e) => {
        const r = parseMotionProgress(e.payload);
        if (!r.success) return;
        const done = r.data.type === "done" || r.data.type === "error";
        useMotionProgress.setState({ job: done ? null : r.data });
      }),
      listen("local-ai-progress", (e) => {
        const r = parseInstallProgress(e.payload);
        if (!r.success) return;
        useMotionProgress.setState({
          install:
            r.data.type === "progress"
              ? { model: r.data.model, done: r.data.done ?? 0, total: r.data.total ?? 0 }
              : null,
        });
      }),
    ];
    return () => {
      for (const p of off) void p.then((f) => f());
    };
  }, []);
}

/** "Measuring 40 %", "Rendering 12 %"… */
export function describeJob(job: MotionProgress | null): string | null {
  if (!job) return null;
  const pct = job.total ? ` ${Math.round(((job.done ?? 0) / job.total) * 100)} %` : "";
  if (job.script?.includes("compose")) return `Rendering${pct}`;
  if (job.step === "ocr") return `Reading the words${pct}`;
  return `Measuring${pct}`;
}
