import { describe, expect, it } from "vitest";
import {
  clipsFromTakes,
  levenshtein,
  matchTakes,
  pickTakes,
  scriptFromWords,
  takesReport,
} from "./takes";
import type { Word } from "./words";

/** Words spoken one after the other, 0.3 s each with a 0.1 s gap; `|` = a 1 s pause. */
function speak(text: string, at = 0, p = 0.9): Word[] {
  const words: Word[] = [];
  let t = at;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (token === "|") {
      t += 1;
      continue;
    }
    words.push({ text: token, start: t, end: t + 0.3, p });
    t += 0.4;
  }
  return words;
}

const LINES = [
  "Bonjour, je vous présente goScreen.",
  "Un outil qui filme n'importe quel site.",
  "Essayez-le aujourd'hui.",
];

describe("levenshtein", () => {
  it("counts token edits", () => {
    expect(levenshtein(["a", "b", "c"], ["a", "c"])).toBe(1);
    expect(levenshtein([], ["a"])).toBe(1);
    expect(levenshtein(["x"], ["x"])).toBe(0);
  });
});

describe("matchTakes", () => {
  it("finds every take of each line, tolerant to small mishearings", () => {
    const words = speak(
      "Bonjour je vous présente goScreen | Bonjour je vous présente go screen | " +
        "Un outil qui filme n'importe quel site | Essayez-le aujourd'hui | Essayez-le aujourd'hui",
    );
    const matches = matchTakes(LINES, words);
    expect(matches[0].takes).toHaveLength(2);
    expect(matches[1].takes).toHaveLength(1);
    expect(matches[2].takes).toHaveLength(2);
    expect(matches[0].takes[0].start).toBe(0);
    expect(matches[0].takes[1].take).toBe(2);
    // Takes never share a word.
    const all = matches.flatMap((m) => m.takes);
    for (const a of all)
      for (const b of all)
        if (a !== b) expect(a.from >= b.to || b.from >= a.to).toBe(true);
  });

  it("finds restarts: the opening said again before a take", () => {
    const words = speak(
      "Bonjour je vous | Bonjour je | Bonjour je vous présente goScreen | Un outil qui filme n'importe quel site | Essayez-le aujourd'hui",
    );
    const matches = matchTakes(LINES, words);
    expect(matches[0].takes).toHaveLength(1);
    expect(matches[0].restarts).toHaveLength(2);
    expect(matches[0].restarts[0].start).toBe(0);
    expect(matches[0].restarts[1].from).toBe(3);
  });

  it("reports a line that was never said", () => {
    const words = speak("Un outil qui filme n'importe quel site");
    const matches = matchTakes(LINES, words);
    expect(matches[0].takes).toHaveLength(0);
    expect(matches[1].takes).toHaveLength(1);
  });
});

