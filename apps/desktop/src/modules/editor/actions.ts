import {
  type Animation,
  type AudioClip,
  buildAutoZooms,
  clipAt,
  DEFAULT_EDIT,
  type EditState,
  energize,
  type LayerEdit,
  type MainClip,
  MIC_ASSET,
  moveClip,
  type Overlay,
  type OverlayBase,
  placeClips,
  placeZoom,
  removeClip,
  type ShapeKind,
  type SlideClip,
  setSpeed,
  sourceTimeAt,
  splitAt,
  type TextOverlay,
  type Transition,
  timelineTimesOf,
} from "@goscreen/render-engine";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { alignScenesToVoice, phrasesOf } from "@goscreen/scenario";
import { ipc } from "@/lib/ipc";
import { probeDuration } from "./media";
import { player, useSession } from "./session";
import {
  SILENCE_DEFAULTS,
  type SilenceOptions,
  soundRanges,
  stripSilences,
  trimSilentEnds,
} from "./silences";
import {
  newId,
  type Selection,
  timelineEnd,
  useEdit,
  usePlayback,
} from "./store";

const change = (fn: (ed: EditState) => EditState, key?: string) =>
  useEdit.getState().change(fn, key);
const now = () => usePlayback.getState().time;
const selection = () => usePlayback.getState().selection;

