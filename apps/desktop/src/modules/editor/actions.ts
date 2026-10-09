import {
  type Animation,
  type AudioClip,
  clipAt,
  DEFAULT_EDIT,
  type EditState,
  type MainClip,
  moveClip,
  type Overlay,
  type OverlayBase,
  removeClip,
  setSpeed,
  type ShapeKind,
  type SlideClip,
  splitAt,
  type TextOverlay,
} from "@goscreen/render-engine";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { probeDuration } from "./media";
import { player, useSession } from "./session";
import { newId, type Selection, timelineEnd, useEdit, usePlayback } from "./store";

const change = (fn: (ed: EditState) => EditState, key?: string) => useEdit.getState().change(fn, key);
const now = () => usePlayback.getState().time;
const selection = () => usePlayback.getState().selection;

/** First lane where [start, start + duration) is free. */
function freeLane(items: { lane: number; start: number; duration: number }[], start: number, duration: number) {
  for (let lane = 0; lane < 20; lane += 1) {
    const busy = items.some((o) => o.lane === lane && o.start < start + duration && start < o.start + o.duration);
    if (!busy) return lane;
  }
  return 0;
}

function overlayAt(duration: number, patch: Partial<OverlayBase>): OverlayBase {
  const edit = useEdit.getState().edit;
  const end = timelineEnd(edit);
  const start = Math.max(0, Math.min(now(), Math.max(0, end - 0.5)));
  const length = Math.max(0.5, Math.min(duration, end - start || duration));
  return {
    id: newId("ovl"),
    lane: freeLane(edit.overlays, start, length),
    start,
    duration: length,
    x: 0.5,
    y: 0.5,
    width: 0.4,
    height: 0.12,
    rotation: 0,
    opacity: 1,
    enter: "fade",
    exit: "fade",
    motion: 0.4,
    ...patch,
  };
}

function addOverlay(o: Overlay) {
  change((ed) => ({ ...ed, overlays: [...ed.overlays, o] }));
  usePlayback.getState().select({ kind: "overlay", id: o.id });
  player.seek(Math.max(now(), o.start + Math.min(o.motion, o.duration / 2)));
}

export const TEXT_PRESETS: { id: string; label: string; enter: Animation; patch: Partial<TextOverlay> }[] = [
  { id: "title", label: "Title", enter: "words", patch: { y: 0.18, width: 0.8, height: 0.14 } },
  { id: "caption", label: "Caption", enter: "slide-up", patch: { y: 0.86, width: 0.7, height: 0.08 } },
  { id: "typewriter", label: "Typewriter", enter: "typewriter", patch: { y: 0.5, width: 0.6, height: 0.1 } },
];

