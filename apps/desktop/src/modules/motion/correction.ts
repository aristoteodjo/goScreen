import { type Shot, ShotReview } from "@goscreen/motion";

// A person corrects a shot the way they would type it: one line of the
// frame per line of text, `*word*` for a word in the accent colour, `~word~`
// for a struck one. The same answer as Claude's or the local model's
// (`ShotReview`), so it teaches the local model too.

const wordText = (w: ShotReview["lines"][number][number]) => {
  let t = w.text;
  if (w.strike) t = `~${t}~`;
  if (w.accent) t = `*${t}*`;
  return t;
};

/** The lines of an answer, as a person types them. */
export function linesToText(lines: ShotReview["lines"]): string {
  return lines.map((l) => l.map(wordText).join(" ")).join("\n");
}

/** What a person typed, as lines of words; marks may wrap each other. */
export function textToLines(text: string): ShotReview["lines"] {
  return text
    .split("\n")
    .map((row) =>
      row
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((raw) => {
          let t = raw;
          let accent = false;
          let strike = false;
          for (let changed = true; changed; ) {
            changed = false;
            if (t.length > 2 && t.startsWith("*") && t.endsWith("*")) {
              t = t.slice(1, -1);
              accent = changed = true;
            }
            if (t.length > 2 && t.startsWith("~") && t.endsWith("~")) {
              t = t.slice(1, -1);
              strike = changed = true;
            }
          }
          return t ? [{ text: t.normalize("NFC"), accent, strike }] : [];
        }),
    )
    .filter((l) => l.length > 0);
}

/** The shot as it reads in the spec now, as an answer to start from. */
export function reviewOfShot(shot: Shot): ShotReview {
  if (shot.kind !== "text")
    return ShotReview.parse({ kind: "other", description: shot.label });
  return ShotReview.parse({
    kind: "text",
    lines: shot.lines.map((l) =>
      l.words.map((w) => ({
        text: w.text,
        accent: w.accent,
        strike: w.strike !== undefined,
      })),
    ),
    kicker: shot.kicker?.text ?? null,
  });
}
