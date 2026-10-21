import {
  type AudioClip,
  type EditState,
  type MainClip,
  type Overlay,
  parseEditState,
  type RecordingClip,
  splitAt,
  timelineTimesOf,
  type ZoomSegment,
} from "@goscreen/render-engine";
import {
  clipsFromTakes,
  type Envelope,
  type FaceBox,
  faceZoomsForClips,
  matchTakes,
  type Picked,
  pickTakes,
  qcMarkdown,
  type QcReport,
  qcReport,
  scriptFromWords,
  snapToOnset,
  syncMap,
  takesReport,
  type TakesStats,
  tightCut,
  type Word,
  type WordsFile,
} from "@goscreen/speech";
import { ipc } from "@/lib/ipc";
import { useSession } from "./session";
import { newId } from "./store";

// Talking-head editing: the voice leads, word by word. These helpers are
// the imperative shell around @goscreen/speech (pure): they read and write
// the take's sidecars and return the next montage, which the caller applies
// (an undoable change in the editor, a signed version for the AI).

export const FPS = 30;

/** Transcribes the take, snaps each word on its sound's attack and saves the words. */
export async function transcribeTake(
  videoPath: string,
  options: { model?: string; language?: string } = {},
) {
  const raw = await ipc.mediaTranscribe(videoPath, options);
  const envelope = await ipc.mediaEnvelope(videoPath);
  const words = snapToOnset(raw.words, envelope);
  const moved = words.filter((w, i) => w.start !== raw.words[i].start).length;
  const file: WordsFile = {
    language: raw.language,
    source: "whisper",
    words,
  };
  await ipc.mediaWordsSave(videoPath, file);
  return { language: raw.language, words: words.length, snapped: moved, file };
}

/** The saved words of a take; asks for a transcription when there are none. */
export async function loadWords(videoPath: string): Promise<Word[]> {
  const file = await ipc.mediaWordsLoad(videoPath);
  if (!file || file.words.length === 0)
    throw new Error("This take has no words yet: transcribe it first.");
  return file.words;
}

async function loadEnvelope(videoPath: string): Promise<Envelope | undefined> {
  return (
    (await ipc.mediaEnvelopeLoad(videoPath).catch(() => null)) ?? undefined
  );
}

const recordingClips = (edit: EditState) =>
  edit.clips.filter((c): c is RecordingClip => c.kind === "recording");

/** A recording clip template: the first clip's settings, or defaults. */
function clipLike(edit: EditState): Omit<RecordingClip, "id" | "in" | "out"> {
  const first = recordingClips(edit)[0];
  return {
    kind: "recording",
    speed: 1,
    muted: first?.muted ?? false,
    cameraHidden: first?.cameraHidden ?? false,
    transition: null,
  };
}

function withClips(edit: EditState, clips: MainClip[]): EditState {
  const checked = parseEditState({ ...edit, clips });
  if (!checked) throw new Error("The montage would be invalid.");
  return checked;
}

export type TakesProposal = {
  script: string[];
  words: Word[];
  picked: Picked[];
  stats: TakesStats;
  markdown: string;
};

/** Finds every take of each script line (the script is rebuilt from the words without one). */
export async function proposeTakes(
  videoPath: string,
  script?: string[],
): Promise<TakesProposal> {
  const words = await loadWords(videoPath);
  const lines = (script ?? scriptFromWords(words))
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error("The script is empty.");
  const envelope = await loadEnvelope(videoPath);
  const picked = pickTakes(matchTakes(lines, words), words, { envelope });
  const { markdown, stats } = takesReport(picked, words);
  return { script: lines, words, picked, stats, markdown };
}

/** The montage with one clip per chosen take, in script order; writes takes.md. */
export async function applyTakes(
  videoPath: string,
  edit: EditState,
  proposal: TakesProposal,
): Promise<{ edit: EditState; clips: number; report: string }> {
  const ranges = clipsFromTakes(proposal.picked, 2 / FPS, proposal.words);
  if (ranges.length === 0) throw new Error("No line was found in the words.");
  const like = clipLike(edit);
  const clips: MainClip[] = ranges.map((r) => ({
    ...like,
    id: newId("clip"),
    in: r.in,
    out: r.out,
  }));
  const report = await ipc.mediaSidecarWrite(
    videoPath,
    "takes.md",
    proposal.markdown,
  );
  return { edit: withClips(edit, clips), clips: clips.length, report };
}

