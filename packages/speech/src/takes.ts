import { type Envelope, type Word, tokensOf } from "./words";

// A person reads a script to the camera and repeats each line until it is
// right, without stopping the take. The script lines are found in the words
// (approximate alignment), the best take of each line is kept.

export type Take = {
  line: number;
  // 1-based, in time order.
  take: number;
  start: number;
  end: number;
  // Word indices, `to` exclusive.
  from: number;
  to: number;
  // Edit distance over the line's tokens, 0 = exact.
  score: number;
  // Why this take should not be kept (empty: a clean take).
  issues: string[];
};

export type Restart = {
  line: number;
  start: number;
  end: number;
  from: number;
  to: number;
};

export type LineMatches = {
  line: number;
  text: string;
  takes: Take[];
  restarts: Restart[];
};

export type MatchOptions = {
  // Largest accepted distance per line token (0.34: a third of the words may differ).
  tolerance?: number;
};

/** Edit distance between two token lists. */
export function levenshtein(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

type Candidate = { from: number; to: number; score: number };

/** Best window starting at `from` for the line's tokens; null above tolerance. */
function bestWindowAt(
  tokens: string[],
  line: string[],
  from: number,
  tolerance: number,
): Candidate | null {
  const slack = Math.max(1, Math.ceil(line.length * tolerance));
  let best: Candidate | null = null;
  for (
    let length = Math.max(1, line.length - slack);
    length <= line.length + slack && from + length <= tokens.length;
    length++
  ) {
    const score =
      levenshtein(tokens.slice(from, from + length), line) / line.length;
    if (score <= tolerance && (best === null || score < best.score))
      best = { from, to: from + length, score };
  }
  return best;
}

/** The lowest-scoring, non-overlapping windows, in time order. */
function pickWindows(candidates: Candidate[]): Candidate[] {
  const ranked = [...candidates].sort(
    (a, b) => a.score - b.score || a.from - b.from,
  );
  const kept: Candidate[] = [];
  for (const c of ranked)
    if (!kept.some((k) => c.from < k.to && k.from < c.to)) kept.push(c);
  return kept.sort((a, b) => a.from - b.from);
}

/**
 * Finds every take of every script line in the words. A take is a stretch of
 * words that reads like the line (edit distance within tolerance), a restart
 * is the start of the line said again before a take of it.
 */
export function matchTakes(
  lines: string[],
  words: Word[],
  { tolerance = 0.34 }: MatchOptions = {},
): LineMatches[] {
  // A transcribed word may hold several tokens ("aujourd'hui"); windows are
  // found over tokens, then mapped back to the words that own them.
  const tokens: string[] = [];
  const ownerWord: number[] = [];
  words.forEach((w, i) => {
    const parts = tokensOf(w.text);
    for (const t of parts.length > 0 ? parts : ["·"]) {
      tokens.push(t);
      ownerWord.push(i);
    }
  });
  const toWords = (c: Candidate): Candidate => ({
    ...c,
    from: ownerWord[c.from],
    to: ownerWord[c.to - 1] + 1,
  });
  const matched = lines.map((text) => {
    const line = tokensOf(text);
    if (line.length === 0) return { text, line, windows: [] as Candidate[] };
    // A take may start on any word: its first one may have been misheard.
    const candidates: Candidate[] = [];
    for (let from = 0; from < tokens.length; from++) {
      if (from > 0 && ownerWord[from] === ownerWord[from - 1]) continue;
      const c = bestWindowAt(tokens, line, from, tolerance);
      if (c) candidates.push(toWords(c));
    }
    return { text, line, windows: pickWindows(candidates) };
  });
  // A word belongs to one line only: the better match wins.
  const owner = new Map<number, { line: number; score: number }>();
  matched.forEach((m, line) => {
    for (const w of m.windows)
      for (let i = w.from; i < w.to; i++) {
        const o = owner.get(i);
        if (!o || w.score < o.score) owner.set(i, { line, score: w.score });
      }
  });
  const result: LineMatches[] = matched.map((m, line) => {
    const windows = m.windows.filter((w) => {
      let own = 0;
      for (let i = w.from; i < w.to; i++)
        if (owner.get(i)?.line === line) own++;
      return own >= (w.to - w.from) * 0.6;
    });
    const takes: Take[] = windows.map((w, k) => ({
      line,
      take: k + 1,
      start: words[w.from].start,
      end: words[w.to - 1].end,
      from: w.from,
      to: w.to,
      score: w.score,
      issues: [],
    }));
    return { line, text: m.text, takes, restarts: [] };
  });
  // Restarts: the line's opening said again in the gap before one of its takes.
  // Per word, for the restart search (word indices).
  const wordTokens = words.map((w) => tokensOf(w.text).join("") || "·");
  const taken = (i: number) =>
    result.some((r) => r.takes.some((t) => i >= t.from && i < t.to));
  const allEnds = result.flatMap((o) => o.takes.map((t) => t.to));
  for (const r of result) {
    const line = matched[r.line].line;
    const head = line.slice(0, Math.min(3, line.length));
    const minimum = Math.min(2, head.length);
    const opensAt = (i: number, limit: number) => {
      const length = Math.min(head.length, limit - i);
      if (length < minimum || taken(i)) return false;
      // Words may carry several tokens: compare the joined text of the
      // opening against the joined text of as many words.
      const want = head.slice(0, length).join("");
      let got = "";
      let k = i;
      while (k < limit && got.length < want.length) got += wordTokens[k++];
      return (
        levenshtein([...got], [...want]) <=
        Math.max(0, Math.floor(want.length * 0.15))
      );
    };
    for (const take of r.takes) {
      const previous = Math.max(0, ...allEnds.filter((to) => to <= take.from));
      const starts: number[] = [];
      for (let i = previous; i < take.from; i++)
        if (opensAt(i, take.from)) {
          starts.push(i);
          i += minimum - 1;
        }
      starts.forEach((from, k) => {
        let to = starts[k + 1] ?? take.from;
        while (to > from + 1 && taken(to - 1)) to--;
        r.restarts.push({
          line: r.line,
          start: words[from].start,
          end: words[to - 1].end,
          from,
          to,
        });
      });
    }
    r.restarts.sort((a, b) => a.from - b.from);
  }
  return result;
}

export type PickOptions = {
  prefer?: "last" | "first";
  envelope?: Envelope;
  // Below this confidence a word counts as cut or misheard.
  minConfidence?: number;
  // A word longer than this is a stretch or a cut-off (seconds).
  maxWordSeconds?: number;
};

export type Picked = {
  line: number;
  text: string;
  take: Take | null;
  reason: string;
  rejected: Take[];
  restarts: Restart[];
};

/** Problems that disqualify a take: stutters, cut words, a flat voice. */
export function issuesOf(
  take: Take,
  words: Word[],
  { envelope, minConfidence = 0.4, maxWordSeconds = 1.2 }: PickOptions,
): string[] {
  const issues: string[] = [];
  const slice = words.slice(take.from, take.to);
  const tokens = slice.map((w) => tokensOf(w.text).join(""));
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a.length === 0) continue;
    if (a === b) {
      issues.push(`stutter: "${slice[i].text}" repeated`);
      break;
    }
    if (a.length >= 2 && a.length < b.length && b.startsWith(a)) {
      issues.push(
        `interrupted word: "${slice[i].text}" then "${slice[i + 1].text}"`,
      );
      break;
    }
  }
  const cut = slice.find(
    (w) => w.p < minConfidence || w.end - w.start > maxWordSeconds,
  );
  if (cut) issues.push(`cut word: "${cut.text}"`);
  if (envelope && envelope.rms.length > 0) {
    const from = Math.floor(take.start / envelope.dt);
    const to = Math.min(envelope.rms.length, Math.ceil(take.end / envelope.dt));
    const values = envelope.rms.slice(from, to);
    if (values.length >= 4) {
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance =
        values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
      const spread = mean > 0 ? Math.sqrt(variance) / mean : 0;
      if (spread < 0.2) issues.push("flat energy");
    }
  }
  return issues;
}

