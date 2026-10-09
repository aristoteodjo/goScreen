import type { EditState, Placed, RecordingClip, Size } from "@goscreen/render-engine";
import { drawStill, stillTime } from "./render";
import { currentTimeline, requestPaint, useSession } from "./session";

// The outgoing side of a transition is the last frame of the previous clip.
// The playing <video> is busy with the incoming clip, so stills come from a
// second, hidden decoder. A stale still is shown while a fresh one renders.

type Still = { key: string; canvas: HTMLCanvasElement };

const stills = new Map<string, Still>();
let decoder: { url: string; video: HTMLVideoElement; camera: HTMLVideoElement | null } | null = null;
let queue: { p: Placed<RecordingClip>; edit: EditState; output: Size; pixelScale: number; key: string } | null = null;
let busy = false;

function keyOf(p: Placed<RecordingClip>, edit: EditState, output: Size, pixelScale: number) {
  // Anything that changes the composed frame: the clip span and the edit object.
  return `${p.clip.in}:${p.clip.out}:${p.clip.cameraHidden}:${output.width}x${output.height}@${pixelScale}:${editToken(edit)}`;
}

const tokens = new WeakMap<EditState, number>();
let nextToken = 0;
function editToken(edit: EditState) {
  let t = tokens.get(edit);
  if (t === undefined) {
    t = nextToken++;
    tokens.set(edit, t);
  }
  return t;
}

function media(url: string): HTMLVideoElement {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  v.src = url;
  return v;
}

function ensureDecoder() {
  const { videoUrl, cameraUrl } = useSession.getState();
  if (!videoUrl) return null;
  if (decoder?.url !== videoUrl) {
    decoder = { url: videoUrl, video: media(videoUrl), camera: cameraUrl ? media(cameraUrl) : null };
    stills.clear();
  }
  return decoder;
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    if (v.readyState >= 2 && Math.abs(v.currentTime - t) < 1e-3) return resolve();
    v.addEventListener("seeked", done, { once: true });
    v.addEventListener("error", done, { once: true });
    v.currentTime = Math.max(0, t);
  });
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue) {
      const job = queue;
      queue = null;
      const d = ensureDecoder();
      const timeline = currentTimeline();
      if (!d || !timeline) continue;
      const s = stillTime(job.p);
      await seekTo(d.video, s);
      if (d.camera) await seekTo(d.camera, s - useSession.getState().mediaOffset);
      const canvas = stills.get(job.p.clip.id)?.canvas ?? document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(job.output.width * job.pixelScale));
      canvas.height = Math.max(2, Math.round(job.output.height * job.pixelScale));
      drawStill(canvas, { video: d.video, camera: d.camera }, job.edit, timeline, job.output, job.p, job.pixelScale);
      stills.set(job.p.clip.id, { key: job.key, canvas });
      requestPaint();
    }
  } finally {
    busy = false;
  }
}

/** The last frame of a recording clip for the preview; null until first rendered. */
export function previewStill(
  p: Placed<RecordingClip>,
  edit: EditState,
  output: Size,
  pixelScale: number,
): HTMLCanvasElement | null {
  const key = keyOf(p, edit, output, pixelScale);
  const have = stills.get(p.clip.id);
  if (have?.key !== key && queue?.key !== key) {
    queue = { p, edit, output, pixelScale, key };
    void pump();
  }
  return have?.canvas ?? null;
}