/** Cuts every pause longer than minPause out of the recording clips, never inside a word. */
export async function tightCutEdit(
  videoPath: string,
  edit: EditState,
  minPause = 0.15,
) {
  const words = await loadWords(videoPath);
  let pausesCut = 0;
  let removedSeconds = 0;
  const clips: MainClip[] = edit.clips.flatMap((c): MainClip[] => {
    if (c.kind !== "recording") return [c];
    const cut = tightCut([{ in: c.in, out: c.out }], words, {
      minPause,
      handleFrames: 2,
      fps: FPS,
    });
    pausesCut += cut.pausesCut;
    removedSeconds += cut.removedSeconds;
    return cut.clips.map((r, i) => ({
      ...c,
      id: i === 0 ? c.id : newId("clip"),
      in: r.in,
      out: r.out,
      transition: i === 0 ? c.transition : null,
    }));
  });
  return {
    edit: withClips(edit, clips),
    pausesCut,
    removedSeconds,
    clips: clips.length,
  };
}

export type SyncEffect =
  | { kind: "text"; text: string; duration?: number; y?: number; size?: number }
  | { kind: "zoom"; scale?: number; duration?: number; x?: number; y?: number }
  | { kind: "cut" }
  | { kind: "sfx"; asset: string; volume?: number }
  | { kind: "retime"; overlay?: string; zoom?: string };

export type SyncInput = { word: string; nth?: number; effect: SyncEffect };

/** Timeline time of a source time, or null when the montage cut it. */
const timelineOf = (edit: EditState, s: number) =>
  timelineTimesOf(edit.clips, s)[0] ?? null;

/**
 * Places (or moves) each effect on the start of its word: a text, a zoom,
 * a cut, a sound, an existing layer or zoom. Every layer placed this way
 * carries `syncWord`, so the QC can tell whether it still lands on it.
 */
export async function syncMapEdit(
  videoPath: string,
  edit: EditState,
  entries: SyncInput[],
) {
  const words = await loadWords(videoPath);
  const { marks, missing } = syncMap(words, entries);
  let next = edit;
  const placed: { word: string; nth: number; t: number; item: string }[] = [];
  const skipped: string[] = [];
  const nextLane = () =>
    Math.min(20, Math.max(-1, ...next.overlays.map((o) => o.lane)) + 1);
  for (const mark of marks) {
    const effect = mark.effect as SyncEffect;
    const sync = { word: mark.word, nth: mark.nth };
    const at = timelineOf(next, mark.t);
    if (effect.kind === "cut" || effect.kind === "zoom") {
      if (effect.kind === "cut") {
        if (at === null) {
          skipped.push(`${mark.word}: cut away`);
          continue;
        }
        const clips = splitAt(next.clips, at, newId("clip"));
        if (clips === next.clips) {
          skipped.push(`${mark.word}: too close to a cut`);
          continue;
        }
        next = { ...next, clips };
        placed.push({ ...sync, t: at, item: "cut" });
        continue;
      }
      const zoom: ZoomSegment = {
        id: newId("zoom"),
        start: mark.t,
        end: mark.t + (effect.duration ?? 1.5),
        scale: effect.scale ?? 1.3,
        focus: { x: effect.x ?? 0.5, y: effect.y ?? 0.4 },
      };
      next = { ...next, zooms: [...next.zooms, zoom] };
      placed.push({ ...sync, t: mark.t, item: zoom.id });
      continue;
    }
    if (at === null) {
      skipped.push(`${mark.word}: cut away`);
      continue;
    }
    if (effect.kind === "text") {
      const size = effect.size ?? 0.07;
      const o: Overlay = {
        id: newId("text"),
        kind: "text",
        lane: nextLane(),
        start: at,
        duration: effect.duration ?? 2,
        x: 0.5,
        y: effect.y ?? 0.78,
        width: 0.8,
        height: size * 2,
        rotation: 0,
        opacity: 1,
        enter: "pop",
        exit: "fade",
        motion: 0.3,
        text: effect.text,
        style: {
          font: "Inter",
          size,
          weight: 800,
          color: "#ffffff",
          align: "center",
          background: null,
          shadow: 0.5,
        },
        syncWord: sync,
      };
      next = { ...next, overlays: [...next.overlays, o] };
      placed.push({ ...sync, t: at, item: o.id });
    } else if (effect.kind === "sfx") {
      const asset = next.assets.find((a) => a.id === effect.asset);
      if (asset?.kind !== "audio") {
        skipped.push(`${mark.word}: no audio asset ${effect.asset}`);
        continue;
      }
      const lane = Math.max(0, ...next.audio.map((a) => a.lane + 1));
      const clip: AudioClip = {
        id: newId("aud"),
        lane: Math.min(20, lane),
        start: at,
        duration: asset.duration ?? 1,
        asset: asset.id,
        in: 0,
        volume: effect.volume ?? 1,
        fadeIn: 0,
        fadeOut: 0.05,
      };
      next = { ...next, audio: [...next.audio, clip] };
      placed.push({ ...sync, t: at, item: clip.id });
    } else if (effect.kind === "retime") {
      if (effect.overlay) {
        const o = next.overlays.find((x) => x.id === effect.overlay);
        if (!o) {
          skipped.push(`${mark.word}: no layer ${effect.overlay}`);
          continue;
        }
        next = {
          ...next,
          overlays: next.overlays.map((x) =>
            x.id === o.id ? { ...x, start: at, syncWord: sync } : x,
          ),
        };
        placed.push({ ...sync, t: at, item: o.id });
      } else if (effect.zoom) {
        const z = next.zooms.find((x) => x.id === effect.zoom);
        if (!z) {
          skipped.push(`${mark.word}: no zoom ${effect.zoom}`);
          continue;
        }
        const length = z.end - z.start;
        next = {
          ...next,
          zooms: next.zooms.map((x) =>
            x.id === z.id ? { ...x, start: mark.t, end: mark.t + length } : x,
          ),
        };
        placed.push({ ...sync, t: mark.t, item: z.id });
      } else skipped.push(`${mark.word}: retime needs overlay or zoom`);
    }
  }
  const checked = parseEditState(next);
  if (!checked) throw new Error("The montage would be invalid.");
  return {
    edit: checked,
    placed,
    missing,
    skipped,
  };
}

