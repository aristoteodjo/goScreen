import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  longestStill,
  motionEvents,
  score,
  timelineOf,
  timelineTime,
} from "./score.mjs";
import { SCENARIOS, scenario } from "./scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const reference = (name) =>
  JSON.parse(
    readFileSync(
      resolve(here, "../../skills/goscreen/references", name),
      "utf8",
    ),
  );

const slide = (id, title, duration = 2) => ({
  id,
  kind: "slide",
  transition: null,
  duration,
  background: { kind: "color", value: "#121a24" },
  title,
  subtitle: "",
  color: "#ffffff",
  font: "Inter",
  animation: "words",
});
const clip = (id, start, end, speed = 1) => ({
  id,
  kind: "recording",
  transition: null,
  in: start,
  out: end,
  speed,
  muted: true,
  cameraHidden: true,
});
const text = (id, start, duration, t, extra = {}) => ({
  id,
  kind: "text",
  lane: 0,
  start,
  duration,
  x: 0.5,
  y: 0.14,
  width: 0.8,
  height: 0.1,
  rotation: 0,
  opacity: 1,
  enter: "spring",
  exit: "fade",
  motion: 0.4,
  text: t,
  style: {
    font: "Inter",
    size: 0.05,
    weight: 800,
    color: "#ffffff",
    align: "left",
    background: null,
  },
  ...extra,
});

const good = () => ({
  version: 2,
  aspect: "9:16",
  clips: [
    slide("intro", "Stop *chasing* invoices", 1.6),
    clip("scene-0", 0, 6),
    clip("scene-1", 6, 12),
    slide("outro", "Start *free* today", 2.4),
  ],
  overlays: [
    text("caption-0", 1.6, 6, "Every invoice, *one* inbox"),
    text("caption-1", 7.6, 6, "Paid in *2* clicks"),
  ],
  zooms: [
    { id: "z0", start: 2.4, end: 5, scale: 1.15, focus: null },
    { id: "z1", start: 8.5, end: 11.5, scale: 1.15, focus: null },
  ],
});

test("timeline lays clips end to end, at their speed, and maps source time", () => {
  const t = timelineOf({
    clips: [slide("intro", "x", 2), clip("a", 0, 6), clip("b", 6, 12, 2)],
  });
  assert.equal(t.duration, 2 + 6 + 3);
  assert.equal(timelineTime(t, 0), 2);
  assert.equal(timelineTime(t, 9), 8 + 1.5);
  assert.equal(timelineTime(t, 20), null);
  assert.equal(timelineOf({ clips: [clip("a", 0, 1e9)] }).open, true);
  assert.equal(timelineOf({ clips: [clip("a", 0, 1e9)] }, 30).duration, 30);
});

test("a good montage passes every check", () => {
  const r = score(good(), {
    aspect: "9:16",
    duration: [15, 30],
    phrases: ["Paid in 2 clicks"],
  });
  assert.equal(r.pass, true, JSON.stringify(r.checks.filter((c) => !c.pass)));
  assert.equal(r.duration, 16);
});

const failing = (r, id) => r.checks.find((c) => c.id === id)?.pass === false;

test("duration out of range, wrong aspect and missing phrases fail", () => {
  const r = score(good(), {
    aspect: "16:9",
    duration: [20, 30],
    phrases: ["Book a demo"],
  });
  assert.ok(failing(r, "aspect"));
  assert.ok(failing(r, "duration"));
  assert.ok(failing(r, "phrases"));
  assert.match(r.checks.find((c) => c.id === "phrases").detail, /Book a demo/);
});

test("an empty first second fails first-motion", () => {
  const e = good();
  e.clips[0] = { ...e.clips[0], animation: "none" };
  e.overlays = e.overlays.map((o) => ({ ...o, start: o.start + 1 }));
  e.zooms = [];
  assert.ok(failing(score(e), "first-motion"));
});

