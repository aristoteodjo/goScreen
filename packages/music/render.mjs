#!/usr/bin/env node
// Renders a music bed or a sound effect to a WAV file:
//   node render.mjs <job.json> <out.wav>
// job = { "kind": "music", "style", "seed", "duration", "payoff"? }  (a plan is built)
//     | { "kind": "music", "plan", "duration", "offset"? }             (a plan is given)
//     | { "kind": "sfx", "sfx": "pop", "level"?: "soft" | "full" }
// Prints one JSON line: {"type":"done","offset":…,"plan":…} or {"type":"error","message":…}.
// Needs Node 22.6 or later (TypeScript sources are stripped of their types).

import { readFileSync, writeFileSync } from "node:fs";
import {
  alignToPayoff,
  encodeWav,
  musicPlan,
  musicPlanSchema,
  musicStyleSchema,
  PLAN_SLACK,
  renderMusic,
  renderSfx,
  SAMPLE_RATE,
  sfxKindSchema,
  sfxLevelSchema,
} from "./src/index.ts";

function run(job) {
  if (job.kind === "sfx") {
    const kind = sfxKindSchema.parse(job.sfx);
    const level = sfxLevelSchema.parse(job.level ?? "full");
    return { samples: renderSfx(kind, SAMPLE_RATE, level), offset: 0, plan: null };
  }
  const duration = Number(job.duration);
  if (!(duration > 0 && duration <= 1800)) throw new Error("duration must be 0..1800 s");
  let plan;
  let offset = 0;
  if (job.plan) {
    plan = musicPlanSchema.parse(job.plan);
    offset = Math.max(0, Number(job.offset) || 0);
  } else {
    const style = musicStyleSchema.parse(job.style);
    const seed = Math.max(0, Math.floor(Number(job.seed) || 0));
    plan = musicPlan(style, seed, duration + PLAN_SLACK);
    if (job.payoff !== undefined && job.payoff !== null)
      offset = alignToPayoff(plan, Number(job.payoff) || 0);
  }
  return { samples: renderMusic(plan, duration, SAMPLE_RATE, offset), offset, plan };
}

const [jobFile, outFile] = process.argv.slice(2);
try {
  if (!jobFile || !outFile) throw new Error("usage: render.mjs <job.json> <out.wav>");
  const job = JSON.parse(readFileSync(jobFile, "utf8"));
  const { samples, offset, plan } = run(job);
  writeFileSync(outFile, encodeWav(samples, SAMPLE_RATE));
  process.stdout.write(
    `${JSON.stringify({ type: "done", offset, seconds: samples.length / SAMPLE_RATE, plan })}\n`,
  );
} catch (e) {
  process.stdout.write(
    `${JSON.stringify({ type: "error", message: e instanceof Error ? e.message : String(e) })}\n`,
  );
  process.exit(1);
}
