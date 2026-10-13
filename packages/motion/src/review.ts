import { z } from "zod";
import type { Line, Shot, TextShot, Word } from "./schema.ts";

// An AI looks at a frame of each shot and corrects what measurements cannot
// know: the exact text (OCR misses accents, apostrophes, short words), which
// words are accented or struck, what a shot that is not text shows. Timing and
// layout stay measured: the AI never invents them. Same contract for every
// model (local Qwen3-VL in the app, Claude through MCP).

/** What a visual element is, for the model to learn and the renderer to use. */
export const ELEMENT_ROLES = [
  "card",
  "window",
  "pill",
  "button",
  "logo",
  "icon",
  "photo",
  "chart",
  "list",
  "other",
] as const;

export const ShotReview = z.object({
  kind: z.enum(["text", "logo", "interface", "other"]),
  /** Text shots: every line, every word, in reading order. */
  lines: z
    .array(
      z.array(
        z.object({
          text: z.string().min(1),
          accent: z.boolean().default(false),
          strike: z.boolean().default(false),
        }),
      ),
    )
    .default([]),
  kicker: z.string().nullable().default(null),
  /** What the shot shows, in a few words (for shots goScreen cannot rebuild). */
  description: z.string().default(""),
  /** What is behind everything: what the renderer's plate should be. */
  background: z
    .object({
      kind: z.enum(["plain", "gradient", "texture", "footage", "image"]),
      colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(4).default([]),
    })
    .nullable()
    .default(null),
  /** The visual elements in front of it, biggest first (not the words). */
  elements: z
    .array(
      z.object({
        role: z.enum(ELEMENT_ROLES),
        /** It casts a soft shadow, or glows. */
        shadow: z.boolean().default(false),
        label: z.string().default(""),
      }),
    )
    .max(12)
    .default([]),
});
export type ShotReview = z.infer<typeof ShotReview>;

/** The JSON schema the model must answer with (llama.cpp turns it into a grammar). */
export const SHOT_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["text", "logo", "interface", "other"] },
    lines: {
      type: "array",
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            accent: { type: "boolean" },
            strike: { type: "boolean" },
          },
          required: ["text", "accent", "strike"],
        },
      },
    },
    kicker: { type: ["string", "null"] },
    description: { type: "string" },
    background: {
      type: ["object", "null"],
      properties: {
        kind: { type: "string", enum: ["plain", "gradient", "texture", "footage", "image"] },
        colors: { type: "array", items: { type: "string" }, maxItems: 4 },
      },
      required: ["kind", "colors"],
    },
    elements: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: [...ELEMENT_ROLES] },
          shadow: { type: "boolean" },
          label: { type: "string" },
        },
        required: ["role", "shadow", "label"],
      },
    },
  },
  required: ["kind", "lines", "kicker", "description", "background", "elements"],
} as const;

/** When a shot is best seen: all its words in, just before it leaves. */
export function shotKeyTime(shot: Shot): number {
  if (shot.kind !== "text") return (shot.start + shot.end) / 2;
  const words = shot.lines.flatMap((l) => l.words);
  const last = Math.max(...words.map((w) => w.at)) + shot.enter.duration + 0.25;
  return Math.min(Math.max(last, shot.start), shot.end - 0.1);
}

export const REVIEW_SYSTEM = `You check the analysis of a motion-design video, one shot at a time.
You receive a frame of the shot and what the measurements found. Answer in JSON only.
- kind: "text" if the frame is mostly animated words on a plain background; "logo" for a brand mark;
  "interface" for an app screen or web page; "other" otherwise.
- lines: the large text exactly as written in the frame, line by line, word by word, with its
  accents, apostrophes and punctuation (keep punctuation attached to its word). accent = the word is
  in a different colour from the others. strike = a line is drawn through the word.
- kicker: the small label above the text, if any, else null.
- description: what the shot shows, in at most 8 words.
- background: what is behind everything: "plain" (one colour), "gradient", "texture" (a pattern, a
  mosaic), "footage" (moving video) or "image"; colors: its main colours as #rrggbb (at most 4).
- elements: the visual things in front of the background, biggest first (not the words): role
  (card, window, pill, button, logo, icon, photo, chart, list, other), shadow = it casts a soft
  shadow or glows, label = what it says or shows, in a few words.
Never invent words or elements that are not in the frame.`;

