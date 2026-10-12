#!/usr/bin/env node
// The studio's reproduction loop on one video, from a terminal: measure the
// video, derive its spec, render it, measure the rendering the same way and
// score it shot by shot. The same steps and code as the Reproduce screen
// (analyze.mjs, specFromObservations, specHtml, compose.mjs, measureShots),
// without the app: to check a change to any of them against a known video.
//
//   pnpm bench:reproduce <video> [--out <folder>] [--keep]
//
// Prints one line per shot and the mean; exits with 1 when a shot does not
// pass FIDELITY_PASS. The files (pictures, spec.json, render.mp4, report.json)
// are left in --out (a temporary folder by default, removed unless --keep).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIDELITY_PASS,
  fidelity,
  measureShots,
  Observations,
  parseMotionSpec,
  specFromObservations,
  specHtml,
} from "../src/index.ts";

const RUNNER = resolve(dirname(fileURLToPath(import.meta.url)), "../../scenario-runner");

const args = process.argv.slice(2);
const video = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out");
if (!video || !existsSync(video)) {
  console.error("Usage: pnpm bench:reproduce <video> [--out <folder>] [--keep]");
  process.exit(2);
}
const outAt = args.indexOf("--out");
const dir = outAt >= 0 ? resolve(args[outAt + 1]) : mkdtempSync(join(tmpdir(), "goscreen-bench-"));
const keep = outAt >= 0 || args.includes("--keep");
mkdirSync(dir, { recursive: true });

/** A tool from the PATH, else Homebrew's (as the app looks for it). */
function tool(name: string): string {
  for (const d of [...(process.env.PATH ?? "").split(":"), "/opt/homebrew/bin", "/usr/local/bin"])
    if (d && existsSync(join(d, name))) return join(d, name);
  throw new Error(`${name} not found (brew install ${name}).`);
}

const ffmpeg = tool("ffmpeg");
const tesseract = tool("tesseract");
// The app's French + English reading pack, when it was installed (accents).
const tessdata = join(homedir(), "Library/Application Support/goScreen/models/ocr-fr-en");
const lang = existsSync(join(tessdata, "fra.traineddata"))
  ? { lang: "fra+eng", tessdata }
  : {};

/** Runs a script of the runner with a job; throws its error message. */
function run(script: string, job: object, name: string) {
  const file = join(dir, `${name}.job.json`);
  writeFileSync(file, JSON.stringify(job));
  let out = "";
  try {
    out = execFileSync(process.execPath, [join(RUNNER, script), file], {
      cwd: RUNNER,
      maxBuffer: 1 << 28,
    }).toString();
  } catch (e) {
    out = String((e as { stdout?: Buffer }).stdout ?? "");
  } finally {
    rmSync(file, { force: true });
  }
  const last = JSON.parse(out.trim().split("\n").at(-1) || "{}");
  if (last.type !== "done") throw new Error(`${script}: ${last.message ?? "no result"}`);
}

const step = (s: string) => process.stderr.write(`· ${s}\n`);

try {
  step(`measuring ${video}`);
  run("analyze.mjs", { video: resolve(video), ffmpeg, tesseract, out: join(dir, "reference.observations.json"), crops: true, ...lang }, "analyze");
  const ref = Observations.parse(JSON.parse(readFileSync(join(dir, "reference.observations.json"), "utf8")));
  const parsed = parseMotionSpec(specFromObservations(ref));
  if (!parsed.ok) throw new Error(`spec: ${parsed.error}`);
  const spec = parsed.spec;
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 1));

  step(`rendering ${spec.shots.length} shots`);
  run("compose.mjs", {
    html: specHtml(spec),
    width: Math.floor(spec.width / 2) * 2,
    height: Math.floor(spec.height / 2) * 2,
    fps: 30,
    duration: spec.duration,
    transparent: false,
    out: join(dir, "render.mp4"),
    ffmpeg,
    assets: dir,
  }, "render");

  step("measuring the rendering");
  run("analyze.mjs", { video: join(dir, "render.mp4"), ffmpeg, tesseract, out: join(dir, "render.observations.json"), crops: false, ...lang }, "analyze-render");
  const out = Observations.parse(JSON.parse(readFileSync(join(dir, "render.observations.json"), "utf8")));

  const shots = measureShots(spec, ref, out).map((m) => ({ ...m, fidelity: fidelity(m) }));
  const mean = shots.reduce((a, m) => a + m.fidelity, 0) / (shots.length || 1);
  writeFileSync(join(dir, "report.json"), JSON.stringify({ score: mean, shots }, null, 1));

  const pct = (n: number) => `${Math.round(n * 100)}`.padStart(3);
  for (const m of shots) {
    const s = spec.shots.find((x) => x.id === m.id);
    const what =
      s?.kind === "text"
        ? s.lines.map((l) => l.words.map((w) => w.text).join(" ")).join(" / ")
        : `${s?.visuals.length ?? 0} pictures, ${s?.kind === "placeholder" ? s.labels.length : 0} labels`;
    console.log(
      `${m.fidelity >= FIDELITY_PASS ? " " : "✗"} ${m.id.padEnd(8)} ${s?.start.toFixed(2).padStart(6)}–${s?.end.toFixed(2).padEnd(6)}` +
        ` ${pct(m.fidelity)}  words ${m.outWords}/${m.refWords} timing ${(m.timing * 1000).toFixed(0).padStart(3)} ms` +
        ` pos ${(m.position * 100).toFixed(1).padStart(4)} % colour ${pct(m.color)} pictures ${pct(m.visuals)}  ${what.slice(0, 50)}`,
    );
  }
  const failed = shots.filter((m) => m.fidelity < FIDELITY_PASS).length;
  console.log(`mean ${mean.toFixed(3)} · ${shots.length - failed}/${shots.length} shots pass ${FIDELITY_PASS}`);
  if (keep) console.log(`files in ${dir}`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error(String((e as Error).message ?? e));
  process.exitCode = 2;
} finally {
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
