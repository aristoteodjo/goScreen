import {
  alignToPayoff,
  type Beat,
  beatGrid,
  type MusicPlan,
  musicPlan,
  musicStyleSchema,
  PLAN_SLACK,
  SFX_LENGTHS,
  type SfxKind,
  type SfxLevel,
  sfxBudget,
  type SoundCue,
  type SoundDensity,
  soundDensitySchema,
  soundDesign,
} from "@goscreen/music";
import {
  type AudioClip,
  type BeatMove,
  motionEvents,
  type RecordedPointer,
  snapToBeats,
  type CaptionLook,
  captionOverlays,
  captionsFromWords,
  type EditState,
  isCaptionOverlay,
  isVoiceClip,
  type MainClip,
  MIC_ASSET,
  MUSIC_FADE,
  MUSIC_VOLUME,
  placeClips,
  sequenceDuration,
  type TimedWord,
  srtOf,
  voiceSpans,
  BLANK_ACCENT,
} from "@goscreen/render-engine";
import {
  filmSchema,
  parseWordsFile,
  type Word,
  type WordsFile,
} from "@goscreen/scenario";
import { ipc } from "@/lib/ipc";
import { useSession } from "./session";
import { SILENCE_DEFAULTS, soundRanges } from "./silences";
import { newId, useEdit, usePlayback } from "./store";

// Sound of a montage: where the voice speaks (so music ducks under it),
// the generated bed and effects, and the captions cut from the take's
// words. The pure parts take an edit and give one back; the shell wrappers
// at the end read the open session.

const round = (n: number) => Math.round(n * 1000) / 1000;

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

/**
 * Timeline stretches where a voice speaks: the sounding ranges FFmpeg hears
 * in each voice (the mic under the clips, voice-over takes), on the
 * timeline. Falls back to the clips' spans when a sound cannot be read.
 */
export async function voiceRangesOf(
  edit: EditState,
  hasMic: boolean,
  videoPath: string,
): Promise<[number, number][]> {
  const silencesOf = new Map<
    string,
    Promise<{ start: number; end: number | null }[]>
  >();
  const listen = (file: string) => {
    let hit = silencesOf.get(file);
    if (!hit) {
      hit = ipc.audioSilences(
        videoPath,
        file,
        SILENCE_DEFAULTS.thresholdDb,
        SILENCE_DEFAULTS.minSilence,
      );
      silencesOf.set(file, hit);
    }
    return hit;
  };
  const fine = { pad: 0.05, minSound: 0.25 };
  const out: [number, number][] = [];
  try {
    const { muted, micMuted } = edit.tracks;
    if (hasMic && edit.mic.volume > 0 && !micMuted) {
      const silences = await listen(":mic");
      for (const p of placeClips(edit.clips)) {
        if (p.clip.kind !== "recording" || p.clip.muted) continue;
        const { in: a, out: b, speed } = p.clip;
        for (const [x, y] of soundRanges([a, b], silences, fine))
          out.push([p.start + (x - a) / speed, p.start + (y - a) / speed]);
      }
    }
    for (const clip of edit.audio) {
      if (clip.volume <= 0 || muted.includes(clip.lane)) continue;
      if (!isVoiceClip(edit, clip)) continue;
      const file =
        clip.asset === MIC_ASSET
          ? hasMic
            ? ":mic"
            : null
          : edit.assets.find((a) => a.id === clip.asset)?.file;
      if (!file) continue;
      const silences = await listen(file);
      const ranges = soundRanges(
        [clip.in, clip.in + clip.duration],
        silences,
        fine,
      );
      for (const [x, y] of ranges)
        out.push([clip.start + (x - clip.in), clip.start + (y - clip.in)]);
    }
  } catch {
    return voiceSpans(edit, hasMic);
  }
  return out.map(([a, b]) => [round(a), round(b)]);
}