/** The question about one shot. */
export function reviewPrompt(shot: Shot): string {
  if (shot.kind !== "text")
    return "The measurements found no large text in this shot. What does it show?";
  const found = shot.lines
    .map((l) =>
      l.words
        .map((w) => `${w.text}${w.accent ? " (accent)" : ""}${w.strike !== undefined ? " (struck)" : ""}`)
        .join(" "),
    )
    .join(" / ");
  return `The measurements read: ${found}${shot.kicker ? `; small label above: ${shot.kicker.text}` : ""}. Correct it from the frame.`;
}

/** Spreads `n` word times over the measured ones (when the AI split or merged words). */
export function spreadTimes(times: number[], n: number): number[] {
  if (!times.length) return Array.from({ length: n }, () => 0);
  if (times.length === n) return times;
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (n === 1) return [first];
  return Array.from({ length: n }, (_, i) => first + ((last - first) * i) / (n - 1));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The shot with the AI's corrections: its words and styles, on the measured
 * timing and layout. A shot the AI sees as a logo or an interface becomes a
 * placeholder that names it.
 */
export function applyReview(shot: Shot, review: ShotReview): Shot {
  if (review.kind !== "text" || !review.lines.length) {
    if (shot.kind === "text" && review.kind === "text") return shot;
    return {
      kind: "placeholder",
      id: shot.id,
      start: shot.start,
      end: shot.end,
      background: shot.background,
      label: review.description || review.kind,
      // Pictures found around the text stay; the words are not pictures.
      visuals: shot.visuals,
      labels: shot.kind === "placeholder" ? shot.labels : [],
    };
  }
  if (shot.kind !== "text")
    return { ...shot, label: review.description || shot.label };
  const measured = shot.lines.flatMap((l) => l.words);
  const strikeAfter = (at: number) =>
    measured.find((w) => w.strike !== undefined)?.strike ?? round(at + 0.6);
  const norm = (t: string) =>
    t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  // Each corrected line goes with the measured line it shares most words
  // with, and keeps its measures (size, baseline); a line the AI saw that was
  // not measured (a label inside a picture) is learnt, not drawn.
  const used = new Set<number>();
  const lines: Line[] = [];
  for (const row of review.lines) {
    let best = -1;
    let shared = 0;
    shot.lines.forEach((l, i) => {
      if (used.has(i)) return;
      const have = new Set(l.words.map((w) => norm(w.text)));
      const n = row.filter((w) => have.has(norm(w.text))).length;
      if (n > shared) {
        shared = n;
        best = i;
      }
    });
    // Nothing in common: the line at the same place, when the counts match.
    if (best < 0 && review.lines.length === shot.lines.length) {
      const i = review.lines.indexOf(row);
      if (!used.has(i)) best = i;
    }
    if (best < 0) continue;
    used.add(best);
    const source = shot.lines[best];
    const free = [...source.words];
    let last = source.words[0]?.at ?? shot.start;
    const words = row.map((w, wi): Word => {
      // The measured word: same text, else the one at the same place.
      let k = free.findIndex((m) => norm(m.text) === norm(w.text));
      if (k < 0 && row.length === source.words.length) k = free.indexOf(source.words[wi]);
      const was = k >= 0 ? free.splice(k, 1)[0] : undefined;
      const at = round(was?.at ?? last);
      last = at;
      return {
        text: w.text,
        at,
        accent: w.accent,
        echo: was?.echo ?? false,
        ...(was?.x !== undefined ? { x: was.x, ...(was.w !== undefined ? { w: was.w } : {}) } : {}),
        ...(was?.color && !w.accent ? { color: was.color } : {}),
        ...(was?.count && norm(w.text) === norm(was.text) ? { count: was.count } : {}),
        ...(w.strike ? { strike: was?.strike ?? strikeAfter(at) } : {}),
      };
    });
    lines.push({ ...source, words });
  }
  if (!lines.length) return shot;
  const next: TextShot = { ...shot, lines };
  if (review.kicker)
    next.kicker = { text: review.kicker, at: shot.kicker?.at ?? shot.start, gap: shot.kicker?.gap ?? 0.35 };
  else delete next.kicker;
  return next;
}