/**
 * Keeps one take per line: the last clean one (or the first, `prefer`),
 * else the clean-est. Every take is annotated with its issues.
 */
export function pickTakes(
  matches: LineMatches[],
  words: Word[],
  options: PickOptions = {},
): Picked[] {
  const prefer = options.prefer ?? "last";
  return matches.map((m) => {
    const takes = m.takes.map((t) => ({
      ...t,
      issues: issuesOf(t, words, options),
    }));
    const ordered = prefer === "last" ? [...takes].reverse() : takes;
    const clean = ordered.find((t) => t.issues.length === 0);
    const chosen =
      clean ??
      ordered.reduce<Take | null>(
        (best, t) =>
          best === null || t.issues.length < best.issues.length ? t : best,
        null,
      );
    const reason =
      takes.length === 0
        ? "not found in the words"
        : chosen === clean
          ? takes.length === 1
            ? "only take"
            : `${prefer} clean take of ${takes.length}`
          : `every take has an issue; fewest: ${chosen?.issues.join(", ")}`;
    return {
      line: m.line,
      text: m.text,
      take: chosen,
      reason,
      rejected: takes.filter((t) => t !== chosen),
      restarts: m.restarts,
    };
  });
}

export type TakesStats = {
  rawSeconds: number;
  keptSeconds: number;
  takesRemoved: number;
  restartsRemoved: number;
  linesMissing: number;
};

