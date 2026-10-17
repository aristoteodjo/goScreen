import { blockById } from "@goscreen/blocks";
import type { Direction } from "./direction";
import { contrast } from "./film";

// An inspiration as graphic elements for the montage: the blocks its prompt
// shows (a typed request, a chat, a counter, a chart, cards, a wordmark…),
// filled with its own words and numbers and the film's colours. An element is
// proposed only when the prompt gives it something to say; nothing is invented.

export type KitPlace = "open" | "body" | "close";

export type KitElement = {
  block: string;
  props: Record<string, string | number>;
  /** Where it belongs in the film: opening, along the scenes, or the end. */
  place: KitPlace;
  /** Why it is here, quoted from the prompt where possible. */
  reason: string;
};

export type KitContext = {
  brand?: string;
  tagline?: string;
  url?: string;
  colors: { background: string; ink: string; accent: string };
};

export type Metric = {
  value: number;
  prefix: string;
  suffix: string;
  label: string;
  /** Listed with slashes among other results: comparable side by side. */
  listed: boolean;
};

// Units that measure the film, not the product.
const NOT_METRICS =
  /^(fps|bpm|px|pixels?|seconds?|secs?|s|ms|beats?|bars?|frames?|words?|letters?|lines?|scenes?|shots?|degrees?|deg|colou?rs?|photos?|images?|objects?|cells?|times?|steps?|items?|tiles?|dots?|columns?|rows?|cards?|x|by|of|to|and|or|px\w*|ui|states?|grid|font|weight|wdth|bit|k|em|vh|vw|minutes?|hours?|days?|percent|points?|sub\w*|layers?|icons?|blades?|ingredients?|chars?|characters?|pt|mm|cm)$/;

// Little words: a label made of them is the middle of a sentence.
const STOP = new Set(
  "a an the at by is are was be of with for when that it me my you your we our and or to as has have had should will can in on into from this these those than then there here so if but not no yes inspired show real high-res lufs db hz khz bpm one".split(
    " ",
  ),
);

/** Sentences the prompt quotes: on-screen copy, requests, replies, labels. */
export function quotesOf(prompt: string, brand = "your product"): string[] {
  const out: string[] = [];
  // A quote may wrap over a few lines (a typed request laid out on three).
  for (const m of prompt.matchAll(
    /["“]((?:[^"”\n]|\n(?![\s\S]{0,0}\n)){2,140})["”]/g,
  )) {
    if ((m[1].match(/\n/g) ?? []).length > 2) continue;
    const text = m[1]
      .replace(/\[(?:my |your )?(?:product|brand|app)(?: name)?\]/gi, brand)
      .replace(/\s+/g, " ")
      .trim();
    // File names, colours, code and instructions are not copy.
    if (
      /\.(json|mp4|png|svg|html|js|css)$|#[0-9a-f]{3,6}|[{}<>=;]|^https?:/i.test(
        text,
      )
    )
      continue;
    if (!/[a-zà-ÿ]/i.test(text) || out.includes(text)) continue;
    // A song, a font or a style named in quotes is not on-screen copy.
    const before = prompt
      .slice(Math.max(0, m.index - 24), m.index)
      .toLowerCase();
    if (
      /(song|track|music|mixkit|font|typeface|style|voice|preset)\W*$/.test(
        before,
      )
    )
      continue;
    // Two lowercase words are a label of the brief ("prompt code"), not copy.
    if (
      words(text) <= 2 &&
      text === text.toLowerCase() &&
      !text.includes(brand.toLowerCase())
    )
      continue;
    out.push(text);
  }
  return out.slice(0, 12);
}

