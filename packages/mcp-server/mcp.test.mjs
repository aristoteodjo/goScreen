import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { controlFile } from "./client.mjs";
import { handle, toContent, toTool, toolName } from "./protocol.mjs";

const CATALOG = [
  {
    name: "projects.list",
    title: "List projects",
    description: "Projects.",
    destructive: false,
    inputSchema: { $schema: "x", type: "object", properties: {} },
  },
  {
    name: "tasks.record",
    title: "Record the VSL",
    description: "Records.",
    destructive: true,
    inputSchema: {
      type: "object",
      properties: { project: { type: "string" } },
    },
  },
];

test("connection file follows each OS's config folder", () => {
  assert.equal(
    controlFile({}, "darwin", "/Users/a"),
    "/Users/a/Library/Application Support/goScreen/control.json",
  );
  assert.equal(
    controlFile({}, "linux", "/home/a"),
    "/home/a/.config/goScreen/control.json",
  );
  assert.equal(
    controlFile({ GOSCREEN_CONTROL_FILE: "/x.json" }, "linux", "/h"),
    "/x.json",
  );
});

test("commands become MCP tools, destructive ones flagged", () => {
  assert.equal(toolName("vsl.importScenario"), "vsl_importScenario");
  const [list, rec] = CATALOG.map(toTool);
  assert.equal(list.name, "projects_list");
  assert.equal(list.inputSchema.$schema, undefined);
  assert.equal(rec.annotations.destructiveHint, true);
  assert.match(rec.description, /ask the person/);
});

test("screenshots come back as images, errors as tool errors", () => {
  const shot = toContent({
    ok: true,
    result: { title: "t", screenshot: "AAAA" },
  });
  assert.deepEqual(shot.content[1], {
    type: "image",
    data: "AAAA",
    mimeType: "image/jpeg",
  });
  assert.doesNotMatch(shot.content[0].text, /AAAA/);
  const bad = toContent({
    ok: false,
    error: "Invalid input",
    issues: ["project: required"],
  });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /project: required/);
});

test("JSON-RPC: initialize, list, call, unknown, notification", async () => {
  const calls = [];
  const deps = {
    call: async (command, input) => {
      calls.push([command, input]);
      return command === "control.catalog"
        ? { ok: true, result: CATALOG }
        : { ok: true, result: [1] };
    },
  };
  const init = await handle(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    },
    deps,
  );
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.ok(init.result.instructions.includes("site_inspect"));
  const tools = await handle(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    deps,
  );
  assert.deepEqual(
    tools.result.tools.map((t) => t.name),
    ["projects_list", "tasks_record"],
  );
  const res = await handle(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "projects_list", arguments: {} },
    },
    deps,
  );
  assert.deepEqual(calls.at(-1), ["projects.list", {}]);
  assert.equal(res.result.content[0].type, "text");
  assert.equal(
    (await handle({ jsonrpc: "2.0", id: 4, method: "nope" }, deps)).error.code,
    -32601,
  );
  assert.equal(
    await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, deps),
    null,
  );
});

test("a closed app is a plain tool error, not a crash", async () => {
  const deps = {
    call: async () => {
      throw new Error("goScreen is not running: open the app, then try again.");
    },
  };
  const res = await handle(
    {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "projects_list" },
    },
    deps,
  );
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /not running/);
});

test("end to end: the stdio server relays to the app with its token", async (t) => {
  const seen = [];
  const app = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      if (req.headers.authorization !== "Bearer secret") {
        res
          .writeHead(401)
          .end(JSON.stringify({ ok: false, error: "Not allowed." }));
        return;
      }
      const { command, input } = JSON.parse(body);
      seen.push(command);
      const result = command === "control.catalog" ? CATALOG : { echo: input };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "goscreen-mcp-"));
  const file = join(dir, "control.json");
  writeFileSync(
    file,
    JSON.stringify({
      url: `http://127.0.0.1:${app.address().port}`,
      token: "secret",
    }),
  );
  const child = spawn(
    process.execPath,
    [new URL("./server.mjs", import.meta.url).pathname],
    {
      env: { ...process.env, GOSCREEN_CONTROL_FILE: file },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  t.after(() => {
    child.kill();
    app.closeAllConnections();
    app.close();
  });
  const out = createInterface({ input: child.stdout });
  const replies = new Map();
  const waiters = new Map();
  out.on("line", (l) => {
    const m = JSON.parse(l);
    replies.set(m.id, m);
    waiters.get(m.id)?.();
  });
  const rpc = (id, method, params) => {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return new Promise((r) => {
      if (replies.has(id)) r(replies.get(id));
      else waiters.set(id, () => r(replies.get(id)));
    });
  };
  await rpc(1, "initialize", {});
  const list = await rpc(2, "tools/list", {});
  assert.equal(list.result.tools.length, 2);
  const res = await rpc(3, "tools/call", {
    name: "projects_list",
    arguments: { a: 1 },
  });
  assert.deepEqual(JSON.parse(res.result.content[0].text), { echo: { a: 1 } });
  assert.deepEqual(seen, ["control.catalog", "projects.list"]);

  writeFileSync(
    file,
    JSON.stringify({
      url: `http://127.0.0.1:${app.address().port}`,
      token: "wrong",
    }),
  );
  const denied = await rpc(4, "tools/call", { name: "projects_list" });
  assert.equal(denied.result.isError, true);
  out.close();
});
