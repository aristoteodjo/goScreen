// Word-timed captions: the words of a transcription grouped two to four at
// a time, each drawn as it is spoken, the one being said in the accent
// colour. Pure: the groups, the place per format and the state of each
// word at a time; the editor draws them.

import { sharp } from "./look";
import type { AspectId, CaptionWord, TextOverlay } from "./types";

export type TimedWord = { text: string; start: number; end: number };

export type CaptionOptions = {
  // Most words a group holds.
  maxWords: number;
  // Longest a group stays, in seconds.
  maxSeconds: number;
  // A pause longer than this starts a new group.
  gap: number;
};

export const CAPTION_DEFAULTS: CaptionOptions = {
  maxWords: 4,
  maxSeconds: 2.2,
  gap: 0.35,
};

export type CaptionGroup = { start: number; end: number; words: TimedWord[] };

/** A group stays on screen a little after its last word, never into the next group. */
const HOLD = 0.4;
const TAIL = 0.3;

const round = (n: number) => Math.round(n * 1000) / 1000;

const endsSentence = (w: string) => /[.!?…]["»)]?$/.test(w);

/**
 * Groups of one to `maxWords` words: a group closes on a sentence end, a
 * pause longer than `gap`, or when it would last more than `maxSeconds`.
 * Times are those of the words (any base); the group's end holds a little.
 */
export function captionsFromWords(
  words: TimedWord[],
  o: Partial<CaptionOptions> = {},
): CaptionGroup[] {
  const opt = { ...CAPTION_DEFAULTS, ...o };
  const sorted = [...words]
    .filter((w) => w.text.trim().length > 0 && w.end >= w.start)
    .sort((a, b) => a.start - b.start);
  const groups: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (const w of sorted) {
    const last = current[current.length - 1];
    const breaks =
      current.length > 0 &&
      (current.length >= opt.maxWords ||
        w.end - current[0].start > opt.maxSeconds ||
        (last ? w.start - last.end > opt.gap : false) ||
        (last ? endsSentence(last.text) : false));
    if (breaks) {
      groups.push(current);
      current = [];
    }
    current.push(w);
  }
  if (current.length) groups.push(current);
  return groups.map((g, i) => {
    const last = g[g.length - 1];
    const next = groups[i + 1]?.[0];
    const end = next
      ? Math.max(last.end, Math.min(next.start, last.end + HOLD))
      : last.end + TAIL;
    return { start: round(g[0].start), end: round(end), words: g };
  });
}

export type CaptionPlace = { y: number; size: number; width: number };

/**
 * Where captions sit in each format: bottom centre, above the platform's
 * own controls (the safe zones of the quality rules), sized to read on a
 * phone.
 */
export const CAPTION_PLACE: Record<AspectId, CaptionPlace> = {
  "9:16": { y: 0.7, size: 0.044, width: 0.74 },
  "16:9": { y: 0.86, size: 0.05, width: 0.8 },
  "1:1": { y: 0.86, size: 0.05, width: 0.85 },
  "4:5": { y: 0.85, size: 0.046, width: 0.85 },
  "4:3": { y: 0.86, size: 0.05, width: 0.85 },
  "3:4": { y: 0.84, size: 0.046, width: 0.85 },
  auto: { y: 0.86, size: 0.05, width: 0.8 },
};

export const CAPTION_ID = "caption-word";

export type CaptionLook = {
  aspect: AspectId;
  font: string;
  color: string;
  accent: string;
  lane: number;
};

/**
 * One text overlay per group, words timed from the group's start. Ids are
 * `caption-word-N`, so a later run replaces them all.
 */
export function captionOverlays(
  groups: CaptionGroup[],
  look: CaptionLook,
): TextOverlay[] {
  const place = CAPTION_PLACE[look.aspect];
  return groups.map((g, i) => {
    const words: CaptionWord[] = g.words.map((w) => ({
      text: w.text,
      start: round(Math.max(0, w.start - g.start)),
      end: round(Math.max(0, w.end - g.start)),
    }));
    return {
      id: `${CAPTION_ID}-${i}`,
      kind: "text",
      lane: look.lane,
      start: g.start,
      duration: round(Math.max(0.2, g.end - g.start)),
      x: 0.5,
      y: place.y,
      width: place.width,
      height: round(place.size * 2.6),
      rotation: 0,
      opacity: 1,
      enter: "none",
      exit: "none",
      motion: 0,
      text: g.words.map((w) => w.text).join(" "),
      style: {
        font: look.font,
        size: place.size,
        weight: 800,
        color: look.color,
        align: "center",
        background: null,
        accent: look.accent,
        shadow: 0.7,
      },
      words,
    };
  });
}

/** Captions of a montage: those whose id this module wrote. */
export const isCaptionOverlay = (o: { id: string }) =>
  o.id.startsWith(`${CAPTION_ID}-`);

/** Fade of each word and of the group, in seconds (the guide's 80 ms). */
export const CAPTION_FADE = 0.08;
/** The spoken word pops up by this much and settles on a sharp curve. */
const POP = 0.08;
const POP_TIME = 0.18;

export type CaptionWordState = {
  opacity: number;
  active: boolean;
  scale: number;
};

/**
 * Each word's state at `local` seconds into the group: fades in 80 ms as it
 * starts, the word being said (the latest started) is active and pops in,
 * everything fades 80 ms before the group ends.
 */
export function captionStateAt(
  words: CaptionWord[],
  local: number,
  duration: number,
): CaptionWordState[] {
  const groupOut = Math.max(0, Math.min(1, (duration - local) / CAPTION_FADE));
  let activeIndex = -1;
  words.forEach((w, i) => {
    if (local >= w.start) activeIndex = i;
  });
  return words.map((w, i) => {
    const since = local - w.start;
    const opacity =
      since < 0 ? 0 : Math.min(1, since / CAPTION_FADE) * groupOut;
    const k = Math.max(0, Math.min(1, since / POP_TIME));
    const scale = since < 0 ? 1 : 1 + POP * (1 - sharp(k));
    return { opacity, active: i === activeIndex, scale };
  });
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** `HH:MM:SS,mmm` as SubRip writes it. */
export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
}

/** A SubRip file of the words, at most `maxWords` a cue. */
export function srtOf(words: TimedWord[], maxWords = 7): string {
  const cues = captionsFromWords(words, {
    maxWords,
    maxSeconds: 4,
    gap: 0.6,
  });
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.words
          .map((w) => w.text)
          .join(" ")}\n`,
    )
    .join("\n");
}
