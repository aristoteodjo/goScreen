import {
  MUSIC_STYLES,
  pickStyle,
  type SoundDensity,
  SFX_KINDS,
  SFX_LEVELS,
  SOUND_DENSITIES,
  STYLE_SPECS,
} from "@goscreen/music";
import {
  type EditState,
  isCaptionOverlay,
  parseRecordingFile,
  sequenceDuration,
  srtOf,
} from "@goscreen/render-engine";
import { z } from "zod";
import { ipc } from "@/lib/ipc";
import { useSession } from "@/modules/editor/session";
import {
  captionLook,
  lastWordEnd,
  NO_WORDS,
  readWords,
  renderSfxAssets,
  SFX_AUTO,
  sfxWarning,
  snappedToMusic,
  soundCuesOf,
  soundDensityOf,
  timelineWords,
  withCaptions,
  withMusic,
  withSfx,
  withSoundDesign,
} from "@/modules/editor/sound";
import { defineCommand } from "./registry";

// Sound for an AI: a generated bed chosen by tone, sober effects, captions
// and subtitles cut from the take's words, the loudness of a file. Same
// functions as the editor's buttons; every change is a version the person
// can undo.

type EditAccess = {
  currentEdit: (video: string) => Promise<EditState>;
  applyEdit: (video: string, edit: EditState) => Promise<void>;
};

const video = z
  .string()
  .min(1)
  .describe("Absolute path of a video (projects.videos)");

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** The editor learns a new asset's URL when the video is open. */
function announce(videoPath: string, asset: { file: string; url: string }) {
  const s = useSession.getState();
  if (s.videoPath === videoPath) s.addAssetUrl(asset.file, asset.url);
}

let access: EditAccess | null = null;

/** Lays the sound design on a video at a density (what edit.soundDesign and edit.setFilm share). */
export async function designSoundFor(
  video: string,
  density: SoundDensity,
  seed: number,
  replace = true,
) {
  if (!access) throw new Error("Sound commands are not registered.");
  const { currentEdit, applyEdit } = access;
  const edit = await currentEdit(video);
  const opened = await ipc.recordingOpen(video);
  const pointers = parseRecordingFile(opened.interactions).pointers;
  const cues = soundCuesOf(edit, pointers, density, seed);
  const assets = await renderSfxAssets(video, cues);
  const now = await currentEdit(video);
  const base = replace
    ? now
    : {
        ...now,
        audio: now.audio.map((a) =>
          a.id.startsWith(SFX_AUTO) ? { ...a, id: `sfx-kept-${a.id}` } : a,
        ),
      };
  const r = withSoundDesign(base, soundCuesOf(now, pointers, density, seed), assets);
  await applyEdit(video, r.edit);
  return {
    sounds: r.count,
    density,
    cues: cues.map((c) => ({
      t: c.t,
      kind: c.kind,
      level: c.level,
      gain: c.gain,
      on: c.event,
      item: c.item,
    })),
    warning: sfxWarning(r.count, r.edit, density),
  };
}

