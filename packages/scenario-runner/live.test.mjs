// End to end: the runner in live mode, against a local page. Picks by point
// must come back as steps that read like a person would write them.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";

const PAGE = `<!doctype html><meta charset=utf-8>
<style>body{margin:0;font:16px sans-serif} .at{position:absolute}</style>
<button class=at style="left:20px;top:20px;width:160px;height:40px">Pay now</button>
<label class=at style="left:20px;top:100px">Phone <input id=phone style="width:150px;height:30px"></label>
<button class=at style="left:20px;top:160px;width:80px;height:30px" aria-label="Add one">+</button>
<button class=at style="left:120px;top:160px;width:80px;height:30px" aria-label="Add one">+</button>
<iframe class=at src="/frame" style="left:0;top:300px;width:400px;height:200px;border:0"></iframe>`;
const FRAME = `<!doctype html><meta charset=utf-8><body style="margin:0">
<a href="#mm" style="position:absolute;left:10px;top:10px;width:200px;height:40px;display:block">Mobile Money</a>`;

const at = (x, y) => ({ u: x / 400, v: y / 800 });

test("live mode turns clicks and typing into steps", async (t) => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(req.url === "/frame" ? FRAME : PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const dir = mkdtempSync(join(tmpdir(), "goscreen-live-"));
  const job = join(dir, "job.json");
  writeFileSync(
    job,
    JSON.stringify({
      live: true,
      scenario: {
        version: 1,
        name: "live",
        url,
        locale: "en-US",
        colorScheme: "light",
        mask: [],
        steps: [{ do: "wait", ms: 100 }],
      },
      device: {
        id: "test",
        colorId: "x",
        width: 400,
        height: 800,
        dpr: 1,
        userAgent: "goScreen test",
        mobile: false,
        touch: false,
      },
      video: join(dir, "v.mp4"),
      interactions: join(dir, "v.json"),
      failShot: join(dir, "f.png"),
      ffmpeg: "ffmpeg",
    }),
  );
  const child = spawn(
    process.execPath,
    [new URL("./run.mjs", import.meta.url).pathname, job],
    {
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  t.after(() => {
    child.kill();
    server.closeAllConnections();
    server.close();
  });
  const events = createInterface({ input: child.stdout });
  const queue = [];
  let wake = null;
  events.on("line", (l) => {
    const e = JSON.parse(l);
    if (process.env.DEBUG_LIVE)
      console.error(
        "event",
        e.type,
        e.message ?? "",
        JSON.stringify(e.found ?? e.step ?? "").slice(0, 200),
      );
    if (e.type === "frame" || e.type === "preview" || e.type === "step") return;
    queue.push(e);
    wake?.();
  });
  const next = async (type) => {
    const until = Date.now() + 20_000;
    for (;;) {
      if (Date.now() > until) throw new Error(`no ${type} event`);
      const i = queue.findIndex((e) => e.type === type || e.type === "error");
      if (i >= 0) {
        const [e] = queue.splice(i, 1);
        if (e.type === "error") throw new Error(e.message);
        return e;
      }
      await new Promise((r) => {
        wake = r;
        setTimeout(r, 500);
      });
    }
  };
  const send = (cmd) => child.stdin.write(`${JSON.stringify(cmd)}\n`);

  await next("ready");

  send({ cmd: "inspect", id: 1, ...at(100, 40) });
  const seen = await next("inspect");
  assert.deepEqual(seen.found.target, {
    role: "button",
    name: "Pay now",
    exact: true,
  });
  assert.ok(Math.abs(seen.found.box.u - 20 / 400) < 0.01);

  send({ cmd: "tap", ...at(100, 40) });
  assert.deepEqual((await next("recorded")).step, {
    do: "tap",
    target: { role: "button", name: "Pay now", exact: true },
  });
  await next("picked");

  send({ cmd: "tap", ...at(150, 115) });
  const phone = await next("picked");
  assert.equal(phone.found.editable, true);
  assert.deepEqual(phone.found.target, {
    role: "textbox",
    name: "Phone",
    exact: true,
  });
  await next("recorded");
  send({
    cmd: "type",
    target: phone.found.target,
    text: "{{phone}}",
    value: "0100",
  });
  assert.deepEqual((await next("recorded")).step, {
    do: "type",
    target: { role: "textbox", name: "Phone", exact: true },
    text: "{{phone}}",
  });

  // Two buttons with the same name: the second is told apart by its rank.
  send({ cmd: "tap", act: false, ...at(150, 175) });
  assert.deepEqual((await next("picked")).found.target, {
    role: "button",
    name: "Add one",
    exact: true,
    nth: 1,
  });

  send({ cmd: "tap", act: false, ...at(60, 330) });
  assert.deepEqual((await next("picked")).found.target, {
    role: "link",
    name: "Mobile Money",
    exact: true,
    frame: `iframe[src*='127.0.0.1:${server.address().port}']`,
  });

  send({ cmd: "stop" });
  await next("done");
  events.close();
});
