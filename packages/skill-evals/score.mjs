// Mechanical scoring of a montage (an EditState as `edit.get` returns it)
// against the quality rules of skills/goscreen/rules.md. Pure: no app, no
// file, no clock. Every check names what it looked at, so a failing line is a
// concrete fix.

const OPEN_END = 1e8;
const MAX_WORDS = 6;
const MAX_ZOOM = 1.15;
const MAX_GAP = 4;
const FIRST_MOTION = 1;
const BEAT = 0.2;
const CTA_WINDOW = 3;
const OVERSHOOT = new Set(["elastic", "back"]);
// Dynamic look (rules.md "Dynamic look", references/dynamic-analysis.md).
const DYN_STILL = 2;
const DYN_SCENES = 3;
const DYN_SFX_EVERY = 2;
const MUSIC_MIN = 5;
const MUSIC_COVER = 0.8;
const SCENES_3D = new Set([
  "device-3d",
  "floating-cards",
  "cards-stack-3d",
  "icon-grid-3d",
  "carousel-3d",
  "orbit-updates",
]);

const words = (s) => s.replace(/\*/g, "").trim().split(/\s+/).filter(Boolean);
const accents = (s) => (s.match(/\*[^*]+\*/g) ?? []).length;
const plain = (s) => s.replace(/\*/g, "").toLowerCase();

/** The main track laid end to end: where each clip starts and how long it plays. */
export function timelineOf(edit, sourceDuration = null) {
  let at = 0;
  const clips = [];
  let open = false;
  for (const clip of edit.clips ?? []) {
    let length;
    if (clip.kind === "slide") length = clip.duration;
    else {
      const out = clip.out >= OPEN_END ? sourceDuration : clip.out;
      if (out === null || out === undefined) {
        open = true;
        length = 0;
      } else length = Math.max(0, out - clip.in) / (clip.speed || 1);
    }
    clips.push({ clip, at, length });
    at += length;
  }
  return { duration: at, clips, open };
}

/** Source seconds -> timeline seconds, through the recording clips; null when cut out. */
export function timelineTime(timeline, source) {
  for (const { clip, at, length } of timeline.clips) {
    if (clip.kind !== "recording") continue;
    const out = clip.in + length * (clip.speed || 1);
    if (source >= clip.in && source <= out)
      return at + (source - clip.in) / (clip.speed || 1);
  }
  return null;
}

function easesOf(overlay) {
  const found = [];
  for (const [prop, keys] of Object.entries(overlay.keyframes ?? {})) {
    if (!Array.isArray(keys)) continue;
    // The last key's ease leads nowhere: it is never played.
    keys.slice(0, -1).forEach((k, i) => {
      found.push({
        where: `${overlay.id}.${prop}[${i}]`,
        ease: k.ease ?? "in-out",
      });
    });
  }
  if (overlay.animator?.ease)
    found.push({
      where: `${overlay.id}.animator`,
      ease: overlay.animator.ease,
    });
  return found;
}

const easeName = (e) => (typeof e === "string" ? e : "bezier");

const texts = (edit) => [
  ...(edit.overlays ?? [])
    .filter((o) => o.kind === "text")
    .map((o) => ({
      id: o.id,
      text: o.text ?? "",
      caption: o.id.startsWith("caption-"),
    })),
  ...(edit.clips ?? [])
    .filter((c) => c.kind === "slide")
    .flatMap((c) => [
      { id: `${c.id}.title`, text: c.title ?? "", caption: false },
      { id: `${c.id}.subtitle`, text: c.subtitle ?? "", caption: false },
    ]),
];

const animated = (o) =>
  (o.enter && o.enter !== "none") ||
  (o.keyframes && Object.keys(o.keyframes).length > 0) ||
  Boolean(o.animator) ||
  o.kind === "video";

