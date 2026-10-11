import type { EditState } from "@goscreen/render-engine";
import { filmSchema, applyFilm } from "@goscreen/scenario";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { router } from "@/lib/router";
import { openPlace } from "@/modules/tabs/tabs";
import { exportVideo } from "./exportVideo";
import { assetUrl, currentTimeline, player, useSession } from "./session";
import { useEdit } from "./store";

// Exports of the open montage that run without the export dialog: from the
// AI, and in batches of formats (Remotion-style variants of one film).

export const RESOLUTIONS = { "720": 1280, "1080": 1920, "2160": 3840 } as const;
export type Resolution = keyof typeof RESOLUTIONS;
const STALL_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let running: AbortController | null = null;

export const exportRunning = () => running !== null;

/** Stops the export in progress; a stuck one no longer blocks the next. */
export async function stopExport() {
  if (!running) return false;
  running.abort();
  running = null;
  await ipc.exportCancel().catch(() => {});
  return true;
}

/** Opens a video in the editor, in front (WebKit stops hidden media). */
export async function openForExport(video: string) {
  const win = getCurrentWindow();
  await win.unminimize().catch(() => {});
  await win.show().catch(() => {});
  await win.setFocus().catch(() => {});
  openPlace({ to: "/editor", search: { video } });
  await router.load();
  const until = Date.now() + 30_000;
  while (!(useSession.getState().videoPath === video && currentTimeline())) {
    if (Date.now() > until) throw new Error("The video did not load.");
    await sleep(200);
  }
  await sleep(500);
}

/** Exports the open montage (or `edit`) to MP4; returns the file. */
export async function exportCurrent(
  o: { resolution: Resolution; fps: number; label?: string },
  edit: EditState = useEdit.getState().edit,
): Promise<string> {
  if (running) throw new Error("An export is already running.");
  const s = useSession.getState();
  const timeline = currentTimeline();
  if (!s.videoUrl || !timeline) throw new Error("The video is not loaded.");
  player.pause();
  running = new AbortController();
  const label = o.label ?? "Exporting";
  const progress = toast.loading(`${label}… 0%`);
  let shown = 0;
  let lastMove = Date.now();
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    watchdog = setInterval(() => {
      if (Date.now() - lastMove < STALL_MS) return;
      void stopExport();
      reject(
        new Error(
          "The export does not move: bring the goScreen window to the front (not minimised, not hidden), then try again.",
        ),
      );
    }, 1000);
  });
  try {
    const path = await Promise.race([
      stalled,
      exportVideo({
        edit,
        timeline,
        videoUrl: s.videoUrl,
        videoPath: s.videoPath,
        cameraUrl: s.cameraUrl,
        mediaOffset: s.mediaOffset,
        hasMic: s.micUrl !== null,
        assetUrl: (a) => assetUrl(edit, a),
        name: s.name,
        longSide: RESOLUTIONS[o.resolution],
        fps: o.fps,
        signal: running.signal,
        onProgress: (done) => {
          lastMove = Date.now();
          const pct = Math.round(done * 100);
          if (pct === shown) return;
          shown = pct;
          toast.loading(`${label}… ${pct}%`, { id: progress });
        },
      }),
    ]);
    toast.success(`${label}: done`, { id: progress });
    return path;
  } catch (e) {
    toast.error(`${label}: stopped`, {
      id: progress,
      description: e instanceof Error ? e.message : String(e),
    });
    throw e;
  } finally {
    clearInterval(watchdog);
    running = null;
  }
}

export type Variant = { aspect: "9:16" | "16:9" | "1:1" | "4:5"; file: string };

/**
 * The same film in several formats, one export each. Formats are applied
 * with the film's own rules (device size, caption place); the montage on
 * screen is never changed.
 */
export async function exportVariants(
  aspects: Variant["aspect"][],
  o: { resolution: Resolution; fps: number },
): Promise<Variant[]> {
  const base = useEdit.getState().edit;
  const parsed = filmSchema.safeParse(base.film?.settings ?? {});
  const film = parsed.success ? parsed.data : filmSchema.parse({});
  const locale = base.film?.locale ?? "en-US";
  const out: Variant[] = [];
  for (const aspect of aspects) {
    const edit = base.film
      ? applyFilm(base, { ...film, aspect }, locale)
      : { ...base, aspect };
    const file = await exportCurrent(
      { ...o, label: `Exporting ${aspect}` },
      edit,
    );
    out.push({ aspect, file });
  }
  return out;
}
