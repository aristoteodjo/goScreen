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
