import {
  MAX_SFX,
  MUSIC_STYLES,
  pickStyle,
  SFX_KINDS,
  STYLE_SPECS,
} from "@goscreen/music";
import {
  type EditState,
  isCaptionOverlay,
  sequenceDuration,
  srtOf,
} from "@goscreen/render-engine";
import { z } from "zod";
import { ipc } from "@/lib/ipc";
import { useSession } from "@/modules/editor/session";
import {
  captionLook,
  lastWordEnd,
  MAX_SFX_WARNING,
  NO_WORDS,
  readWords,
  timelineWords,
  withCaptions,
  withMusic,
  withSfx,
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

export function registerSoundCommands({ currentEdit, applyEdit }: EditAccess) {
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
      );
      await applyEdit(i.video, next);
      return {
        item: clip.id,
        asset: rendered.asset.id,
        style,
        offset: rendered.offset,
        duration: clip.duration,
        volume: clip.volume,
      };
    },
  });

  defineCommand({
    name: "edit.addSfx",
    title: "Add a sound effect",
    description: `Places one synthesised effect (${SFX_KINDS.join(", ")}) at timeline time t. ${MAX_SFX_WARNING} The answer warns beyond ${MAX_SFX}.`,
    input: z.object({
      video,
      kind: z.enum(SFX_KINDS),
      t: z.number().min(0),
    }),
    run: async (i) => {
      const rendered = await ipc.soundRender(i.video, {
        kind: "sfx",
        sfx: i.kind,
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
        warning: r.count > MAX_SFX ? MAX_SFX_WARNING : undefined,
      };
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
