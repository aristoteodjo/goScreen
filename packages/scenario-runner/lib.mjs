// Pure helpers of the runner (tested with `node --test`).

/** Frames a constant-rate video must hold after `elapsed` seconds. */
export function framesDue(elapsed, fps) {
  return elapsed < 0 ? 0 : Math.floor(elapsed * fps) + 1;
}

/** Even pixel size of the take (x264 needs even sides). */
export function videoSize(width, height, dpr) {
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * dpr), height: even(height * dpr) };
}

/** Centre of a box, in glass coordinates (0..1 of the viewport). */
export function glassPoint(box, viewport) {
  return {
    u: (box.x + box.width / 2) / viewport.width,
    v: (box.y + box.height / 2) / viewport.height,
  };
}

/**
 * Scenes as chapters: `scene` opens one (closing the previous), `cut` closes
 * it, the end of the take closes the last. Returns the new open scene.
 */
export function sceneEvent(chapters, open, event) {
  if (open) chapters.push({ ...open, end: Math.max(open.start, event.at) });
  return event.kind === "scene"
    ? { url: event.url, start: event.at, caption: event.caption }
    : null;
}

/** Replaces {{code}} with the last code a masked banner showed. */
export function fillCode(text, code) {
  return text.replace(/\{\{\s*code\s*\}\}/g, code);
}

export const needsCode = (text) => /\{\{\s*code\s*\}\}/.test(text);

/** Fills values remembered during the run; an unknown name is an error. */
export function fillRemembered(text, memory) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, name) => {
    if (name === "code") return all;
    if (!(name in memory)) throw new Error(`{{${name}}} has no value yet.`);
    return memory[name];
  });
}

/** What `remember` keeps: the first group of `match`, its whole match, or the text. */
export function extract(text, match) {
  if (!match) return text.trim();
  const m = text.match(new RegExp(match));
  if (!m)
    throw new Error(`Nothing matches /${match}/ in "${text.slice(0, 80)}".`);
  return (m[1] ?? m[0]).trim();
}

/** Glass fractions -> page (layout) pixels, through the visual viewport. */
export function fromGlass(u, v, vv) {
  return { x: vv.x + u * vv.width, y: vv.y + v * vv.height };
}

/**
 * Ways to name an element, most robust first: a test id, then what a person
 * reads (role and name, label, placeholder, text), then structure (id, path).
 */
export function candidatesOrder(c) {
  const out = [];
  if (c.testId) out.push({ testId: c.testId });
  if (c.role) out.push({ role: c.role.role, name: c.role.name });
  if (c.label) out.push({ label: c.label });
  if (c.placeholder) out.push({ placeholder: c.placeholder });
  if (c.text) out.push({ text: c.text });
  if (c.id) out.push({ css: c.id });
  if (c.css) out.push({ css: c.css });
  return out;
}

/** The interactions journal (v3) of a device take. */
export function journal({ device, size, pointers, chapters }) {
  return {
    version: 3,
    mode: "device",
    capture: size,
    layers: [
      {
        instanceId: "scenario-glass",
        deviceId: device.id,
        colorId: device.colorId,
        orientation: device.height >= device.width ? "portrait" : "landscape",
        screen: { width: device.width, height: device.height },
        source: "web",
        rotation: 0,
        rects: [{ t: 0, x: 0, y: 0, width: 1, height: 1 }],
      },
    ],
    pointers,
    media: { camera: null, mic: null, offsetMs: 0 },
    pauses: [],
    camera: null,
    chapters,
  };
}

/** Frames of a composition (at least one). */
export function framesFor(duration, fps) {
  return Math.max(1, Math.round(duration * fps));
}

/**
 * FFmpeg arguments for a composition. Transparent ones keep their alpha:
 * HEVC with alpha (.mov, what WebKit plays) on macOS, VP9 with alpha (.webm)
 * elsewhere; opaque ones are plain H.264.
 */
export function composeArgs({ fps, out, transparent }, os = process.platform) {
  const input = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-c:v",
    "png",
    "-i",
    "-",
  ];
  if (!transparent)
    return [
      ...input,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "16",
      "-movflags",
      "+faststart",
      out,
    ];
  if (os === "darwin")
    return [
      ...input,
      "-c:v",
      "hevc_videotoolbox",
      "-alpha_quality",
      "0.9",
      "-allow_sw",
      "1",
      "-b:v",
      "12M",
      "-tag:v",
      "hvc1",
      out,
    ];
  return [
    ...input,
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-b:v",
    "6M",
    "-auto-alt-ref",
    "0",
    out,
  ];
}

/** The file extension a composition gets. */
export const composeExt = (transparent, os = process.platform) =>
  !transparent ? "mp4" : os === "darwin" ? "mov" : "webm";

/**
 * The file a composition asks for at http://goscreen.assets/<name>: a plain
 * file name (no folder, no hidden file) of a picture or a clip, else null.
 */
export function assetName(url) {
  const prefix = "http://goscreen.assets/";
  if (!url.startsWith(prefix)) return null;
  let name;
  try {
    name = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpe?g|webp|webm|mp4)$/i.test(name) ? name : null;
}

/** The bytes an HTTP `Range: bytes=a-b` header asks for, within `size`; null for all. */
export function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (!m[1] && !m[2]) || size === 0) return null;
  // `bytes=-n`: the last n bytes.
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}