const clock = (t: number) => {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
};

/** `takes.md`: one row per line, and the real numbers of the cut. */
export function takesReport(
  picked: Picked[],
  words: Word[],
): { markdown: string; stats: TakesStats } {
  const first = words[0]?.start ?? 0;
  const last = words[words.length - 1]?.end ?? 0;
  const stats: TakesStats = {
    rawSeconds: Math.max(0, last - first),
    keptSeconds: picked.reduce(
      (s, p) => s + (p.take ? p.take.end - p.take.start : 0),
      0,
    ),
    takesRemoved: picked.reduce((s, p) => s + p.rejected.length, 0),
    restartsRemoved: picked.reduce((s, p) => s + p.restarts.length, 0),
    linesMissing: picked.filter((p) => p.take === null).length,
  };
  const rows = picked.map((p) => {
    const take = p.take ? `${p.take.take}/${p.rejected.length + 1}` : "—";
    const time = p.take ? `${clock(p.take.start)} → ${clock(p.take.end)}` : "—";
    const text = p.text.replace(/\|/g, "\\|");
    return `| ${p.line + 1} | ${text} | ${take} | ${time} | ${p.reason} |`;
  });
  const markdown = [
    "# Takes",
    "",
    `Raw ${stats.rawSeconds.toFixed(1)} s, kept ${stats.keptSeconds.toFixed(1)} s, ${stats.takesRemoved} takes and ${stats.restartsRemoved} restarts removed${stats.linesMissing ? `, ${stats.linesMissing} lines not found` : ""}.`,
    "",
    "| Line | Text | Take | Time | Reason |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  return { markdown, stats };
}

export type Range = { in: number; out: number };

/**
 * The clips of the chosen takes, in script order, with a small handle each
 * side. A handle never reaches into a neighbouring word (the restart or the
 * take before): the cut stays in the silence between words.
 */
export function clipsFromTakes(
  picked: Picked[],
  handle = 0.07,
  words: Word[] = [],
): Range[] {
  const takes = picked.flatMap((p) => (p.take ? [p.take] : []));
  return takes.map((t, i) => {
    const before = takes[i - 1];
    const after = takes[i + 1];
    const wordBefore = words.filter((w) => w.end <= t.start + 1e-6).at(-1);
    const wordAfter = words.find((w) => w.start >= t.end - 1e-6);
    const inAt = Math.max(
      0,
      t.start - handle,
      before ? before.end : 0,
      wordBefore ? wordBefore.end : 0,
    );
    const outAt = Math.max(
      inAt + 0.05,
      Math.min(
        t.end + handle,
        after ? after.start : Number.POSITIVE_INFINITY,
        wordAfter ? wordAfter.start : Number.POSITIVE_INFINITY,
      ),
    );
    return { in: inAt, out: outAt };
  });
}

/**
 * A script from the words when there is none: sentences (ended by . ! ? or
 * a pause over 0.6 s), each kept once even when it was said several times.
 */
export function scriptFromWords(words: Word[], pause = 0.6): string[] {
  const sentences: Word[][] = [];
  let current: Word[] = [];
  words.forEach((w, i) => {
    current.push(w);
    const next = words[i + 1];
    const ends = /[.!?]["»”)]?$/.test(w.text.trim());
    if (ends || !next || next.start - w.end > pause) {
      sentences.push(current);
      current = [];
    }
  });
  const unique: { text: string; tokens: string[] }[] = [];
  for (const s of sentences) {
    const tokens = s.flatMap((w) => tokensOf(w.text));
    if (tokens.length === 0) continue;
    const text = s.map((w) => w.text.trim()).join(" ");
    const isPrefix = (a: string[], b: string[]) =>
      a.length >= 2 && a.length < b.length && a.every((t, i) => t === b[i]);
    const twin = unique.findIndex(
      (u) =>
        levenshtein(u.tokens, tokens) /
          Math.max(u.tokens.length, tokens.length) <=
          0.34 ||
        isPrefix(u.tokens, tokens) ||
        isPrefix(tokens, u.tokens),
    );
    if (twin < 0) unique.push({ text, tokens });
    // A restart is a prefix of the full sentence: the longer reading wins.
    // Between two full readings, the later one is usually the corrected one.
    else if (!isPrefix(tokens, unique[twin].tokens))
      unique[twin] = { text, tokens };
  }
  return unique.map((u) => u.text);
}
