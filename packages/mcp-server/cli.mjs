#!/usr/bin/env node
// goScreen from a terminal or a script:
//   goscreen list                       every command
//   goscreen projects.list
//   goscreen site.inspect '{"url":"https://example.com"}'
import { call, NotRunning } from "./client.mjs";

const [command, raw] = process.argv.slice(2);
try {
  if (!command || command === "help" || command === "list") {
    const answer = await call("control.catalog", {});
    if (!answer.ok) throw new Error(answer.error);
    for (const c of answer.result)
      console.log(
        `${c.name.padEnd(22)} ${c.title}${c.destructive ? "  (acts on real data)" : ""}`,
      );
    process.exit(0);
  }
  let input = {};
  if (raw) {
    try {
      input = JSON.parse(raw);
    } catch {
      throw new Error('The input must be JSON, e.g. \'{"project":"demo"}\'.');
    }
  }
  const answer = await call(command, input);
  if (!answer.ok) {
    console.error(answer.error);
    for (const i of answer.issues ?? []) console.error(`  ${i}`);
    process.exit(1);
  }
  console.log(JSON.stringify(answer.result, null, 2));
} catch (e) {
  console.error(e instanceof NotRunning ? e.message : String(e.message ?? e));
  process.exit(2);
}