describe("pickTakes", () => {
  it("keeps the last clean take", () => {
    const words = speak(
      "Bonjour je vous présente goScreen | Bonjour je vous présente goScreen | Un outil qui filme n'importe quel site | Essayez-le aujourd'hui",
    );
    const picked = pickTakes(matchTakes(LINES, words), words);
    expect(picked[0].take?.take).toBe(2);
    expect(picked[0].rejected).toHaveLength(1);
    expect(picked[0].reason).toContain("last clean");
    expect(picked[1].reason).toBe("only take");
    expect(
      pickTakes(matchTakes(LINES, words), words, { prefer: "first" })[0].take
        ?.take,
    ).toBe(1);
  });

  it("skips a take with a stutter or an interrupted word", () => {
    const words = speak(
      "Bonjour je vous présente goScreen | Bonjour je je vous présente goScreen | Un outil qui filme n'importe quel site | Essayez-le aujourd'hui",
    );
    const picked = pickTakes(matchTakes(LINES, words), words);
    expect(picked[0].take?.take).toBe(1);
    expect(picked[0].rejected[0].issues[0]).toContain("stutter");

    const cut = speak(
      "Bonjour je vous présente goScreen | Bonjour je vous prés présente goScreen | Un outil qui filme n'importe quel site | Essayez-le aujourd'hui",
    );
    const picked2 = pickTakes(matchTakes(LINES, cut), cut);
    expect(picked2[0].take?.take).toBe(1);
    expect(picked2[0].rejected[0].issues[0]).toContain("interrupted");
  });

  it("skips a take with a cut word (low confidence or odd length)", () => {
    const first = speak("Bonjour je vous présente goScreen");
    const second = speak("Bonjour je vous présente goScreen", 4);
    second[4] = { ...second[4], p: 0.2 };
    const words = [...first, ...second];
    const picked = pickTakes(matchTakes([LINES[0]], words), words);
    expect(picked[0].take?.take).toBe(1);
    expect(picked[0].rejected[0].issues[0]).toContain("cut word");
  });

  it("skips a flat take when the envelope says so", () => {
    const words = speak(
      "Bonjour je vous présente goScreen | Bonjour je vous présente goScreen",
    );
    const dt = 0.01;
    const rms = Array.from({ length: 600 }, (_, i) => {
      const t = i * dt;
      if (t < 2) return 0.3 + 0.3 * Math.sin(t * 20);
      return 0.3;
    });
    const picked = pickTakes(matchTakes([LINES[0]], words), words, {
      envelope: { dt, rms },
    });
    expect(picked[0].take?.take).toBe(1);
    expect(picked[0].rejected[0].issues).toContain("flat energy");
  });

  it("falls back to the take with the fewest issues", () => {
    const words = speak("Bonjour je je vous présente goScreen");
    const picked = pickTakes(matchTakes([LINES[0]], words), words);
    expect(picked[0].take?.take).toBe(1);
    expect(picked[0].reason).toContain("every take has an issue");
  });
});

describe("takesReport and clips", () => {
  it("gives the real numbers and a table", () => {
    const words = speak(
      "Bonjour je | Bonjour je vous présente goScreen | Bonjour je vous présente goScreen | Un outil qui filme n'importe quel site | Essayez-le aujourd'hui",
    );
    const picked = pickTakes(matchTakes(LINES, words), words);
    const { markdown, stats } = takesReport(picked, words);
    expect(stats.takesRemoved).toBe(1);
    expect(stats.restartsRemoved).toBe(1);
    expect(stats.rawSeconds).toBeCloseTo(words[words.length - 1].end);
    expect(stats.keptSeconds).toBeCloseTo(1.9 + 2.7 + 0.7, 5);
    expect(markdown).toContain(
      "| 1 | Bonjour, je vous présente goScreen. | 2/2 |",
    );
    expect(markdown).toContain("| Line | Text | Take | Time | Reason |");

    const clips = clipsFromTakes(picked, 0.05);
    expect(clips).toHaveLength(3);
    // With the words, a handle stops at the neighbouring word's edge.
    const tight = clipsFromTakes(picked, 0.5, words);
    const firstTake = picked[0].take ?? { from: 0, to: 0, start: 0, end: 0 };
    const previous = words[firstTake.from - 1];
    if (previous) expect(tight[0].in).toBeGreaterThanOrEqual(previous.end);
    const following = words[firstTake.to];
    if (following) expect(tight[0].out).toBeLessThanOrEqual(following.start);
    const first = picked[0].take ?? { start: Number.NaN, end: Number.NaN };
    expect(clips[0].in).toBeCloseTo(first.start - 0.05);
    expect(clips[0].out).toBeCloseTo(first.end + 0.05);
    for (let i = 0; i + 1 < clips.length; i++)
      expect(clips[i].out).toBeLessThanOrEqual(clips[i + 1].in);
  });
});

describe("scriptFromWords", () => {
  it("rebuilds sentences and keeps each one once", () => {
    const words = speak(
      "Bonjour je vous présente goScreen. | Bonjour je vous présente goScreen. | Bonjour je | Un outil qui filme n'importe quel site. Essayez-le aujourd'hui.",
    );
    expect(scriptFromWords(words)).toEqual([
      "Bonjour je vous présente goScreen.",
      "Un outil qui filme n'importe quel site.",
      "Essayez-le aujourd'hui.",
    ]);
  });

  it("splits on long pauses without punctuation", () => {
    const words = speak("un deux | trois quatre");
    expect(scriptFromWords(words)).toEqual(["un deux", "trois quatre"]);
  });
});
