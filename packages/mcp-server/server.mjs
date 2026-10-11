#!/usr/bin/env node
// goScreen MCP server (stdio). Add it to an AI client, e.g.
//   claude mcp add goscreen -- node /path/to/packages/mcp-server/server.mjs
import { createInterface } from "node:readline";
import { call } from "./client.mjs";
import { handle } from "./protocol.mjs";

const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
    );
    return;
  }
  const out = await handle(msg, {
    call: (command, input) => call(command, input),
  });
  if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
});