/** The take's words on the timeline: a word in a cut part is left out, one under two clips shows twice. */
export function timelineWords(clips: MainClip[], words: Word[]): TimedWord[] {
  const out: TimedWord[] = [];
  const placed = placeClips(clips);
  for (const w of words) {
    for (const p of placed) {
      if (p.clip.kind !== "recording") continue;
      const { in: a, out: b, speed } = p.clip;
      if (w.start < a || w.start >= b) continue;
      out.push({
        text: w.text,
        start: round(p.start + (w.start - a) / speed),
        end: round(p.start + (Math.min(w.end, b) - a) / speed),
      });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/** The film's colours and font, or the editor's defaults, for captions. */
export function captionLook(
  edit: EditState,
  over: Partial<Pick<CaptionLook, "color" | "accent" | "font">> = {},
): CaptionLook {
  const parsed = edit.film ? filmSchema.safeParse(edit.film.settings) : null;
  const film = parsed?.success ? parsed.data : null;
  const lane = Math.min(
    19,
    edit.overlays
      .filter((o) => !isCaptionOverlay(o))
      .reduce((m, o) => Math.max(m, o.lane + 1), 0),
  );
  return {
    aspect: edit.aspect,
    font: over.font ?? film?.font ?? "Inter",
    color: over.color ?? "#ffffff",
    accent:
      over.accent ??
      film?.accent ??
      // A white touch colour would hide accent words on white text.
      (edit.touch.color.toLowerCase() === (over.color ?? "#ffffff")
        ? BLANK_ACCENT
        : edit.touch.color),
    lane,
  };
}

/** The montage with captions cut from `words` (timeline time), the old ones replaced. */
export function withCaptions(
  edit: EditState,
  words: TimedWord[],
  look: CaptionLook = captionLook(edit),
): { edit: EditState; count: number } {
  const kept = edit.overlays.filter((o) => !isCaptionOverlay(o));
  const made = captionOverlays(captionsFromWords(words), look);
  return {
    edit: { ...edit, overlays: [...kept, ...made] },
    count: made.length,
  };
}

export type SoundAsset = {
  id: string;
  name: string;
  file: string;
  seconds: number;
};

/**
 * A generated bed on the first free track, from the start to the last
 * spoken word (its fade ends just after it) or the end of the montage,
 * ducked under the voice.
 */
export function withMusic(
  edit: EditState,
  asset: SoundAsset,
  lastWord: number | null,
  id = newId("aud"),
  music?: AudioClip["music"],
): { edit: EditState; clip: AudioClip } {
  const end = sequenceDuration(edit.clips);
  const stop = lastWord !== null ? Math.min(end, lastWord + 0.3) : end;
  const duration = round(Math.max(0.5, Math.min(asset.seconds, stop)));
  const clip: AudioClip = {
    id,
    lane: freeLane(edit.audio, 0, duration),
    start: 0,
    duration,
    asset: asset.id,
    in: 0,
    volume: MUSIC_VOLUME,
    fadeIn: MUSIC_FADE.in,
    fadeOut: Math.min(MUSIC_FADE.out, duration / 2),
    duck: true,
    ...(music ? { music } : {}),
  };
  return { edit: withAsset(edit, asset, clip), clip };
}

/** A sound effect at t; `count` is how many the film then holds (`sfxWarning` judges it). */
export function withSfx(
  edit: EditState,
  asset: SoundAsset,
  kind: SfxKind,
  t: number,
  id = newId("aud"),
): { edit: EditState; clip: AudioClip; count: number } {
  const duration = round(
    Math.min(asset.seconds || SFX_LENGTHS[kind], SFX_LENGTHS[kind]),
  );
  const clip: AudioClip = {
    id,
    lane: freeLane(edit.audio, t, duration),
    start: round(Math.max(0, t)),
    duration,
    asset: asset.id,
    in: 0,
    volume: 0.8,
    fadeIn: 0,
    fadeOut: 0,
    duck: false,
  };
  const next = withAsset(edit, asset, clip);
  const count = next.audio.filter((a) =>
    next.assets.find((x) => x.id === a.asset)?.name.startsWith("SFX "),
  ).length;
  return { edit: next, clip, count };
}

/** The asset added once (a bed rendered twice keeps one record), the clip appended. */
function withAsset(
  edit: EditState,
  asset: SoundAsset,
  clip: AudioClip,
): EditState {
  const known = edit.assets.some((a) => a.id === asset.id);
  return {
    ...edit,
    assets: known
      ? edit.assets
      : [
          ...edit.assets,
          {
            id: asset.id,
            name: asset.name,
            kind: "audio",
            file: asset.file,
            duration: asset.seconds || null,
          },
        ],
    audio: [...edit.audio, clip],
  };
}

/** The film's sound density (`film.sound`), `sparse` when unset. */
export function soundDensityOf(edit: EditState): SoundDensity {
  const parsed = soundDensitySchema.safeParse(
    (edit.film?.settings as { sound?: unknown } | undefined)?.sound,
  );
  return parsed.success ? parsed.data : "sparse";
}

/** What the commands say past the film's effect budget (a density, not a cap). */
export function sfxWarning(
  count: number,
  edit: EditState,
  density = soundDensityOf(edit),
): string | undefined {
  const budget = sfxBudget(sequenceDuration(edit.clips), density);
  return count > budget
    ? `${count} effects for ${Math.round(sequenceDuration(edit.clips))} s at the "${density}" density (about ${budget} read well): beyond that they read as noise. Use "full" for a dynamic product ad, or take some out.`
    : undefined;
}

// --- Automatic sound design -------------------------------------------------

/** Clips laid by the sound design: replaced on every pass. */
export const SFX_AUTO = "sfx-auto-";

/** The asset key of a cue: one file per kind and level. */
export const sfxAssetKey = (kind: SfxKind, level: SfxLevel) =>
  level === "soft" ? `${kind}-soft` : kind;

/** The cues of a montage at a density: every movement, or only cards, clicks and the payoff. */
export function soundCuesOf(
  edit: EditState,
  pointers: RecordedPointer[],
  density: SoundDensity,
  seed = 1,
): SoundCue[] {
  return soundDesign(motionEvents(edit, pointers), { density, seed });
}

/**
 * The montage with the cues laid as `sfx-auto-*` clips (the previous ones
 * removed), each on a free lane, never ducked. `assets` holds the rendered
 * file of every kind and level the cues need (`sfxAssetKey`). The export's
 * own tap sounds go quiet when the design lays its clicks (same sounds twice).
 */
export function withSoundDesign(
  edit: EditState,
  cues: SoundCue[],
  assets: Record<string, SoundAsset>,
): { edit: EditState; count: number } {
  let next: EditState = {
    ...edit,
    audio: edit.audio.filter((a) => !a.id.startsWith(SFX_AUTO)),
  };
  let count = 0;
  cues.forEach((cue, i) => {
    const asset = assets[sfxAssetKey(cue.kind, cue.level)];
    if (!asset) return;
    const duration = round(
      Math.min(asset.seconds || SFX_LENGTHS[cue.kind], SFX_LENGTHS[cue.kind]),
    );
    const clip: AudioClip = {
      id: `${SFX_AUTO}${i + 1}`,
      lane: freeLane(next.audio, cue.t, duration),
      start: cue.t,
      duration,
      asset: asset.id,
      in: 0,
      volume: round(Math.min(1, cue.gain)),
      fadeIn: 0,
      fadeOut: 0,
      duck: false,
    };
    next = withAsset(next, asset, clip);
    count += 1;
  });
  if (cues.some((c) => c.kind === "click"))
    next = { ...next, sound: { ...next.sound, clicks: false } };
  return { edit: next, count };
}

// --- Beat grid of the laid music ----------------------------------------------

export const NO_MUSIC =
  "This montage has no generated music: add one with sound.music (the bed carries its tempo), then snap again.";

/** A bed's name as the renderer writes it: music-<style>-<seed>-<s>s[-p<payoff×10>].wav */
const BED_NAME = /^music-([a-z]+)-(\d+)-(\d+)s(?:-p(\d+))?(?:\.wav)?$/;

/**
 * The plan of a laid bed: from the clip's `music` (style, seed, offset), or
 * read back from its asset's file name. Null when the clip is no generated bed.
 */
export function musicPlanOf(
  edit: EditState,
  clip: AudioClip,
): { plan: MusicPlan; offset: number } | null {
  const asset = edit.assets.find((a) => a.id === clip.asset);
  const m = BED_NAME.exec(asset?.file ?? "") ?? BED_NAME.exec(clip.asset);
  if (clip.music) {
    const style = musicStyleSchema.safeParse(clip.music.style);
    if (!style.success) return null;
    const seconds = m ? Number(m[3]) : Math.ceil(asset?.duration ?? clip.duration);
    return {
      plan: musicPlan(style.data, clip.music.seed, seconds + PLAN_SLACK),
      offset: clip.music.offset,
    };
  }
  if (!m) return null;
  const style = musicStyleSchema.safeParse(m[1]);
  if (!style.success) return null;
  const plan = musicPlan(style.data, Number(m[2]), Number(m[3]) + PLAN_SLACK);
  const offset = m[4] ? alignToPayoff(plan, Number(m[4]) / 10) : 0;
  return { plan, offset };
}

/** The first generated bed of the montage, with its plan; null without one. */
export function musicOf(
  edit: EditState,
): { clip: AudioClip; plan: MusicPlan; offset: number } | null {
  for (const clip of edit.audio) {
    const found = musicPlanOf(edit, clip);
    if (found) return { clip, ...found };
  }
  return null;
}

/** The beats of the laid bed on the timeline. */
export function beatsOf(edit: EditState): Beat[] {
  const music = musicOf(edit);
  if (!music) throw new Error(NO_MUSIC);
  return beatGrid(music.plan, {
    start: music.clip.start,
    duration: music.clip.duration,
    offset: music.offset,
    in: music.clip.in,
  });
}

/** Cards, layers and zooms moved onto the beats of the laid bed. */
export function snappedToMusic(
  edit: EditState,
  tolerance?: number,
): { edit: EditState; moves: BeatMove[]; beats: number; tempo: number } {
  const music = musicOf(edit);
  if (!music) throw new Error(NO_MUSIC);
  const grid = beatsOf(edit);
  const r = snapToBeats(edit, grid, { tolerance });
  return { ...r, beats: grid.length, tempo: music.plan.tempo };
}

export const NO_WORDS =
  "This take has no transcription yet (<stem>.words.json): run edit.transcribe first, then try again.";

/** The take's transcription, validated word by word; null when none exists. */
export async function readWords(videoPath: string): Promise<WordsFile | null> {
  const raw = await ipc.wordsRead(videoPath);
  return raw === null || raw === undefined ? null : parseWordsFile(raw);
}

/** When the last spoken word ends on the timeline, or null without words. */
export function lastWordEnd(
  edit: EditState,
  words: Word[] | null,
): number | null {
  if (!words?.length) return null;
  const on = timelineWords(edit.clips, words);
  return on.length ? Math.max(...on.map((w) => w.end)) : null;
}

// --- Shell: the open montage -----------------------------------------------

const change = (fn: (ed: EditState) => EditState, key?: string) =>
  useEdit.getState().change(fn, key);

function openVideo(): string {
  const { videoPath } = useSession.getState();
  if (!videoPath) throw new Error("No video is open.");
  return videoPath;
}

/** Captions from the take's words, replacing the previous ones; returns how many groups. */
export async function captionsFromTake(): Promise<number> {
  const videoPath = openVideo();
  const file = await readWords(videoPath);
  if (!file || file.words.length === 0) throw new Error(NO_WORDS);
  const edit = useEdit.getState().edit;
  const { edit: next, count } = withCaptions(
    edit,
    timelineWords(edit.clips, file.words),
  );
  change(() => next);
  return count;
}

/** Writes `<stem>.srt` from the take's words as they fall on the timeline. */
export async function writeSubtitles(): Promise<string> {
  const videoPath = openVideo();
  const file = await readWords(videoPath);
  if (!file || file.words.length === 0) throw new Error(NO_WORDS);
  const edit = useEdit.getState().edit;
  return ipc.srtWrite(videoPath, srtOf(timelineWords(edit.clips, file.words)));
}

/** Renders a bed and lays it under the montage. */
export async function addMusic(
  style: string,
  seed = 1,
  payoff: number | null = null,
): Promise<AudioClip> {
  const videoPath = openVideo();
  const edit = useEdit.getState().edit;
  const rendered = await ipc.soundRender(videoPath, {
    kind: "music",
    style,
    seed,
    duration: sequenceDuration(edit.clips),
    payoff,
  });
  useSession.getState().addAssetUrl(rendered.asset.file, rendered.asset.url);
  const words = await readWords(videoPath).catch(() => null);
  const now = useEdit.getState().edit;
  const { edit: next, clip } = withMusic(
    now,
    { ...rendered.asset, seconds: rendered.seconds },
    lastWordEnd(now, words?.words ?? null),
    undefined,
    { style, seed, offset: rendered.offset },
  );
  change(() => next, undefined);
  usePlayback.getState().select({ kind: "audio", id: clip.id });
  return clip;
}

/** Renders the effects the cues need, once per kind and level, into the montage's assets. */
export async function renderSfxAssets(
  videoPath: string,
  cues: SoundCue[],
): Promise<Record<string, SoundAsset>> {
  const out: Record<string, SoundAsset> = {};
  for (const cue of cues) {
    const key = sfxAssetKey(cue.kind, cue.level);
    if (out[key]) continue;
    const rendered = await ipc.soundRender(videoPath, {
      kind: "sfx",
      sfx: cue.kind,
      level: cue.level,
    });
    const s = useSession.getState();
    if (s.videoPath === videoPath)
      s.addAssetUrl(rendered.asset.file, rendered.asset.url);
    out[key] = { ...rendered.asset, seconds: rendered.seconds };
  }
  return out;
}

/** Lays a sound on every movement of the open montage (or only the cards, clicks and payoff). */
export async function designSound(
  density: SoundDensity,
  seed = 1,
): Promise<{ count: number; warning?: string }> {
  const videoPath = openVideo();
  const { pointers } = useSession.getState();
  const cues = soundCuesOf(useEdit.getState().edit, pointers, density, seed);
  const assets = await renderSfxAssets(videoPath, cues);
  const now = useEdit.getState().edit;
  const r = withSoundDesign(
    now,
    soundCuesOf(now, pointers, density, seed),
    assets,
  );
  change(() => r.edit, undefined);
  return { count: r.count, warning: sfxWarning(r.count, r.edit, density) };
}

/** Removes the clips the sound design laid. */
export function clearSoundDesign(): number {
  const before = useEdit.getState().edit.audio.length;
  change((ed) => ({
    ...ed,
    audio: ed.audio.filter((a) => !a.id.startsWith(SFX_AUTO)),
  }));
  return before - useEdit.getState().edit.audio.length;
}

/** Snaps the open montage's cards, layers and zooms to the beats of its bed. */
export function snapOpenToBeats(tolerance?: number): {
  moves: BeatMove[];
  beats: number;
  tempo: number;
} {
  const r = snappedToMusic(useEdit.getState().edit, tolerance);
  if (r.moves.length) change(() => r.edit, undefined);
  return { moves: r.moves, beats: r.beats, tempo: r.tempo };
}

/** Renders an effect and places it at t (the playhead by default). */
export async function addSfx(
  kind: SfxKind,
  t = usePlayback.getState().time,
): Promise<{ clip: AudioClip; count: number }> {
  const videoPath = openVideo();
  const rendered = await ipc.soundRender(videoPath, { kind: "sfx", sfx: kind });
  useSession.getState().addAssetUrl(rendered.asset.file, rendered.asset.url);
  const now = useEdit.getState().edit;
  const r = withSfx(
    now,
    { ...rendered.asset, seconds: rendered.seconds },
    kind,
    t,
  );
  change(() => r.edit, undefined);
  usePlayback.getState().select({ kind: "audio", id: r.clip.id });
  return { clip: r.clip, count: r.count };
}