test("long lines and accent counts are caught on captions and cards", () => {
  const e = good();
  e.overlays[0].text = "Every single invoice in one single *inbox*";
  e.overlays[1].text = "Paid in two clicks";
  e.clips[3].title = "Start *free* *today*";
  const r = score(e);
  assert.ok(failing(r, "line-words"));
  assert.match(r.checks.find((c) => c.id === "line-words").detail, /7 words/);
  const accents = r.checks.find((c) => c.id === "one-accent");
  assert.equal(accents.pass, false);
  assert.match(accents.detail, /caption-1: 0 accent/);
  assert.match(accents.detail, /outro.title: 2 accent/);
});

test("linear and overshooting eases fail; the last key's ease is ignored", () => {
  const e = good();
  e.overlays.push(
    text("note", 3, 3, "A note", {
      enter: "none",
      keyframes: {
        opacity: [
          { t: 0, value: 0, ease: "out" },
          { t: 0.3, value: 1, ease: "linear" },
        ],
      },
    }),
  );
  assert.equal(score(e).checks.find((c) => c.id === "no-linear").pass, true);
  e.overlays.at(-1).keyframes.opacity[0].ease = "linear";
  assert.ok(failing(score(e), "no-linear"));
  e.overlays.at(-1).keyframes.opacity[0].ease = "elastic";
  assert.ok(failing(score(e), "no-overshoot"));
  e.overlays.at(-1).keyframes.opacity[0].ease = { bezier: [0.16, 1, 0.3, 1] };
  const r = score(e);
  assert.equal(failing(r, "no-linear") || failing(r, "no-overshoot"), false);
});

test("zooms above 1.15 fail", () => {
  const e = good();
  e.zooms[0].scale = 1.8;
  assert.ok(failing(score(e), "zoom-scale"));
});

test("a still stretch longer than 4 s fails motion-gaps", () => {
  const e = good();
  e.clips[2] = clip("scene-1", 6, 16);
  e.overlays[1].duration = 10;
  e.zooms = [e.zooms[0]];
  const r = score(e);
  assert.ok(failing(r, "motion-gaps"));
  assert.match(r.checks.find((c) => c.id === "motion-gaps").detail, /10 s/);
  const events = motionEvents(e, timelineOf(e));
  assert.ok(events.includes(7.6));
});

test("two effects within 0.2 s fail one-per-beat; a kicker with its caption is fine", () => {
  const e = good();
  e.overlays.push(text("kicker-0", 1.6, 6, "BUYER · 1/2", { enter: "fade" }));
  assert.equal(score(e).checks.find((c) => c.id === "one-per-beat").pass, true);
  e.overlays.push(text("note", 1.7, 2, "Now", { enter: "fade" }));
  const r = score(e);
  assert.ok(failing(r, "one-per-beat"));
  assert.match(
    r.checks.find((c) => c.id === "one-per-beat").detail,
    /caption-0 and note/,
  );
});

test("the call to action is a closing card, a late text or a cta-button block", () => {
  const e = good();
  e.clips.pop();
  assert.ok(failing(score(e), "cta"));
  e.overlays.push({
    id: "cta",
    kind: "video",
    lane: 3,
    start: 11,
    duration: 2.6,
    x: 0.5,
    y: 0.8,
    width: 0.7,
    height: 0.2,
    rotation: 0,
    opacity: 1,
    enter: "none",
    exit: "none",
    motion: 0.4,
    asset: "b1",
    in: 0,
    volume: 0,
    radius: 0,
    source: { block: "cta-button", props: { label: "Start free" } },
  });
  assert.equal(score(e).checks.find((c) => c.id === "cta").pass, true);
});

test("a loop needs the last card to match the first", () => {
  const e = good();
  assert.ok(failing(score(e, { loop: true }), "loop"));
  e.clips[3] = { ...e.clips[0], id: "outro" };
  assert.equal(
    score(e, { loop: true }).checks.find((c) => c.id === "loop").pass,
    true,
  );
});

test("open-ended clips need a source duration", () => {
  const e = good();
  e.clips[2] = clip("scene-1", 6, 1e9);
  assert.ok(failing(score(e, { duration: [10, 40] }), "duration"));
  assert.equal(
    score(e, { duration: [10, 40], sourceDuration: 12 }).checks.find(
      (c) => c.id === "duration",
    ).pass,
    true,
  );
});