/** Moments where something visibly changes, in timeline seconds. */
export function motionEvents(edit, timeline) {
  const events = [0, timeline.duration];
  for (const { clip, at, length } of timeline.clips) {
    events.push(at);
    if (clip.kind === "slide" && clip.animation && clip.animation !== "none")
      events.push(at + Math.min(0.6, length));
  }
  for (const o of edit.overlays ?? []) {
    events.push(o.start, o.start + o.duration);
    for (const keys of Object.values(o.keyframes ?? {}))
      if (Array.isArray(keys)) for (const k of keys) events.push(o.start + k.t);
    if (o.animator) events.push(o.start + (o.animator.duration ?? 0));
  }
  for (const z of edit.zooms ?? []) {
    const s = timelineTime(timeline, z.start);
    const e = timelineTime(timeline, z.end);
    if (s !== null) events.push(s);
    if (e !== null) events.push(e);
  }
  return events
    .filter((t) => t >= 0 && t <= timeline.duration + 1e-6)
    .sort((a, b) => a - b);
}

/** Layers that are a rendered block or composition: they move for their whole length. */
const sceneLayers = (edit) =>
  (edit.overlays ?? []).filter((o) => o.kind === "video" && o.source);

/**
 * The longest stretch where nothing visibly changes, in timeline seconds. A
 * block or composition layer and a zoom (the camera keeps drifting on its
 * plateau) cover their own stretch; everything else counts as events.
 */
export function longestStill(edit, timeline) {
  const events = motionEvents(edit, timeline);
  const covered = sceneLayers(edit).map((o) => ({
    from: o.start,
    to: o.start + o.duration,
  }));
  for (const z of edit.zooms ?? []) {
    const s = timelineTime(timeline, z.start);
    const e = timelineTime(timeline, z.end);
    if (s !== null && e !== null) covered.push({ from: s, to: e });
  }
  covered.sort((a, b) => a.from - b.from);
  let best = { from: 0, to: 0 };
  for (let i = 1; i < events.length; i += 1) {
    const to = events[i];
    let from = events[i - 1];
    for (const c of covered)
      if (c.from <= from + 1e-6 && c.to > from) from = Math.min(c.to, to);
    if (to - from > best.to - best.from) best = { from, to };
  }
  return best;
}

/** Starts of graphics and zooms: two within a beat is one too many. */
function beatStarts(edit, timeline) {
  const starts = [];
  // A kicker is the title's label, placed with it by the film.
  for (const o of edit.overlays ?? [])
    if (!o.id.startsWith("kicker-")) starts.push({ id: o.id, t: o.start });
  for (const z of edit.zooms ?? []) {
    const t = timelineTime(timeline, z.start);
    if (t !== null) starts.push({ id: z.id, t });
  }
  return starts.sort((a, b) => a.t - b.t);
}

const fmt = (n) => Number(n.toFixed(2));

/**
 * Scores an edit. Options: `duration: [min, max]` seconds, `phrases: string[]`
 * that must appear on screen, `aspect`, `loop: true` when the film is
 * announced as a loop, `sourceDuration` for open-ended clips, `dynamic: true`
 * for the dynamic look (`scenes` = how many scene layers at least, 3 by default).
 */