/** First lane where [start, start + duration) is free. */
function freeLane(
  items: { lane: number; start: number; duration: number }[],
  start: number,
  duration: number,
) {
  for (let lane = 0; lane < 20; lane += 1) {
    const busy = items.some(
      (o) =>
        o.lane === lane &&
        o.start < start + duration &&
        start < o.start + o.duration,
    );
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

export const TEXT_PRESETS: {
  id: string;
  label: string;
  enter: Animation;
  patch: Partial<TextOverlay>;
}[] = [
  {
    id: "title",
    label: "Title",
    enter: "words",
    patch: { y: 0.18, width: 0.8, height: 0.14 },
  },
  {
    id: "caption",
    label: "Caption",
    enter: "slide-up",
    patch: { y: 0.86, width: 0.7, height: 0.08 },
  },
  {
    id: "typewriter",
    label: "Typewriter",
    enter: "typewriter",
    patch: { y: 0.5, width: 0.6, height: 0.1 },
  },
];

export const editActions = {
  /** A zoom on this point of the frame (fractions), around the playhead. */
  zoomHere(at: { x: number; y: number }) {
    const ed = useEdit.getState().edit;
    const s = sourceTimeAt(ed.clips, now());
    if (s === null) {
      toast.error("Zooms follow the recording: put the playhead on a clip.");
      return;
    }
    const slot = placeZoom(ed.zooms, s, usePlayback.getState().duration);
    if (!slot) {
      toast.error("A zoom is already running here.");
      return;
    }
    const id = newId("zoom");
    change((e) => ({
      ...e,
      zooms: [...e.zooms, { id, ...slot, scale: 1.8, focus: at }],
    }));
    usePlayback.getState().selectZoom(id);
  },

  /** Replaces every zoom with one per burst of clicks. */
  autoZoom() {
    const { pointers } = useSession.getState();
    const zooms = buildAutoZooms(pointers, usePlayback.getState().duration);
    if (zooms.length === 0) {
      toast.error("No click to zoom on.");
      return;
    }
    change((ed) => ({ ...ed, zooms }));
    usePlayback.getState().selectZoom(null);
  },

  /** Adds a movement wherever nothing changes for 2 s (undoable). */
  energize() {
    const { edit: next, changes } = energize(useEdit.getState().edit);
    if (changes.length === 0) {
      toast.message("Nothing stands still for more than 2 s already.");
      return;
    }
    change(() => next);
    const kinds = new Map<string, number>();
    for (const c of changes) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
    toast.success(
      `Energized: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ")}.`,
    );
  },

  clearZooms() {
    change((ed) => ({ ...ed, zooms: [] }));
    usePlayback.getState().selectZoom(null);
  },

  /** One caption per recorded scene (scenario takes), where it plays. */
  captionScenes() {
    const { chapters } = useSession.getState();
    const ed = useEdit.getState().edit;
    const have = new Set(
      ed.overlays.flatMap((o) => (o.kind === "text" ? [o.text] : [])),
    );
    const added: Overlay[] = [];
    for (const c of chapters) {
      if (!c.caption || have.has(c.caption)) continue;
      const [t] = timelineTimesOf(ed.clips, c.start + 0.01);
      if (t === undefined) continue;
      const duration = Math.max(0.5, c.end - c.start);
      added.push({
        ...overlayAt(duration, {
          start: t,
          duration,
          lane: freeLane([...ed.overlays, ...added], t, duration),
          y: 0.085,
          width: 0.88,
          height: 0.11,
          enter: "spring",
          motion: 0.45,
        }),
        kind: "text",
        text: c.caption,
        style: {
          font: "Inter",
          size: 0.042,
          weight: 800,
          color: "#ffffff",
          align: "center",
          background: null,
        },
      } as TextOverlay);
    }
    if (added.length === 0) {
      toast.error("No scene caption to add (none recorded, or already there).");
      return;
    }
    change((e) => ({ ...e, overlays: [...e.overlays, ...added] }));
    toast.success(
      `${added.length} caption${added.length > 1 ? "s" : ""} added`,
    );
  },

  /** `at` places it where the user right-clicked (fractions of the output). */
  addText(preset = TEXT_PRESETS[0], at?: { x: number; y: number }) {
    const big = preset.id === "title";
    addOverlay({
      ...overlayAt(3, {
        ...preset.patch,
        ...at,
        enter: preset.enter,
        motion: big ? 0.9 : 0.5,
      }),
      kind: "text",
      text: big
        ? "Your headline"
        : preset.id === "caption"
          ? "Add a caption"
          : "Type something…",
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

  /** A blur box at the playhead, to hide sensitive data; drag it over the spot. */
  addBlur(mode: "blur" | "pixelate" = "blur", at?: { x: number; y: number }) {
    addOverlay({
      ...overlayAt(4, {
        width: 0.25,
        height: 0.08,
        ...at,
        enter: "fade",
        exit: "fade",
        motion: 0.2,
      }),
      kind: "blur",
      mode,
      strength: mode === "blur" ? 0.02 : 0.018,
      radius: 0.01,
    });
  },

  /** A title card cut in at the playhead (or appended at the end). */
  addSlide() {
    const edit = useEdit.getState().edit;
    const slide: SlideClip = {
      id: newId("slide"),
      kind: "slide",
      duration: 3,
      background:
        edit.background.kind === "none"
          ? DEFAULT_EDIT.background
          : edit.background,
      title: "Introducing our app",
      subtitle: "Faster, simpler, yours",
      color: "#ffffff",
      font: "Inter",
      animation: "words",
      transition: { kind: "fade", duration: 0.6 },
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
    // The clip after the slide fades back in: the slide reads as a transition.
    const after = clips[index];
    const rest =
      after && !after.transition
        ? [
            { ...after, transition: { kind: "fade" as const, duration: 0.6 } },
            ...clips.slice(index + 1),
          ]
        : clips.slice(index);
    const next = [...clips.slice(0, index), slide, ...rest];
    change((ed) => ({ ...ed, clips: next }));
    usePlayback.getState().select({ kind: "clip", id: slide.id });
  },

  splitAtPlayhead() {
    editActions.splitAt(now(), selection());
  },

  /** Cuts at timeline time t: the given overlay or audio clip, else the main track. */
  splitAt(t: number, sel: Selection | null) {
    const edit = useEdit.getState().edit;
    // A selected overlay or audio clip splits itself; otherwise the main track.
    if (sel?.kind === "overlay" || sel?.kind === "audio") {
      const list = sel.kind === "overlay" ? edit.overlays : edit.audio;
      const item = list.find((o) => o.id === sel.id);
      if (
        !item ||
        t <= item.start + 0.1 ||
        t >= item.start + item.duration - 0.1
      )
        return;
      const cut = t - item.start;
      const left = { ...item, duration: cut };
      const right = {
        ...item,
        id: newId(sel.kind === "overlay" ? "ovl" : "aud"),
        start: t,
        duration: item.duration - cut,
      };
      if ("in" in right) (right as { in: number }).in += cut;
      const key = sel.kind === "overlay" ? "overlays" : "audio";
      change((ed) => ({
        ...ed,
        [key]: (ed[key] as (Overlay | AudioClip)[]).flatMap((o) =>
          o.id === item.id ? [left, right] : [o],
        ),
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
      change((ed) => ({
        ...ed,
        overlays: ed.overlays.filter((o) => o.id !== sel.id),
      }));
    } else {
      change((ed) => ({
        ...ed,
        audio: ed.audio.filter((a) => a.id !== sel.id),
      }));
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
      change((ed) => ({
        ...ed,
        clips: [...ed.clips.slice(0, i + 1), copy, ...ed.clips.slice(i + 1)],
      }));
      return;
    }
    const list = sel.kind === "overlay" ? edit.overlays : edit.audio;
    const item = list.find((o) => o.id === sel.id);
    if (!item) return;
    const start = item.start + item.duration;
    const copy = {
      ...item,
      id: newId("dup"),
      start,
      lane: freeLane(list, start, item.duration),
    };
    if (sel.kind === "overlay")
      change((ed) => ({ ...ed, overlays: [...ed.overlays, copy as Overlay] }));
    else change((ed) => ({ ...ed, audio: [...ed.audio, copy as AudioClip] }));
  },

  /** Sets (or clears, with null) how a clip comes in over the one before it. */
  setTransition(id: string, transition: Transition | null) {
    change((ed) => ({
      ...ed,
      clips: ed.clips.map((c) => (c.id === id ? { ...c, transition } : c)),
    }));
  },

  /**
   * Detaches the voice from the video: the mic under each recording clip
   * becomes a free audio clip (move, cut, fade it on its own) and the
   * attached mic goes silent. Clips played at another speed keep theirs.
   */
  detachAudio() {
    const edit = useEdit.getState().edit;
    const clips: AudioClip[] = [];
    // The voice gets a new lane below any music, so lane switches keep their meaning.
    const lane = edit.audio.length
      ? Math.max(...edit.audio.map((a) => a.lane)) + 1
      : 0;
    for (const p of placeClips(edit.clips)) {
      if (p.clip.kind !== "recording" || p.clip.speed !== 1 || p.clip.muted)
        continue;
      clips.push({
        id: newId("voice"),
        lane,
        start: p.start,
        duration: p.end - p.start,
        asset: MIC_ASSET,
        in: p.clip.in,
        volume: edit.mic.volume,
        fadeIn: 0,
        fadeOut: 0,
      });
    }
    if (clips.length === 0) {
      toast.info(
        "Nothing to detach: no clip plays the microphone at normal speed.",
      );
      return;
    }
    change((ed) => ({
      ...ed,
      audio: [...ed.audio, ...clips],
      tracks: { ...ed.tracks, micMuted: true },
    }));
    usePlayback.getState().select({ kind: "audio", id: clips[0].id });
  },

  /** Puts the voice back under the video and removes the detached clips. */
  reattachAudio() {
    change((ed) => ({
      ...ed,
      audio: ed.audio.filter((a) => a.asset !== MIC_ASSET),
      tracks: { ...ed.tracks, micMuted: false },
    }));
  },

  /** Changes one recorded device (model, finish, frame...) from anywhere. */
  setLayer(instanceId: string, patch: Partial<LayerEdit>) {
    change((ed) => ({
      ...ed,
      layers:
        ed.layers?.map((l) =>
          l.instanceId === instanceId ? { ...l, ...patch } : l,
        ) ?? null,
    }));
  },

  /** Moves an overlay one lane up (in front) or down (behind). */
  moveOverlayLane(id: string, by: 1 | -1) {
    change((ed) => ({
      ...ed,
      overlays: ed.overlays.map((o) =>
        o.id === id ? { ...o, lane: Math.max(0, o.lane + by) } : o,
      ),
    }));
  },

  /** Switches a device track on or off. */
  setLayerHidden(instanceId: string, hidden: boolean) {
    change((ed) => ({
      ...ed,
      layers:
        ed.layers?.map((l) =>
          l.instanceId === instanceId ? { ...l, hidden } : l,
        ) ?? null,
    }));
  },

  /** Only this device shows: for a close-up or a user test of one device. */
  soloLayer(instanceId: string) {
    change((ed) => ({
      ...ed,
      layers:
        ed.layers?.map((l) => ({
          ...l,
          hidden: l.instanceId !== instanceId,
        })) ?? null,
    }));
  },

  showAllLayers() {
    change((ed) => ({
      ...ed,
      layers: ed.layers?.map((l) => ({ ...l, hidden: false })) ?? null,
    }));
  },

  setClipSpeed(id: string, speed: number) {
    change((ed) => ({ ...ed, clips: setSpeed(ed.clips, id, speed) }));
  },

  toggleClip(id: string, field: "muted" | "cameraHidden") {
    change((ed) => ({
      ...ed,
      clips: ed.clips.map((c) =>
        c.id === id && c.kind === "recording"
          ? { ...c, [field]: !c[field] }
          : c,
      ),
    }));
  },

  moveClip(id: string, toIndex: number) {
    change((ed) => ({ ...ed, clips: moveClip(ed.clips, id, toIndex) }));
  },

  /** Adds a project asset at `at` (the playhead by default). */
  async placeAsset(id: string, at?: number) {
    const edit = useEdit.getState().edit;
    const asset = edit.assets.find((a) => a.id === id);
    const url = asset ? useSession.getState().assetUrls[asset.file] : undefined;
    if (!asset || !url) return;
    if (at !== undefined) player.seek(at);
    await placeAsset(asset, url);
  },

  /** Picks image, video or audio files; adds each at the playhead, or only to the project. */
  async importMedia(
    kinds: ("image" | "video" | "audio")[],
    { place = true }: { place?: boolean } = {},
  ) {
    const extensions = {
      image: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
      video: ["mp4", "mov", "m4v", "webm"],
      audio: ["mp3", "m4a", "aac", "wav", "ogg"],
    };
    const picked = await open({
      multiple: true,
      filters: [
        { name: "Media", extensions: kinds.flatMap((k) => extensions[k]) },
      ],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const { videoPath } = useSession.getState();
    for (const path of paths) {
      try {
        const asset = await ipc.assetImport(videoPath, path);
        useSession.getState().addAssetUrl(asset.file, asset.url);
        await addAsset(asset, place);
      } catch (e) {
        toast.error("Could not add this file", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    }
  },
};

/** A recorded voice-over: its file joins the assets, its clip the audio lanes. */
export function addVoiceOver(
  asset: { id: string; name: string; file: string; url: string },
  place: { start: number; in: number; duration: number },
) {
  useSession.getState().addAssetUrl(asset.file, asset.url);
  const edit = useEdit.getState().edit;
  const takes = edit.assets.filter((a) =>
    a.name.startsWith("Voice-over"),
  ).length;
  const name = takes ? `Voice-over ${takes + 1}` : "Voice-over";
  const duration = Math.max(0.2, place.duration);
  const clip: AudioClip = {
    id: newId("aud"),
    lane: freeLane(edit.audio, place.start, duration),
    start: place.start,
    duration,
    asset: asset.id,
    in: place.in,
    volume: 1,
    fadeIn: 0.05,
    fadeOut: 0.15,
  };
  change(
    (ed) => ({
      ...ed,
      assets: [
        ...ed.assets,
        {
          id: asset.id,
          name,
          kind: "audio",
          file: asset.file,
          duration: place.in + duration,
        },
      ],
      audio: [...ed.audio, clip],
    }),
    "voice-over",
  );
  usePlayback.getState().select({ kind: "audio", id: clip.id });
  return clip.id;
}

export type SilenceMode = "strip" | "trim";

/**
 * Cuts the pauses of an audio clip ("strip": every pause, "trim": only before
 * the first word and after the last). The pieces keep their time, so a voice
 * stays in sync with the picture. Returns how many pieces remain.
 */
export async function cleanSilences(
  clipId: string,
  mode: SilenceMode,
  options: Partial<SilenceOptions> = {},
): Promise<number> {
  const { videoPath } = useSession.getState();
  const edit = useEdit.getState().edit;
  const clip = edit.audio.find((a) => a.id === clipId);
  if (!videoPath || !clip)
    throw new Error("This sound is no longer in the edit.");
  const file =
    clip.asset === MIC_ASSET
      ? ":mic"
      : edit.assets.find((a) => a.id === clip.asset)?.file;
  if (!file) throw new Error("This sound's file is missing.");
  const o = { ...SILENCE_DEFAULTS, ...options };
  const silences = await ipc.audioSilences(
    videoPath,
    file,
    o.thresholdDb,
    o.minSilence,
  );
  // The clip may have moved while FFmpeg listened.
  const now = useEdit.getState().edit.audio.find((a) => a.id === clipId);
  if (!now) throw new Error("This sound is no longer in the edit.");
  const pieces =
    mode === "strip"
      ? stripSilences(now, silences, o, () => newId("aud"))
      : [trimSilentEnds(now, silences, o)].filter(
          (c): c is AudioClip => c !== null,
        );
  if (pieces.length === 0)
    throw new Error("Only silence was found: lower the threshold.");
  change((ed) => ({
    ...ed,
    audio: ed.audio.flatMap((a) => (a.id === clipId ? pieces : [a])),
  }));
  usePlayback.getState().select({ kind: "audio", id: pieces[0].id });
  return pieces.length;
}

/**
 * The voice leads the cut: each recording scene is given the length of its
 * phrase in this voice clip, so scene changes land on the attack of a
 * sentence (the course's rule). Returns how many scenes were aligned.
 */
export async function alignToVoice(clipId: string): Promise<number> {
  const { videoPath, video } = useSession.getState();
  const duration =
    video && Number.isFinite(video.duration) ? video.duration : undefined;
  const edit = useEdit.getState().edit;
  const clip = edit.audio.find((a) => a.id === clipId);
  if (!videoPath || !clip)
    throw new Error("This sound is no longer in the edit.");
  const file =
    clip.asset === MIC_ASSET
      ? ":mic"
      : edit.assets.find((a) => a.id === clip.asset)?.file;
  if (!file) throw new Error("This sound's file is missing.");
  const o = SILENCE_DEFAULTS;
  const silences = await ipc.audioSilences(
    videoPath,
    file,
    o.thresholdDb,
    o.minSilence,
  );
  const ranges = soundRanges(
    [clip.in, clip.in + clip.duration],
    silences,
    { pad: 0.05, minSound: 0.25 },
  );
  const phrases = phrasesOf(ranges, clip);
  if (phrases.length === 0)
    throw new Error("No phrase was heard in this sound.");
  const before = useEdit.getState().edit;
  const after = alignScenesToVoice(before, phrases, duration);
  const scenes = before.clips.filter((c) => c.kind === "recording").length;
  change(() => after, undefined);
  return Math.min(scenes, phrases.length);
}

async function addAsset(
  asset: {
    id: string;
    name: string;
    kind: "image" | "video" | "audio";
    file: string;
    url: string;
  },
  place = true,
) {
  const duration =
    asset.kind === "image"
      ? null
      : await probeDuration(asset.kind, asset.url).catch(() => null);
  const record = {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    file: asset.file,
    duration,
  };
  change((ed) => ({ ...ed, assets: [...ed.assets, record] }));
  if (place) await placeAsset(record, asset.url);
}

/** Puts a project asset on the timeline at the playhead (a new use of it). */
async function placeAsset(
  asset: {
    id: string;
    kind: "image" | "video" | "audio";
    duration: number | null;
  },
  url: string,
) {
  const duration = asset.duration;
  if (asset.kind === "audio") {
    const edit = useEdit.getState().edit;
    const start = now();
    const length = Math.max(
      0.5,
      Math.min(duration ?? 10, Math.max(1, timelineEnd(edit) - start)),
    );
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
  const natural = await naturalSize(asset.kind, url).catch(() => ({
    width: 16,
    height: 9,
  }));
  const width = 0.35;
  const height = Math.min(
    0.9,
    (width * out.width * natural.height) / natural.width / out.height,
  );
  const base = overlayAt(asset.kind === "video" ? (duration ?? 5) : 4, {
    width,
    height,
    enter: "pop",
    motion: 0.35,
  });
  if (asset.kind === "image")
    addOverlay({ ...base, kind: "image", asset: asset.id, radius: 0.02 });
  else
    addOverlay({
      ...base,
      kind: "video",
      asset: asset.id,
      in: 0,
      volume: 1,
      radius: 0.02,
    });
}

export function naturalSize(
  kind: "image" | "video",
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () =>
        resolve({
          width: img.naturalWidth || 16,
          height: img.naturalHeight || 9,
        });
      img.onerror = reject;
      img.src = url;
      return;
    }
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "metadata";
    v.onloadedmetadata = () =>
      resolve({ width: v.videoWidth || 16, height: v.videoHeight || 9 });
    v.onerror = reject;
    v.src = url;
  });
}