/** Eyes (and face boxes) at the start of each recording clip, in source time. */
async function facesOf(videoPath: string, edit: EditState) {
  const clips = recordingClips(edit);
  const times = clips.map((c) => Math.min(c.in + 0.1, (c.in + c.out) / 2));
  if (times.length === 0) return { eyes: [], boxes: [] as FaceBox[], found: 0 };
  const samples = await ipc.mediaFaceEyes(videoPath, times);
  const eyes = samples.flatMap((s) =>
    s.eyes ? [{ t: s.t, u: s.eyes.u, v: s.eyes.v }] : [],
  );
  const boxes: FaceBox[] = samples.flatMap((s) =>
    s.face ? [{ t: s.t, ...s.face }] : [],
  );
  return { eyes, boxes, found: eyes.length };
}

/** Wide and close framings alternating at every cut, close ones on the eyes. */
export async function faceZoomsEdit(videoPath: string, edit: EditState) {
  const clips = recordingClips(edit);
  if (clips.length === 0) throw new Error("No recording clip to frame.");
  const { eyes, found } = await facesOf(videoPath, edit);
  const session = useSession.getState();
  const sourceHeight =
    session.videoPath === videoPath ? session.source?.height : undefined;
  const zooms = faceZoomsForClips(
    clips.map((c) => ({ in: c.in, out: c.out })),
    eyes,
    { sourceHeight },
  );
  const next = parseEditState({
    ...edit,
    zooms: [...edit.zooms.filter((z) => !z.id.startsWith("face-")), ...zooms],
  });
  if (!next) throw new Error("The montage would be invalid.");
  return { edit: next, zooms: zooms.length, clips: clips.length, faces: found };
}

/** The QC table of a montage; face boxes come from the camera when it can be read. */
export async function qcEdit(
  videoPath: string,
  edit: EditState,
  options: { loop?: boolean; safeZone?: number } = {},
): Promise<{ report: QcReport; markdown: string; file: string }> {
  const words = (await ipc.mediaWordsLoad(videoPath))?.words ?? [];
  const boxes = await facesOf(videoPath, edit)
    .then((f) => f.boxes)
    .catch(() => [] as FaceBox[]);
  const report = qcReport(edit, words, {
    faceBoxes: boxes,
    fps: FPS,
    toleranceFrames: 2,
    safeZone: options.safeZone ?? 0.05,
    loop: options.loop,
  });
  const markdown = qcMarkdown(report);
  const file = await ipc.mediaSidecarWrite(videoPath, "qc.md", markdown);
  return { report, markdown, file };
}
