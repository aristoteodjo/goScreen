// Talks to the running goScreen: reads the private connection file the app
// writes at start (`<config>/goScreen/control.json`) and posts commands.

import { readFileSync } from "node:fs";
import { request } from "node:http";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** Where the app writes its connection file, per OS (same as `dirs::config_dir`). */
export function controlFile(
  env = process.env,
  os = platform(),
  home = homedir(),
) {
  if (env.GOSCREEN_CONTROL_FILE) return env.GOSCREEN_CONTROL_FILE;
  const base =
    os === "darwin"
      ? join(home, "Library", "Application Support")
      : os === "win32"
        ? (env.APPDATA ?? join(home, "AppData", "Roaming"))
        : (env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return join(base, "goScreen", "control.json");
}

export class NotRunning extends Error {}

export function readConnection(file = controlFile()) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new NotRunning(
      "goScreen is not running: open the app, then try again.",
    );
  }
  if (typeof raw?.url !== "string" || typeof raw?.token !== "string")
    throw new NotRunning(
      "goScreen's connection file is unreadable: restart the app.",
    );
  return raw;
}

/** Runs a command in the app; resolves to `{ ok, result | error }`. */
export function call(command, input = {}, conn = readConnection()) {
  // node:http, not fetch: fetch gives up after 5 minutes, and an export or a
  // recording can take longer. The app answers within 30 minutes.
  const url = new URL("/v1/run", conn.url);
  const body = JSON.stringify({ command, input });
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${conn.token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (typeof parsed?.ok === "boolean") return resolve(parsed);
          } catch {}
          resolve({ ok: false, error: `goScreen answered ${res.statusCode}.` });
        });
      },
    );
    req.on("error", () =>
      reject(new NotRunning("goScreen does not answer: is it open?")),
    );
    req.end(body);
  });
}
