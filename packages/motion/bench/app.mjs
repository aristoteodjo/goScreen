#!/usr/bin/env node
// The reproduction test, through goScreen itself: the app (running, with its
// control server) measures the video, derives the spec, renders and scores
// it, with the very commands the Reproduce screen's buttons use
// (`motion.create`, `motion.render`). What the app gives is what a person
// gets; `bench/reproduce.ts` (no app) only helps between two of these runs.
//
//   pnpm reproduce:app <video>
//
// Prints one line per shot and the mean; exits with 1 when a shot does not
// pass the mark, 2 when the app is not running or a command fails. The new
// reference stays in the app (Reproduce screen) to look at side by side.

import { resolve } from "node:path";
import { call, NotRunning } from "../../mcp-server/client.mjs";

/** The motion package's FIDELITY_PASS. */
const PASS = 0.85;

const video = process.argv[2];
if (!video) {
  console.error("Usage: pnpm reproduce:app <video>");
  process.exit(2);
}

async function run(command, input) {
  const answer = await call(command, input);
  if (!answer.ok) throw new Error(`${command}: ${answer.error}`);
  return answer.result;
}

try {
  process.stderr.write(`· goScreen measures ${video}\n`);
  const created = await run("motion.create", { video: resolve(video) });
  process.stderr.write(`· reference ${created.reference}, ${created.shots.length} shots; rendering\n`);
  const report = await run("motion.render", { reference: created.reference });
  const shots = new Map(created.shots.map((s) => [s.id, s]));
  const pct = (n) => `${Math.round(n * 100)}`.padStart(3);
  for (const m of report.shots) {
    const s = shots.get(m.id);
    console.log(
      `${m.fidelity >= PASS ? " " : "✗"} ${m.id.padEnd(8)} ${s?.start.toFixed(2).padStart(6)}–${s?.end.toFixed(2).padEnd(6)}` +
        ` ${pct(m.fidelity)}  ${m.kind ?? s?.kind}  words ${m.outWords}/${m.refWords} pictures ${pct(m.visuals ?? 1)}  ${(s?.text ?? s?.label ?? "").slice(0, 50)}`,
    );
  }
  const failed = report.shots.filter((m) => m.fidelity < PASS).length;
  console.log(
    `mean ${report.score.toFixed(3)} · ${report.shots.length - failed}/${report.shots.length} shots pass ${PASS}` +
      ` · reference ${created.reference} (${report.render})`,
  );
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error(e instanceof NotRunning ? "goScreen is not running: start it (portly)." : String(e.message ?? e));
  process.exitCode = 2;
}