export function registerSoundCommands({ currentEdit, applyEdit }: EditAccess) {
  access = { currentEdit, applyEdit };
  defineCommand({
    name: "sound.styles",
    title: "List music styles",
    description:
      "The six generated beds (synthesised in code, nothing to license): id, label, tempo and mood. Pick one with sound.music.",
    input: z.object({}),
    run: async () => ({
      styles: MUSIC_STYLES.map((id) => ({
        id,
        label: STYLE_SPECS[id].label,
        tempo: STYLE_SPECS[id].tempo,
        mode: STYLE_SPECS[id].mode,
      })),
      effects: SFX_KINDS,
    }),
  });

  defineCommand({
    name: "sound.music",
    title: "Add a generated music bed",
    description:
      'Renders a music bed for the whole montage and lays it on a free audio track at a level under the voice, ducked while someone speaks, fading in 0.4 s and out 1.2 s, ending on the last spoken word when the take has a transcription. `style` (sound.styles) or `tone`/`genre` (campaign words, e.g. "playful", "explainer") choose the bed; `seed` varies it; `payoff` (timeline seconds) makes the bed open up (its full section) at that moment. Returns the clip.',
    input: z.object({
      video,
      style: z.enum(MUSIC_STYLES).optional(),
      tone: z.string().optional(),
      genre: z.string().optional(),
      seed: z.number().int().min(0).max(1_000_000).default(1),
      payoff: z.number().min(0).optional(),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const style = i.style ?? pickStyle(i.tone, i.genre);
      const rendered = await ipc.soundRender(i.video, {
        kind: "music",
        style,
        seed: i.seed,
        duration: sequenceDuration(edit.clips),
        payoff: i.payoff ?? null,
      });
      announce(i.video, rendered.asset);
      const words = await readWords(i.video).catch(() => null);
      const now = await currentEdit(i.video);
      const { edit: next, clip } = withMusic(
        now,
        { ...rendered.asset, seconds: rendered.seconds },
        lastWordEnd(now, words?.words ?? null),
        undefined,
        { style, seed: i.seed, offset: rendered.offset },
      );
      await applyEdit(i.video, next);
      return {
        item: clip.id,
        asset: rendered.asset.id,
        style,
        offset: rendered.offset,
        tempo: STYLE_SPECS[style].tempo,
        duration: clip.duration,
        volume: clip.volume,
      };
    },
  });

  defineCommand({
    name: "edit.addSfx",
    title: "Add a sound effect",
    description: `Places one synthesised effect (${SFX_KINDS.join(", ")}; level soft|full) at timeline time t. For a sound on every movement use edit.soundDesign instead. The answer warns past the film's density (film.sound: sparse ≈ 12 a minute, full ≈ 180).`,
    input: z.object({
      video,
      kind: z.enum(SFX_KINDS),
      level: z.enum(SFX_LEVELS).default("full"),
      t: z.number().min(0),
    }),
    run: async (i) => {
      const rendered = await ipc.soundRender(i.video, {
        kind: "sfx",
        sfx: i.kind,
        level: i.level,
      });
      announce(i.video, rendered.asset);
      const edit = await currentEdit(i.video);
      const r = withSfx(
        edit,
        { ...rendered.asset, seconds: rendered.seconds },
        i.kind,
        i.t,
      );
      await applyEdit(i.video, r.edit);
      return {
        item: r.clip.id,
        count: r.count,
        warning: sfxWarning(r.count, r.edit),
      };
    },
  });

  defineCommand({
    name: "edit.soundDesign",
    title: "A sound on every movement",
    description:
      'Lays synthesised effects on the montage\'s movements, as the reference SaaS ads do: "full" puts one on each (whoosh on an entrance, swish on an exit, pop on a pop, click on a click, tick on each step of a counter, sparkle on a title, impact on a card, riser then drop into the last card); "sparse" keeps only cards, clicks and the payoff (a spoken piece). Never two identical sounds within 0.15 s; gain by importance. Clips sfx-auto-* are replaced on every pass (density "none" removes them). Returns the cues laid. Default density: film.sound, else sparse.',
    input: z.object({
      video,
      density: z.enum([...SOUND_DENSITIES, "none"]).optional(),
      seed: z.number().int().min(0).max(1_000_000).default(1),
      replace: z.boolean().default(true),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const density = i.density ?? soundDensityOf(edit);
      if (density === "none") {
        const kept = edit.audio.filter((a) => !a.id.startsWith(SFX_AUTO));
        await applyEdit(i.video, { ...edit, audio: kept });
        return { sounds: 0, removed: edit.audio.length - kept.length };
      }
      return designSoundFor(i.video, density, i.seed, i.replace);
    },
  });

  defineCommand({
    name: "edit.snapToBeats",
    title: "Snap the montage to the beats",
    description:
      "Moves the start of every card (its end, so what follows starts on the beat), layer and zoom onto the nearest beat of the laid generated bed (sound.music), within `tolerance` seconds (0.25). Never a take's clip, a word-timed caption, a synced layer or a sound. Returns the tempo, the beats and each move. Without a generated bed, says to add one.",
    input: z.object({
      video,
      tolerance: z.number().min(0.02).max(1).default(0.25),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const r = snappedToMusic(edit, i.tolerance);
      if (r.moves.length) await applyEdit(i.video, r.edit);
      return { tempo: r.tempo, beats: r.beats, moved: r.moves.length, moves: r.moves };
    },
  });

  defineCommand({
    name: "edit.captions",
    title: "Captions from the words",
    description:
      "Word-timed captions from the take's transcription (`<stem>.words.json`, written by edit.transcribe): groups of 1 to 4 words, each word shown as it is said, the spoken one in the accent colour, 80 ms fades, bottom centre inside the format's safe zone. `from`/`to` (timeline seconds) limit the stretch. Replaces the previous captions (ids caption-word-*). Without a transcription, the answer says to run edit.transcribe.",
    input: z.object({
      video,
      from: z.number().min(0).optional(),
      to: z.number().min(0).optional(),
      style: z
        .object({
          color: color.optional(),
          accent: color.optional(),
          font: z.string().min(1).optional(),
        })
        .optional(),
    }),
    run: async (i) => {
      const file = await readWords(i.video);
      if (!file || file.words.length === 0) throw new Error(NO_WORDS);
      const edit = await currentEdit(i.video);
      const from = i.from ?? 0;
      const to = i.to ?? Number.POSITIVE_INFINITY;
      const words = timelineWords(edit.clips, file.words).filter(
        (w) => w.start >= from && w.start < to,
      );
      const { edit: next, count } = withCaptions(
        edit,
        words,
        captionLook(edit, i.style ?? {}),
      );
      await applyEdit(i.video, next);
      return {
        captions: count,
        words: words.length,
        language: file.language,
        item: next.overlays.find(isCaptionOverlay)?.id,
      };
    },
  });

  defineCommand({
    name: "edit.subtitles",
    title: "Write subtitles (.srt)",
    description:
      "Writes `<stem>.srt` next to the video from the take's transcription, as the words fall on the timeline (cuts followed): cues of at most 7 words. Returns the file.",
    input: z.object({ video }),
    run: async (i) => {
      const file = await readWords(i.video);
      if (!file || file.words.length === 0) throw new Error(NO_WORDS);
      const edit = await currentEdit(i.video);
      const words = timelineWords(edit.clips, file.words);
      const path = await ipc.srtWrite(i.video, srtOf(words));
      return { file: path, words: words.length, language: file.language };
    },
  });

  defineCommand({
    name: "sound.measure",
    title: "Measure a file's loudness",
    description:
      "Integrated loudness (LUFS) and true peak (dBTP) of a video or audio file, as ebur128 hears it: an export (target -14 LUFS, -1 dBTP), a voice take, a bed. export.video already returns this for its file.",
    input: z.object({
      file: z.string().min(1).describe("Absolute path of the file"),
    }),
    run: async (i) => ipc.audioLoudness(i.file),
  });
}
