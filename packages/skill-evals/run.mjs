#!/usr/bin/env node
// Plays an eval scenario against the running goScreen and scores the result.
//
//   node packages/skill-evals/run.mjs                      list scenarios
//   node packages/skill-evals/run.mjs ad-9x16 --video /abs/take.mp4
//   node packages/skill-evals/run.mjs all --video /abs/take.mp4 --model manual
//   node packages/skill-evals/run.mjs --score-only file.edit.json [--scenario ad-9x16]
//
// The model is Claude through `claude -p` when that CLI is on the PATH (it
// drives goScreen with the MCP tools or the CLI), else "manual": the prompt
// is printed and scoring waits for Enter. Scores are mechanical (score.mjs).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { call, NotRunning } from "../mcp-server/client.mjs";
import { report, score } from "./score.mjs";
import { SCENARIOS, scenario } from "./scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(here, "../../skills/goscreen/SKILL.md");
const CLI = resolve(here, "../mcp-server/cli.mjs");

function args(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
    else out.positional.push(a);
  }
  return out;
}

const hasClaude = () =>
  spawnSync("claude", ["--version"], { stdio: "ignore" }).status === 0;

function prompt(s, video) {
  return [
    `Read the goScreen skill at ${SKILL} and follow its route (workflow, rules, script, editing).`,
    `goScreen is open; drive it with the goscreen MCP tools, or the CLI: node ${CLI} <command> '<json>'.`,
    video ? `The take to work on is ${video} (its montage: edit.get with that path).` : "",
    s.prompt,
    "Do not export. When the montage is done and checked against the quality bar, stop and print DONE.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function waitEnter(text) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((r) => rl.question(text, r));
  rl.close();
}

async function playScenario(s, video, model) {
  const text = prompt(s, video);
  if (model === "claude") {
    console.log(`\n== ${s.id}: asking Claude\n`);
    const r = spawnSync("claude", ["-p", text], { stdio: "inherit" });
    if (r.status !== 0) console.error(`claude exited with ${r.status}`);
  } else {
    console.log(`\n== ${s.id}: manual mode. Give this prompt to a model:\n\n${text}\n`);
    await waitEnter("Press Enter when the montage is done to score it. ");
  }
}

/** The video to score: given, or the newest one a task produced. */
async function videoToScore(video) {
  if (video) return video;
  const tasks = await call("tasks.list", {});
  if (!tasks.ok) throw new Error(tasks.error);
  const done = tasks.result.find((t) => t.video);
  if (!done) throw new Error("No recorded task to score: give --video.");
  return done.video;
}

async function scoreVideo(video, s) {
  const got = await call("edit.get", { video });
  if (!got.ok) throw new Error(got.error);
  const chapters = got.result.scenes ?? [];
  const sourceDuration = chapters.length ? Math.max(...chapters.map((c) => c.end)) : null;
  return score(got.result.edit, { ...s.options, sourceDuration });
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a["score-only"]) {
    const file = typeof a["score-only"] === "string" ? a["score-only"] : a.positional[0];
    const s = a.scenario ? scenario(a.scenario) : null;
    const edit = JSON.parse(readFileSync(resolve(file), "utf8"));
    const result = score(edit, s?.options ?? {});
    console.log(report(result));
    process.exit(result.pass ? 0 : 1);
  }
  const which = a.positional[0];
  if (!which) {
    for (const s of SCENARIOS) console.log(`${s.id.padEnd(18)} ${s.title}`);
    console.log("\nnode packages/skill-evals/run.mjs <id|all> --video /abs/take.mp4 [--model claude|manual]");
    return;
  }
  const chosen = which === "all" ? SCENARIOS : [scenario(which)].filter(Boolean);
  if (chosen.length === 0) throw new Error(`No scenario "${which}".`);
  const model = a.model ?? (hasClaude() ? "claude" : "manual");
  const status = await call("app.status", {});
  if (!status.ok) throw new Error(status.error);

  const results = [];
  for (const s of chosen) {
    if (s.needs === "video" && !a.video) throw new Error(`${s.id} needs --video (an open take).`);
    await playScenario(s, a.video, model);
    const video = await videoToScore(s.needs === "video" ? a.video : null);
    const result = await scoreVideo(video, s);
    console.log(`\n-- ${s.id} (${video})\n${report(result)}`);
    results.push({ scenario: s.id, video, ...result });
  }
  console.log(`\n${JSON.stringify(results, null, 2)}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof NotRunning ? e.message : String(e.message ?? e));
  process.exit(2);
});