test("the reference montages pass their scenario's checks", () => {
  for (const [file, id] of [
    ["ad-9x16.edit.json", "ad-9x16"],
    ["launch-16x9.edit.json", "launch-16x9"],
    ["proof-1x1.edit.json", "proof-1x1"],
    ["dynamic-16x9.edit.json", "dynamic-ad"],
  ]) {
    const r = score(reference(file), scenario(id).options);
    assert.equal(
      r.pass,
      true,
      `${file}: ${JSON.stringify(r.checks.filter((c) => !c.pass))}`,
    );
  }
});

test("every scenario has a prompt, options and a way to find its video", () => {
  assert.equal(SCENARIOS.length, 6);
  for (const s of SCENARIOS) {
    assert.ok(s.prompt.length > 40, s.id);
    assert.ok(Array.isArray(s.options.duration), s.id);
    assert.ok(["video", "site"].includes(s.needs), s.id);
  }
  assert.equal(scenario("nope"), null);
});

test("the dynamic rules catch a still card, a dry cut, a missing 3D scene, silence and no music", () => {
  const e = reference("dynamic-16x9.edit.json");
  const opts = scenario("dynamic-ad").options;
  const base = score(e, opts);
  assert.equal(
    base.pass,
    true,
    JSON.stringify(base.checks.filter((c) => !c.pass)),
  );
  const stretch = longestStill(e, timelineOf(e));
  assert.ok(stretch.to - stretch.from <= 2, JSON.stringify(stretch));

  // A bare card held 3 s with nothing over it.
  const still = structuredClone(e);
  still.clips.splice(1, 0, {
    ...still.clips[0],
    id: "hold",
    duration: 3,
    transition: { kind: "push", duration: 0.5 },
  });
  still.overlays = still.overlays.map((o) =>
    o.start >= 1.5 ? { ...o, start: o.start + 3 } : o,
  );
  still.audio = still.audio.map((a) =>
    a.start >= 1.5 ? { ...a, start: a.start + 3 } : a,
  );
  const r1 = score(still, opts);
  assert.ok(failing(r1, "dyn-still"));
  assert.match(
    r1.checks.find((c) => c.id === "dyn-still").detail,
    /3 s from 1.5 s/,
  );

  const dry = structuredClone(e);
  dry.clips[2].transition = null;
  const r2 = score(dry, opts);
  assert.ok(failing(r2, "dyn-cuts"));
  assert.match(r2.checks.find((c) => c.id === "dyn-cuts").detail, /scene-0/);

  const flat = structuredClone(e);
  for (const o of flat.overlays)
    if (o.source) o.source.composition = "glow-stage";
  assert.ok(failing(score(flat, opts), "dyn-3d"));
  flat.overlays[1].popOut = true;
  assert.equal(
    score(flat, opts).checks.find((c) => c.id === "dyn-3d").pass,
    true,
  );

  const few = structuredClone(e);
  few.overlays = few.overlays.filter(
    (o) => o.source?.composition !== "chat-typing",
  );
  assert.equal(
    score(few, { ...opts, scenes: 5 }).checks.find((c) => c.id === "dyn-scenes")
      .pass,
    false,
  );
  assert.equal(
    score(few, { ...opts, scenes: 4 }).checks.find((c) => c.id === "dyn-scenes")
      .pass,
    true,
  );

  const quiet = structuredClone(e);
  quiet.audio = quiet.audio.filter(
    (a) => a.id === "music" || a.id.endsWith("-0") || a.id.endsWith("-1"),
  );
  const r3 = score(quiet, opts);
  assert.ok(failing(r3, "dyn-sfx"));
  assert.match(
    r3.checks.find((c) => c.id === "dyn-sfx").detail,
    /2 sound effect/,
  );
  quiet.film.settings.sound = "sparse";
  assert.match(
    score(quiet, opts).checks.find((c) => c.id === "dyn-sfx").detail,
    /sparse/,
  );

  const silent = structuredClone(e);
  silent.audio = silent.audio.filter((a) => a.id !== "music");
  assert.ok(failing(score(silent, opts), "dyn-music"));

  // The other references are not dynamic: without the option, no dynamic check runs.
  assert.equal(
    score(reference("ad-9x16.edit.json")).checks.some((c) =>
      c.id.startsWith("dyn-"),
    ),
    false,
  );
});
