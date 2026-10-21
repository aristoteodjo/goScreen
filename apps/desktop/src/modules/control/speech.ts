import type { EditState } from "@goscreen/render-engine";
import { z } from "zod";
import {
  applyTakes,
  faceZoomsEdit,
  proposeTakes,
  qcEdit,
  syncMapEdit,
  tightCutEdit,
  transcribeTake,
} from "@/modules/editor/speech";
import { defineCommand } from "./registry";

// Talking-head commands for an AI: the same steps as the buttons of a
// recording clip's panel (transcribe, pick takes, tight cut, sync map, face
// zooms, QC), on the same files. Every command returns its real numbers.

type EditAccess = {
  currentEdit: (video: string) => Promise<EditState>;
  applyEdit: (video: string, edit: EditState) => Promise<void>;
};

const video = z
  .string()
  .min(1)
  .describe("Absolute path of a video (projects.videos)");

const effect = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1),
    duration: z.number().positive().max(30).optional(),
    y: z.number().min(0).max(1).optional(),
    size: z.number().positive().max(0.3).optional(),
  }),
  z.object({
    kind: z.literal("zoom"),
    scale: z.number().min(1).max(3).optional(),
    duration: z.number().positive().max(30).optional(),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
  }),
  z.object({ kind: z.literal("cut") }),
  z.object({
    kind: z.literal("sfx"),
    asset: z.string().min(1).describe("An audio asset id of the montage"),
    volume: z.number().min(0).max(2).optional(),
  }),
  z.object({
    kind: z.literal("retime"),
    overlay: z.string().min(1).optional(),
    zoom: z.string().min(1).optional(),
  }),
]);

export function registerSpeechCommands({ currentEdit, applyEdit }: EditAccess) {
  defineCommand({
    name: "edit.transcribe",
    title: "Transcribe the voice",
    description:
      "Writes the words of the take's voice (whisper.cpp, model downloaded once) as <stem>.words.json: one word = { text, start, end, p } in source seconds, each start snapped onto the attack of its sound (<stem>.envelope.json). The take's cleaned mic is used when there is one, else the video's own sound. Returns the language and the number of words.",
    input: z.object({
      video,
      model: z.enum(["base", "small"]).default("base"),
      language: z
        .string()
        .regex(/^[a-zA-Z]{2,5}$/)
        .optional()
        .describe("ISO code; detected when omitted"),
    }),
    run: async (i) => {
      const r = await transcribeTake(i.video, {
        model: i.model,
        language: i.language,
      });
      return { language: r.language, words: r.words, snapped: r.snapped };
    },
  });
  defineCommand({
    name: "edit.pickTakes",
    title: "Pick the best take of each line",
    description:
      "Matches each script line to all its takes in the words and keeps the last clean one (no stutter, no cut word, no flat voice); restarts are removed. With `script`, the main track becomes one clip per line in script order and <stem>.takes.md is written. Without `script`, the script is rebuilt from the words and returned with the takes found, for the person to agree before calling again with it. Returns raw and kept seconds, takes and restarts removed.",
    input: z.object({
      video,
      script: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe("One line per entry, as the person read it"),
    }),
    run: async (i) => {
      const proposal = await proposeTakes(i.video, i.script);
      const lines = proposal.picked.map((p) => ({
        line: p.line + 1,
        text: p.text,
        take: p.take ? `${p.take.take}/${p.rejected.length + 1}` : null,
        start: p.take?.start ?? null,
        end: p.take?.end ?? null,
        reason: p.reason,
        rejected: p.rejected.map((t) => ({
          take: t.take,
          start: t.start,
          end: t.end,
          issues: t.issues,
        })),
      }));
      if (!i.script)
        return {
          applied: false,
          script: proposal.script,
          lines,
          stats: proposal.stats,
          next: "Agree on the script with the person, then call edit.pickTakes again with it.",
        };
      const edit = await currentEdit(i.video);
      const applied = await applyTakes(i.video, edit, proposal);
      await applyEdit(i.video, applied.edit);
      return {
        applied: true,
        clips: applied.clips,
        lines,
        stats: proposal.stats,
        report: applied.report,
        item: applied.edit.clips[0]?.id,
      };
    },
  });
  defineCommand({
    name: "edit.tightCut",
    title: "Tight cut",
    description:
      "Cuts every pause longer than minPause out of the main track (the recording clips), keeping 2 frames on each side and never cutting inside a word. Returns the pauses cut and the seconds removed.",
    input: z.object({
      video,
      minPause: z.number().min(0.05).max(5).default(0.15),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const r = await tightCutEdit(i.video, edit, i.minPause);
      await applyEdit(i.video, r.edit);
      return {
        pausesCut: r.pausesCut,
        removedSeconds: Number(r.removedSeconds.toFixed(3)),
        clips: r.clips,
      };
    },
  });
  defineCommand({
    name: "edit.syncMap",
    title: "Sync effects on words",
    description:
      'Places each effect on the start of its word (n-th occurrence, -1 = last; accents and case ignored; a short phrase works too): "text" adds a text layer, "zoom" a zoom (source time), "cut" splits the clip there, "sfx" adds an audio asset, "retime" moves an existing overlay or zoom. Layers placed this way carry syncWord, checked by edit.qc. Returns what was placed, the words not found and the entries skipped.',
    input: z.object({
      video,
      entries: z
        .array(
          z.object({
            word: z.string().min(1),
            nth: z.number().int().optional(),
            effect,
          }),
        )
        .min(1)
        .max(200),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const r = await syncMapEdit(i.video, edit, i.entries);
      if (r.placed.length > 0) await applyEdit(i.video, r.edit);
      return {
        placed: r.placed,
        missing: r.missing,
        skipped: r.skipped,
        item: r.placed.find((p) => p.item !== "cut")?.item,
      };
    },
  });
  defineCommand({
    name: "edit.faceZooms",
    title: "Face zooms",
    description:
      "Frames a talking head: wide (100%) and close (120%, 115% on 1080p) alternate at every cut, the close framing centred on the eyes found in the camera frame (macOS face detection), 0.4 s push-in after the cut. Replaces the previous face zooms. Returns the zooms made and the faces found.",
    input: z.object({ video }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const r = await faceZoomsEdit(i.video, edit);
      await applyEdit(i.video, r.edit);
      return {
        zooms: r.zooms,
        clips: r.clips,
        faces: r.faces,
        item: r.edit.zooms.find((z) => z.id.startsWith("face-"))?.id,
      };
    },
  });
  defineCommand({
    name: "edit.qc",
    title: "Quality control",
    description:
      "Mechanical pass/fail checks of a talking-head montage: synced layers within 2 frames of their word, no text over the face, layers inside the safe zone, no cut inside a word, last frame like the first (or loop declared), no empty clip. Writes <stem>.qc.md. Returns the table and the real numbers (duration, clips, words, synced effects, failures).",
    input: z.object({
      video,
      loop: z.boolean().optional().describe("The film is meant to loop"),
      safeZone: z.number().min(0).max(0.2).default(0.05),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const r = await qcEdit(i.video, edit, {
        loop: i.loop,
        safeZone: i.safeZone,
      });
      return {
        pass: r.report.pass,
        checks: r.report.checks,
        stats: r.report.stats,
        markdown: r.markdown,
        file: r.file,
      };
    },
  });
}