export const editActions = {
  addText(preset = TEXT_PRESETS[0]) {
    const big = preset.id === "title";
    addOverlay({
      ...overlayAt(3, { ...preset.patch, enter: preset.enter, motion: big ? 0.9 : 0.5 }),
      kind: "text",
      text: big ? "Your headline" : preset.id === "caption" ? "Add a caption" : "Type something…",
      style: {
        font: "Inter",
        size: big ? 0.075 : 0.045,
        weight: big ? 700 : 600,
        color: "#ffffff",
        align: "center",
        background: preset.id === "caption" ? "#000000" : null,
      },
    } as TextOverlay);
  },

  addShape(shape: ShapeKind) {
    const box =
      shape === "arrow"
        ? { width: 0.18, height: 0.06 }
        : shape === "highlight"
          ? { width: 0.3, height: 0.07 }
          : { width: 0.25, height: 0.18 };
    addOverlay({
      ...overlayAt(2.5, { ...box, enter: "wipe", exit: "fade", motion: 0.5 }),
      kind: "shape",
      shape,
      color: shape === "highlight" ? "#facc15" : "#ff3b5c",
      stroke: 0.006,
    });
  },

  /** A title card cut in at the playhead (or appended at the end). */
  addSlide() {
    const edit = useEdit.getState().edit;
    const slide: SlideClip = {
      id: newId("slide"),
      kind: "slide",
      duration: 3,
      background: edit.background.kind === "none" ? DEFAULT_EDIT.background : edit.background,
      title: "Introducing our app",
      subtitle: "Faster, simpler, yours",
      color: "#ffffff",
      font: "Inter",
      animation: "words",
    };
    const t = now();
    const at = clipAt(edit.clips, t);
    // At a clip boundary it slots in; inside a clip, it splits it first.
    let clips = edit.clips;
    let index = clips.length;
    if (at && t > at.start + 0.05 && t < at.end - 0.05) {
      clips = splitAt(clips, t, newId("clip"));
      index = at.index + 1;
    } else if (at && t <= at.start + 0.05) {
      index = at.index;
    }
    const next = [...clips.slice(0, index), slide, ...clips.slice(index)];
    change((ed) => ({ ...ed, clips: next }));
    usePlayback.getState().select({ kind: "clip", id: slide.id });
  },

  splitAtPlayhead() {
    const t = now();
    const edit = useEdit.getState().edit;
    const sel = selection();
    // A selected overlay or audio clip splits itself; otherwise the main track.
    if (sel?.kind === "overlay" || sel?.kind === "audio") {
      const list = sel.kind === "overlay" ? edit.overlays : edit.audio;
      const item = list.find((o) => o.id === sel.id);
      if (!item || t <= item.start + 0.1 || t >= item.start + item.duration - 0.1) return;
      const cut = t - item.start;
      const left = { ...item, duration: cut };
      const right = { ...item, id: newId(sel.kind === "overlay" ? "ovl" : "aud"), start: t, duration: item.duration - cut };
      if ("in" in right) (right as { in: number }).in += cut;
      const key = sel.kind === "overlay" ? "overlays" : "audio";
      change((ed) => ({
        ...ed,
        [key]: (ed[key] as (Overlay | AudioClip)[]).flatMap((o) => (o.id === item.id ? [left, right] : [o])),
      }));
      return;
    }
    const next = splitAt(edit.clips, t, newId("clip"));
    if (next === edit.clips) return;
    change((ed) => ({ ...ed, clips: next }));
  },

  deleteSelection() {
    const sel = selection();
    if (!sel) return false;
    if (sel.kind === "clip") {
      const edit = useEdit.getState().edit;
      if (edit.clips.length <= 1) {
        toast.info("The last clip stays: a video needs at least one.");
        return true;
      }
      change((ed) => ({ ...ed, clips: removeClip(ed.clips, sel.id) }));
      player.seek(Math.min(now(), timelineEnd(useEdit.getState().edit)));
    } else if (sel.kind === "overlay") {
      change((ed) => ({ ...ed, overlays: ed.overlays.filter((o) => o.id !== sel.id) }));
    } else {
      change((ed) => ({ ...ed, audio: ed.audio.filter((a) => a.id !== sel.id) }));
    }
    usePlayback.getState().select(null);
    return true;
  },

  duplicate(sel: Selection | null = selection()) {
    if (!sel) return;
    const edit = useEdit.getState().edit;
    if (sel.kind === "clip") {
      const i = edit.clips.findIndex((c) => c.id === sel.id);
      if (i < 0) return;
      const copy: MainClip = { ...edit.clips[i], id: newId("clip") };
      change((ed) => ({ ...ed, clips: [...ed.clips.slice(0, i + 1), copy, ...ed.clips.slice(i + 1)] }));
      return;
    }
    const list = sel.kind === "overlay" ? edit.overlays : edit.audio;
    const item = list.find((o) => o.id === sel.id);
    if (!item) return;
    const start = item.start + item.duration;
    const copy = { ...item, id: newId("dup"), start, lane: freeLane(list, start, item.duration) };
    if (sel.kind === "overlay") change((ed) => ({ ...ed, overlays: [...ed.overlays, copy as Overlay] }));
    else change((ed) => ({ ...ed, audio: [...ed.audio, copy as AudioClip] }));
  },

  setClipSpeed(id: string, speed: number) {
    change((ed) => ({ ...ed, clips: setSpeed(ed.clips, id, speed) }));
  },

  toggleClip(id: string, field: "muted" | "cameraHidden") {
    change((ed) => ({
      ...ed,
      clips: ed.clips.map((c) => (c.id === id && c.kind === "recording" ? { ...c, [field]: !c[field] } : c)),
    }));
  },

  moveClip(id: string, toIndex: number) {
    change((ed) => ({ ...ed, clips: moveClip(ed.clips, id, toIndex) }));
  },

  /** Picks image, video or audio files and adds each at the playhead. */
  async importMedia(kinds: ("image" | "video" | "audio")[]) {
    const extensions = {
      image: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
      video: ["mp4", "mov", "m4v", "webm"],
      audio: ["mp3", "m4a", "aac", "wav", "ogg"],
    };
    const picked = await open({
      multiple: true,
      filters: [{ name: "Media", extensions: kinds.flatMap((k) => extensions[k]) }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const { videoPath } = useSession.getState();
    for (const path of paths) {
      try {
        const asset = await ipc.assetImport(videoPath, path);
        useSession.getState().addAssetUrl(asset.file, asset.url);
        await addAsset(asset);
      } catch (e) {
        toast.error("Could not add this file", { description: e instanceof Error ? e.message : String(e) });
      }
    }
  },
};

async function addAsset(asset: { id: string; name: string; kind: "image" | "video" | "audio"; file: string; url: string }) {
  const duration = asset.kind === "image" ? null : await probeDuration(asset.kind, asset.url).catch(() => null);
  const record = { id: asset.id, name: asset.name, kind: asset.kind, file: asset.file, duration };
  change((ed) => ({ ...ed, assets: [...ed.assets, record] }));

  if (asset.kind === "audio") {
    const edit = useEdit.getState().edit;
    const start = now();
    const length = Math.max(0.5, Math.min(duration ?? 10, Math.max(1, timelineEnd(edit) - start)));
    const clip: AudioClip = {
      id: newId("aud"),
      lane: freeLane(edit.audio, start, length),
      start,
      duration: length,
      asset: asset.id,
      in: 0,
      volume: 0.6,
      fadeIn: 0.5,
      fadeOut: 1,
    };
    change((ed) => ({ ...ed, audio: [...ed.audio, clip] }));
    usePlayback.getState().select({ kind: "audio", id: clip.id });
    return;
  }

  // Media keep their own aspect; the box is sized against the output.
  const { source } = useSession.getState();
  const out = source ?? { width: 16, height: 9 };
  const natural = await naturalSize(asset.kind, asset.url).catch(() => ({ width: 16, height: 9 }));
  const width = 0.35;
  const height = Math.min(0.9, (width * out.width * natural.height) / natural.width / out.height);
  const base = overlayAt(asset.kind === "video" ? (duration ?? 5) : 4, { width, height, enter: "pop", motion: 0.35 });
  if (asset.kind === "image") addOverlay({ ...base, kind: "image", asset: asset.id, radius: 0.02 });
  else addOverlay({ ...base, kind: "video", asset: asset.id, in: 0, volume: 1, radius: 0.02 });
}

function naturalSize(kind: "image" | "video", url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 16, height: img.naturalHeight || 9 });
      img.onerror = reject;
      img.src = url;
      return;
    }
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve({ width: v.videoWidth || 16, height: v.videoHeight || 9 });
    v.onerror = reject;
    v.src = url;
  });
}