export function score(edit, options = {}) {
  const checks = [];
  const add = (id, pass, detail) =>
    checks.push({ id, pass: Boolean(pass), detail });
  const timeline = timelineOf(edit, options.sourceDuration ?? null);
  const D = timeline.duration;

  if (options.aspect)
    add(
      "aspect",
      edit.aspect === options.aspect,
      `${edit.aspect} (wanted ${options.aspect})`,
    );

  if (options.duration) {
    const [min, max] = options.duration;
    add(
      "duration",
      !timeline.open && D >= min && D <= max,
      timeline.open
        ? "an open-ended clip: give sourceDuration"
        : `${fmt(D)} s (wanted ${min} to ${max} s)`,
    );
  }

  const firstMotion = Math.min(
    ...timeline.clips
      .filter(({ clip }) => clip.kind === "slide" && clip.animation !== "none")
      .map(({ at }) => at),
    ...(edit.overlays ?? []).filter(animated).map((o) => o.start),
    ...(edit.zooms ?? [])
      .map((z) => timelineTime(timeline, z.start))
      .filter((t) => t !== null),
    ...timeline.clips.slice(1).map(({ at }) => at),
  );
  add(
    "first-motion",
    firstMotion <= FIRST_MOTION,
    Number.isFinite(firstMotion)
      ? `first visual change at ${fmt(firstMotion)} s`
      : "nothing moves",
  );

  const longLines = texts(edit).flatMap((t) =>
    t.text
      .split("\n")
      .filter((line) => words(line).length > MAX_WORDS)
      .map((line) => `${t.id}: "${line.trim()}" (${words(line).length} words)`),
  );
  add(
    "line-words",
    longLines.length === 0,
    longLines.join("; ") || `every line ≤ ${MAX_WORDS} words`,
  );

  const badAccents = texts(edit)
    .filter((t) => (t.caption ? accents(t.text) !== 1 : accents(t.text) > 1))
    .map((t) => `${t.id}: ${accents(t.text)} accent(s)`);
  add(
    "one-accent",
    badAccents.length === 0,
    badAccents.join("; ") || "one accent per caption, never more",
  );

  const eases = (edit.overlays ?? []).flatMap(easesOf);
  const linear = eases.filter((e) => e.ease === "linear").map((e) => e.where);
  add(
    "no-linear",
    linear.length === 0,
    linear.join(", ") || `${eases.length} ease(s), none linear`,
  );
  const over = eases
    .filter((e) => OVERSHOOT.has(easeName(e.ease)))
    .map((e) => `${e.where} (${e.ease})`);
  add(
    "no-overshoot",
    over.length === 0,
    over.join(", ") || "no elastic or back ease",
  );

  const bigZooms = (edit.zooms ?? [])
    .filter((z) => z.scale > MAX_ZOOM)
    .map((z) => `${z.id} ×${z.scale}`);
  add(
    "zoom-scale",
    bigZooms.length === 0,
    bigZooms.join(", ") ||
      `${(edit.zooms ?? []).length} zoom(s) ≤ ×${MAX_ZOOM}`,
  );

  const events = motionEvents(edit, timeline);
  let gap = 0;
  let gapAt = 0;
  for (let i = 1; i < events.length; i += 1)
    if (events[i] - events[i - 1] > gap) {
      gap = events[i] - events[i - 1];
      gapAt = events[i - 1];
    }
  add(
    "motion-gaps",
    gap <= MAX_GAP,
    `longest still stretch ${fmt(gap)} s from ${fmt(gapAt)} s`,
  );

  const starts = beatStarts(edit, timeline);
  const crowded = [];
  for (let i = 1; i < starts.length; i += 1)
    if (starts[i].t - starts[i - 1].t < BEAT)
      crowded.push(
        `${starts[i - 1].id} and ${starts[i].id} at ${fmt(starts[i].t)} s`,
      );
  add(
    "one-per-beat",
    crowded.length === 0,
    crowded.join("; ") || "no two effects on one beat",
  );

  const last = timeline.clips.at(-1);
  const ctaCard =
    last &&
    last.clip.kind === "slide" &&
    words(last.clip.title ?? "").length > 0;
  // A scene title or its kicker is not a call to action.
  const ctaLayer = (edit.overlays ?? []).some(
    (o) =>
      o.start + o.duration >= D - CTA_WINDOW &&
      !o.id.startsWith("caption-") &&
      !o.id.startsWith("kicker-") &&
      (o.kind === "text"
        ? words(o.text ?? "").length > 0
        : o.source?.block === "cta-button"),
  );
  add(
    "cta",
    ctaCard || ctaLayer,
    ctaCard
      ? `closing card "${last.clip.title}"`
      : ctaLayer
        ? "a call to action in the last seconds"
        : "nothing to act on at the end",
  );

  if (options.phrases?.length) {
    const shown = texts(edit).map((t) => plain(t.text));
    const missing = options.phrases.filter(
      (p) => !shown.some((s) => s.includes(plain(p))),
    );
    add(
      "phrases",
      missing.length === 0,
      missing.length
        ? `missing: ${missing.map((p) => `"${p}"`).join(", ")}`
        : "every required phrase is on screen",
    );
  }

  if (options.loop) {
    const first = timeline.clips[0]?.clip;
    const lastClip = last?.clip;
    const same =
      first &&
      lastClip &&
      first.kind === "slide" &&
      lastClip.kind === "slide" &&
      first.title === lastClip.title &&
      first.subtitle === lastClip.subtitle &&
      JSON.stringify(first.background) === JSON.stringify(lastClip.background);
    add(
      "loop",
      same,
      same
        ? "last card matches the first"
        : "the last frame does not match frame 0",
    );
  }

  if (options.dynamic) {
    const still = longestStill(edit, timeline);
    add(
      "dyn-still",
      still.to - still.from <= DYN_STILL,
      `longest stretch without a change ${fmt(still.to - still.from)} s from ${fmt(still.from)} s`,
    );

    const scenes = sceneLayers(edit);
    const wanted = options.scenes ?? DYN_SCENES;
    const names = scenes.map((o) => o.source.composition ?? o.source.block);
    add(
      "dyn-scenes",
      scenes.length >= wanted,
      `${scenes.length} scene layer(s): ${names.join(", ") || "none"} (wanted ${wanted})`,
    );

    // A 3D scene, or a pop-out of the take (edit.popOut marks its layer `popOut`).
    const threeD = names.filter((n) => SCENES_3D.has(n));
    const popOuts = (edit.overlays ?? []).filter(
      (o) => o.popOut || o.source?.popOut,
    );
    add(
      "dyn-3d",
      threeD.length + popOuts.length > 0,
      threeD.length
        ? `3D scene(s): ${threeD.join(", ")}`
        : popOuts.length
          ? `${popOuts.length} pop-out(s)`
          : "no 3D scene and no pop-out",
    );

    const dry = (edit.clips ?? [])
      .slice(1)
      .filter((c) => !c.transition)
      .map((c) => c.id);
    add(
      "dyn-cuts",
      dry.length === 0,
      dry.length
        ? `dry cut into ${dry.join(", ")}`
        : "every clip boundary has a transition",
    );

    const music = (edit.audio ?? []).filter((a) => a.duration >= MUSIC_MIN);
    const coverage = music.reduce(
      (sum, a) => sum + Math.min(a.duration, Math.max(0, D - a.start)),
      0,
    );
    add(
      "dyn-music",
      D > 0 && coverage >= MUSIC_COVER * D,
      music.length
        ? `music covers ${fmt(Math.min(1, coverage / Math.max(D, 1e-6)) * 100)} % of the film`
        : "no music",
    );

    const full = edit.film?.settings?.sound === "full";
    const sfx = (edit.audio ?? []).filter((a) => a.duration < MUSIC_MIN);
    const needed = Math.ceil(D / DYN_SFX_EVERY);
    add(
      "dyn-sfx",
      full && sfx.length >= needed,
      full
        ? `${sfx.length} sound effect(s) (wanted ≥ ${needed}: one per ${DYN_SFX_EVERY} s)`
        : `film.sound is ${edit.film?.settings?.sound ?? "unset"}, wanted "full"`,
    );
  }

  const passed = checks.filter((c) => c.pass).length;
  return {
    pass: passed === checks.length,
    score: checks.length ? fmt(passed / checks.length) : 1,
    duration: fmt(D),
    checks,
  };
}

/** A readable table of a score. */
export function report(result) {
  const lines = result.checks.map(
    (c) => `${c.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(14)} ${c.detail}`,
  );
  lines.push(
    `${result.pass ? "PASS" : "FAIL"}  score ${result.score} · ${result.duration} s`,
  );
  return lines.join("\n");
}