/** Product numbers ("200 leads found", "+22%"), never the film's own (fps, BPM, px). */
export function metricsOf(prompt: string): Metric[] {
  const out: Metric[] = [];
  const re =
    /(^|[\s(/"“])([+-]?)(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)(\s?%|k\b)?\s+([a-z][a-z-]+(?:\s[a-z][a-z-]+)?)/gi;
  for (const m of prompt.matchAll(re)) {
    const before = prompt.slice(
      Math.max(0, m.index - 2),
      m.index + m[1].length,
    );
    const after = prompt.slice(
      m.index + m[0].length,
      m.index + m[0].length + 2,
    );
    // Sizes and ranges: 1920x1080, 0-6, 24–28 px.
    if (/[x×\-–]\s?$/.test(before) || /^\s?[x×]/.test(after)) continue;
    const label = m[5].toLowerCase();
    const [first, second] = label.split(" ");
    if (NOT_METRICS.test(first) || STOP.has(first)) continue;
    const value = Number(m[3].replace(/[,\s]/g, ""));
    if (!Number.isFinite(value) || value < 1) continue;
    // "5.5 inspired by", "3.1 one-thumb": versions and section numbers.
    if (!m[4] && !Number.isInteger(value)) continue;
    // Only results: quoted, listed with slashes, or announced as a count.
    // Elsewhere a number is an instruction ("6 ingredients", "16 notes").
    const near = prompt
      .slice(Math.max(0, m.index - 60), m.index + m[0].length + 4)
      .toLowerCase();
    const quoted =
      (
        prompt
          .slice(prompt.lastIndexOf("\n", m.index) + 1, m.index)
          .match(/["“”]/g) ?? []
      ).length %
        2 ===
      1;
    const listed =
      /\/\s*$/.test(prompt.slice(Math.max(0, m.index - 3), m.index + 1)) ||
      /^\s*\//.test(
        prompt.slice(m.index + m[0].length, m.index + m[0].length + 3),
      );
    const announced =
      /count|counter|ticks? up|\bstats?\b|metric|result|reports?|kpi|saved|grew|growth/.test(
        near,
      );
    if (!quoted && !listed && !announced) continue;
    // "200 leads" after "200 leads found": the same result told twice.
    if (
      out.some(
        (o) =>
          o.value === value &&
          (o.label.startsWith(label) || label.startsWith(o.label)),
      )
    )
      continue;
    // "16 note at": a label that runs into a little word is a sentence, not a result.
    const tidy = second && STOP.has(second) ? first : label;
    // Years and frame counts are not results.
    if (!m[4] && value >= 1900 && value <= 2100) continue;
    out.push({
      value,
      prefix: m[2] === "+" ? "+" : "",
      suffix: m[4] ? m[4].trim() : "",
      label: tidy,
      listed,
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** A colour a little towards another (cards a step above the background). */
function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) =>
    Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) =>
    Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t),
  );
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Text colour for words drawn on `fill`: the film's ink or background, whichever reads. */
const onFill = (fill: string, c: KitContext["colors"]) =>
  contrast(c.ink, fill) >= contrast(c.background, fill) ? c.ink : c.background;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

type Rule = {
  block: string;
  place: KitPlace;
  trigger: RegExp;
  build: (
    f: Facts,
  ) => { props: Record<string, string | number>; reason: string } | null;
};

type Facts = {
  quotes: string[];
  metrics: Metric[];
  percent: Metric | undefined;
  brand: string;
  url: string;
  d: Direction;
  used: Set<string>;
};

// Each quote goes to one element only: the first that asks for it.
const free = (f: Facts) => f.quotes.filter((q) => !f.used.has(q));
const take = <T extends string | undefined>(f: Facts, picked: T[]): T[] => {
  for (const q of picked) if (q) f.used.add(q);
  return picked;
};
// "Start tonight", "Order now": kept for the call to action.
const ACTION =
  /^(get|try|start|book|order|download|sign|join|buy|shop|see|claim|grab)\b/i;
const isAction = (q: string) => ACTION.test(q) && words(q) <= 5;
const short = (f: Facts) =>
  free(f).filter((q) => words(q) <= 3 && !isAction(q));
const sentences = (f: Facts) => free(f).filter((q) => words(q) >= 3);

const RULES: Rule[] = [
  {
    block: "wordmark",
    place: "open",
    trigger: /wordmark|\blogo\b|brand mark|end card|brand name/,
    build: (f) =>
      f.brand
        ? {
            props: { name: f.brand },
            reason: "The prompt opens or closes on the brand's wordmark.",
          }
        : null,
  },
  {
    block: "kinetic-title",
    place: "open",
    trigger: /kinetic|typograph|headline|title|mask line|rises? (in|out)/,
    build: (f) => {
      const title = free(f).find((q) => words(q) >= 2 && words(q) <= 7);
      if (!title) return null;
      const subtitle = free(f).find((q) => q !== title && words(q) <= 9) ?? "";
      take(f, [title, subtitle]);
      return {
        props: { title, subtitle },
        reason: `Headline from the prompt: “${title}”.`,
      };
    },
  },
  {
    block: "prompt-input",
    place: "body",
    trigger:
      /composer|\binput\b|search (bar|field)|prompt (box|field)|types? (out|the (request|question|job))|typing|ask \[/,
    build: (f) => {
      const [text] = take(f, [sentences(f)[0]]);
      return text
        ? {
            props: { text, button: "Send" },
            reason: `A request typed into a field: “${text}”.`,
          }
        : null;
    },
  },
  {
    block: "chat-bubbles",
    place: "body",
    trigger: /\bchat\b|bubbles?|repl(y|ies)|conversation/,
    build: (f) => {
      const msgs = sentences(f).slice(0, 4);
      if (msgs.length < 2) return null;
      take(f, msgs);
      return msgs.length >= 2
        ? {
            props: { messages: msgs.join("\n") },
            reason: "A question and its answer, as chat bubbles.",
          }
        : null;
    },
  },
  {
    block: "stat-counter",
    place: "body",
    trigger: /\d+%?\s+[a-z]/,
    build: (f) => {
      const m = f.metrics.find((x) => x.suffix !== "%") ?? f.metrics[0];
      return m
        ? {
            props: {
              value: m.value,
              prefix: m.prefix,
              suffix: m.suffix,
              label: m.label,
            },
            reason: `A number the prompt counts up: ${m.prefix}${m.value}${m.suffix} ${m.label}.`,
          }
        : null;
    },
  },
  {
    block: "bar-chart",
    place: "body",
    trigger: /\d+%?\s+[a-z]/,
    build: (f) =>
      f.metrics.filter((m) => m.listed).length >= 3
        ? {
            props: {
              items: f.metrics
                .filter((m) => m.listed)
                .slice(0, 6)
                .map((m) => `${m.label}: ${m.value}`)
                .join("\n"),
            },
            reason: "Several results side by side.",
          }
        : null,
  },
  {
    block: "line-chart",
    place: "body",
    trigger: /line chart|\bgraph\b|trend|curves? upward|growth|chart/,
    build: (f) => ({
      props: {
        points: "12, 18, 15, 26, 31, 44",
        value: f.percent ? `${f.percent.prefix}${f.percent.value}%` : "",
        label: f.percent?.label ?? "",
      },
      reason: "A chart that draws itself, as in the prompt.",
    }),
  },
  {
    block: "progress-ring",
    place: "body",
    trigger: /progress|loader|\bring\b|spinner|scanning/,
    build: (f) => ({
      props: { value: f.percent?.value ?? 100, label: f.percent?.label ?? "" },
      reason: "A loader that fills, as in the prompt.",
    }),
  },
  {
    block: "chips",
    place: "body",
    trigger: /\bchips?\b|badges?|\btags?\b|\bpills?\b|filters?/,
    build: (f) => {
      const items = short(f).slice(0, 6);
      if (items.length < 2) return null;
      take(f, items);
      return items.length >= 2
        ? {
            props: { items: items.join("\n") },
            reason: "Short labels as chips.",
          }
        : null;
    },
  },
  {
    block: "toast",
    place: "body",
    trigger: /toast|notification|alert/,
    build: (f) => {
      const [body] = take(f, [free(f)[0]]);
      return body
        ? {
            props: {
              title: f.brand || "Notification",
              body,
              icon: (f.brand || "N").slice(0, 1).toUpperCase(),
            },
            reason: "A notification, as in the prompt.",
          }
        : null;
    },
  },
  {
    block: "cards-row",
    place: "body",
    trigger: /\bcards?\b/,
    build: (f) => {
      const titles = short(f).slice(0, 3);
      if (titles.length < 2) return null;
      take(f, titles);
      return titles.length >= 2
        ? {
            props: { items: titles.join("\n") },
            reason: "Results laid out as cards.",
          }
        : null;
    },
  },
  {
    block: "checklist",
    place: "body",
    trigger: /checklist|check(s|ed)? off|ticks? off/,
    build: (f) => {
      const items = sentences(f).slice(0, 4);
      if (items.length < 2) return null;
      take(f, items);
      return items.length >= 2
        ? {
            props: { items: items.join("\n") },
            reason: "Points ticked off one by one.",
          }
        : null;
    },
  },
  {
    block: "cta-button",
    place: "close",
    trigger:
      /\bcta\b|call to action|end card|button|sign up|get started|download/,
    build: (f) => {
      const label = free(f).find(isAction) ?? "Get started";
      return {
        props: { label, url: f.url },
        reason: "The film ends on a call to action.",
      };
    },
  },
];

/** Where the trigger first appears: elements follow the prompt's order. */
const firstAt = (lower: string, re: RegExp) => {
  const m = re.exec(lower);
  return m ? m.index : Number.POSITIVE_INFINITY;
};

const PLACE_ORDER: Record<KitPlace, number> = { open: 0, body: 1, close: 2 };

export function kitOf(
  entry: { prompt: string; direction: Direction },
  ctx: KitContext,
): KitElement[] {
  const lower = entry.prompt.toLowerCase();
  const metrics = metricsOf(entry.prompt);
  const facts: Facts = {
    quotes: quotesOf(entry.prompt, ctx.brand || "your product"),
    metrics,
    percent: metrics.find((m) => m.suffix === "%"),
    brand: ctx.brand ?? "",
    url: ctx.url ?? "",
    d: entry.direction,
    used: new Set(),
  };
  const c = ctx.colors;
  const panel = mix(c.background, c.ink, 0.06);
  const colors: Record<string, string> = {
    ink: c.ink,
    accent: c.accent,
    panel,
    // Words drawn on the accent read on it.
    mine: onFill(c.accent, c),
    mark: onFill(c.accent, c),
    tagInk: onFill(c.accent, c),
    note: c.ink,
  };
  // Rules run in the order the prompt mentions them, so the first element
  // that asks for a quote gets it.
  const triggered = RULES.map((rule) => ({
    rule,
    at: firstAt(lower, rule.trigger),
  }))
    .filter((x) => x.at !== Number.POSITIVE_INFINITY)
    .sort((a, b) => a.at - b.at);
  const picked: { at: number; element: KitElement }[] = [];
  for (const { rule, at } of triggered) {
    const built = rule.build(facts);
    const block = blockById(rule.block);
    if (!built || !block) continue;
    const props = { ...built.props };
    for (const spec of block.props)
      if (spec.type === "color" && colors[spec.name])
        props[spec.name] = colors[spec.name];
    // Chips and buttons carry their words on the accent.
    if (rule.block === "chips" || rule.block === "cta-button")
      props.ink = onFill(c.accent, c);
    picked.push({
      at,
      element: {
        block: rule.block,
        props,
        place: rule.place,
        reason: built.reason,
      },
    });
  }
  // A launch, an ad or a brand film with nothing quotable still opens on the
  // brand and closes on its call to action, in the inspiration's style.
  const branded = entry.direction.genres.some((g) =>
    ["launch", "ad", "brand", "demo"].includes(g),
  );
  if (branded && ctx.brand) {
    const has = (id: string) => picked.some((p) => p.element.block === id);
    const add = (
      block: string,
      place: KitPlace,
      props: Record<string, string>,
      reason: string,
    ) => {
      const spec = blockById(block);
      if (!spec) return;
      for (const sp of spec.props)
        if (sp.type === "color" && colors[sp.name])
          props[sp.name] = colors[sp.name];
      if (block === "cta-button") props.ink = onFill(c.accent, c);
      picked.push({
        at: Number.POSITIVE_INFINITY,
        element: { block, props, place, reason },
      });
    };
    if (!has("wordmark") && !has("kinetic-title"))
      add(
        "wordmark",
        "open",
        { name: ctx.brand },
        "Your brand opens the film, in the inspiration's style.",
      );
    if (ctx.tagline && !has("kinetic-title"))
      add(
        "kinetic-title",
        "open",
        { title: ctx.tagline, subtitle: "" },
        "Your tagline as a kinetic title.",
      );
    if (!has("cta-button"))
      add(
        "cta-button",
        "close",
        { label: "Get started", url: ctx.url ?? "" },
        "The film ends on your call to action.",
      );
  }
  // A film holds a few elements well: at most two to open, four along the scenes, one to close.
  const cap: Record<KitPlace, number> = { open: 2, body: 4, close: 1 };
  return picked
    .filter((p) => cap[p.element.place]-- > 0)
    .sort(
      (a, b) =>
        PLACE_ORDER[a.element.place] - PLACE_ORDER[b.element.place] ||
        a.at - b.at,
    )
    .map((p) => p.element);
}

/**
 * Start times for a kit in a film of `duration` seconds: openings after the
 * first beat, closings just before the end, the rest spread across the scenes.
 */
export function kitTimes(
  kit: { place: KitPlace; duration: number }[],
  duration: number,
): number[] {
  const body = kit.filter((k) => k.place === "body").length;
  let b = 0;
  let open = 0.4;
  return kit.map((k) => {
    if (k.place === "open") {
      const t = open;
      open += k.duration + 0.2;
      return Math.min(t, Math.max(0, duration - k.duration));
    }
    if (k.place === "close") return Math.max(0, duration - k.duration - 0.3);
    const span = duration * 0.7;
    const t =
      duration * 0.15 +
      (body > 1
        ? (b / (body - 1)) * (span - k.duration)
        : span / 2 - k.duration / 2);
    b += 1;
    return Math.max(0, Math.min(t, duration - k.duration));
  });
}
