import { z } from "zod";
import {
  type Block,
  type BlockSize,
  escapeHtml,
  resolveProps,
} from "./blocks.ts";

// Compositions: HTML pages written by an AI or a person (the video-agent /
// Remotion way) that goScreen renders frame by frame like a block. The page
// is self-contained and deterministic: it animates with CSS / WAAPI, or it
// exposes `window.setT(t)` and draws the frame for that second. Props are
// injected as `window.__props` and substituted as `{{name}}` (escaped).

export const MAX_HTML_BYTES = 256 * 1024;

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "lowercase letters, digits and dashes");

export const propSpecSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/),
  label: z.string().min(1).max(80),
  type: z.enum(["text", "longtext", "color", "number"]),
  default: z.union([z.string(), z.number()]),
});

export const compositionSchema = z.object({
  id: slug,
  label: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  // Natural size of the page, in pixels.
  box: z.object({
    width: z.number().int().min(2).max(4096),
    height: z.number().int().min(2).max(4096),
  }),
  duration: z.number().min(0.1).max(60),
  transparent: z.boolean(),
  props: z.array(propSpecSchema).max(40),
  html: z.string().min(1),
});
export type Composition = z.infer<typeof compositionSchema>;

export type CompositionIssue = { path: string; message: string };

/** Where a composition's source lives on its overlay (to render it again). */
export const compositionSourceSchema = z.object({
  composition: z.string().min(1),
  props: z.record(z.string(), z.union([z.string(), z.number()])),
});

// Remote references in markup and CSS. `data:` and `blob:` stay local, and
// so do the montage's own assets, which the renderer serves by name.
export const ASSETS_ORIGIN = "http://goscreen.assets/";
const NOT_ASSETS = "(?!goscreen\\.assets/)";
const REMOTE_ATTR = new RegExp(
  `\\b(?:src|href|poster|srcset)\\s*=\\s*["']?\\s*(?:https?:)?//${NOT_ASSETS}`,
  "i",
);
const REMOTE_URL = new RegExp(
  `url\\(\\s*["']?\\s*(?:https?:)?//${NOT_ASSETS}`,
  "i",
);
const REMOTE_IMPORT = new RegExp(
  `@import\\s+["']?\\s*(?:https?:)?//${NOT_ASSETS}`,
  "i",
);
const REMOTE_FETCH = /\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(/;
const RANDOM = /\bMath\s*\.\s*random\b/;

/**
 * What stops a composition from rendering the same on every machine, with
 * the zod-style path of each issue. The rules are explicit even though the
 * renderer cuts the network: an author should learn why, not get a blank.
 */
export function compositionIssues(raw: unknown): CompositionIssue[] {
  const parsed = compositionSchema.safeParse(raw);
  if (!parsed.success)
    return parsed.error.issues.map((i) => ({
      path: i.path.join(".") || "(composition)",
      message: i.message,
    }));
  const c = parsed.data;
  const out: CompositionIssue[] = [];
  const bytes = new TextEncoder().encode(c.html).length;
  if (bytes > MAX_HTML_BYTES)
    out.push({
      path: "html",
      message: `The HTML is ${Math.round(bytes / 1024)} KB; keep it under ${MAX_HTML_BYTES / 1024} KB (inline small assets as data: URLs).`,
    });
  if (
    REMOTE_ATTR.test(c.html) ||
    REMOTE_URL.test(c.html) ||
    REMOTE_IMPORT.test(c.html)
  )
    out.push({
      path: "html",
      message:
        "The page loads something over the network (http(s):// or //). The renderer has no network: inline fonts, pictures and scripts as data: URLs, or use a montage asset by name (http://goscreen.assets/<file>).",
    });
  if (REMOTE_FETCH.test(c.html))
    out.push({
      path: "html",
      message:
        "fetch, XMLHttpRequest and WebSocket never answer in the renderer. Put the data in the page.",
    });
  if (RANDOM.test(c.html))
    out.push({
      path: "html",
      message:
        "Math.random makes every render different. Use window.random(seed), a seeded generator that returns the same numbers on every frame.",
    });
  const names = new Set<string>();
  c.props.forEach((p, i) => {
    if (names.has(p.name))
      out.push({
        path: `props.${i}.name`,
        message: `Duplicate prop "${p.name}".`,
      });
    names.add(p.name);
    if (p.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(String(p.default)))
      out.push({
        path: `props.${i}.default`,
        message: "A colour default is #rrggbb.",
      });
    if (p.type === "number" && !Number.isFinite(Number(p.default)))
      out.push({
        path: `props.${i}.default`,
        message: "A number default is a number.",
      });
  });
  return out;
}

/** The composition, parsed, or an error naming each issue with its path. */
export function parseComposition(
  raw: unknown,
):
  | { ok: true; composition: Composition }
  | { ok: false; issues: CompositionIssue[] } {
  const issues = compositionIssues(raw);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, composition: compositionSchema.parse(raw) };
}

export const describeIssues = (issues: CompositionIssue[]) =>
  issues.map((i) => `${i.path}: ${i.message}`).join("; ");

/** A composition's props with defaults filled, every value a string. */
export function resolveCompositionProps(
  c: Composition,
  given: Record<string, unknown> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of c.props) {
    const v = given[spec.name];
    let value =
      v === undefined || v === null ? String(spec.default) : String(v);
    if (spec.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(value))
      value = String(spec.default);
    if (spec.type === "number" && !Number.isFinite(Number(value)))
      value = String(spec.default);
    out[spec.name] = value;
  }
  return out;
}

/** A small, stable hash (FNV-1a, 32 bits) of a string: the seed of a page. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The script every composition runs first. It makes the page a pure function
 * of time: seeded random numbers, no timers or animation frames (the renderer
 * seeks), `setT` wired to the renderer's seek, and `__goscreenReady` resolved
 * unless the page sets its own promise. In preview mode a real-time driver
 * calls `setT` so the page plays in a browser frame, looping.
 */
export function compositionPrelude(o: {
  props: Record<string, string>;
  size: BlockSize;
  seed: number;
  duration: number;
  preview?: boolean;
}): string {
  const driver = o.preview
    ? `var raf=window.requestAnimationFrame.bind(window),dur=${o.duration};
function tick(now){var t=((now-t0)/1000)%(dur+1);if(t<=dur){window.__goscreenSeek(t);}raf(tick);}
var t0=performance.now();window.addEventListener("load",function(){raf(tick);});`
    : "";
  // `<` never closes the script tag from inside a value.
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<script>
(function(){
window.__props=${json(o.props)};
window.__size=${JSON.stringify({ width: o.size.width, height: o.size.height })};
window.__duration=${o.duration};
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
window.random=function(seed){return mulberry32(seed==null?${o.seed}:seed>>>0);};
Math.random=window.random(${o.seed});
window.__goscreenSeek=function(t){if(typeof window.setT==="function")return window.setT(t);};
window.__goscreenReady=Promise.resolve();
${driver}
window.requestAnimationFrame=function(){return 0;};
window.cancelAnimationFrame=function(){};
window.setTimeout=function(){return 0;};
window.setInterval=function(){return 0;};
})();
</script>`;
}

/** Every `{{name}}` of the page, replaced by its escaped value. */
export function substituteProps(
  html: string,
  props: Record<string, string>,
): string {
  return html.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (m, name: string) => (name in props ? escapeHtml(props[name]) : m),
  );
}

/**
 * The page the renderer loads: the prelude first (before any script of the
 * page), props substituted, at a pixel size (even sides, for video). The
 * page also sees `{{width}}` and `{{height}}`.
 */
export function prepareCompositionHtml(
  c: Composition,
  given: Record<string, unknown>,
  size: BlockSize,
  o: { preview?: boolean } = {},
): string {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const at = { width: even(size.width), height: even(size.height) };
  const props = resolveCompositionProps(c, given);
  const body = substituteProps(c.html, {
    ...props,
    width: String(at.width),
    height: String(at.height),
  });
  const prelude = compositionPrelude({
    props,
    size: at,
    seed: fnv1a(`${c.id}:${c.html}`),
    duration: c.duration,
    preview: o.preview,
  });
  // The prelude goes right after <head> (so it runs before the page's own
  // scripts); a page without a head gets one.
  const head = /<head[^>]*>/i.exec(body);
  const insert = (at: number, text: string) =>
    `${body.slice(0, at)}${text}${body.slice(at)}`;
  if (head) return insert(head.index + head[0].length, prelude);
  const html = /<html[^>]*>/i.exec(body);
  if (html)
    return insert(html.index + html[0].length, `<head>${prelude}</head>`);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(body);
  return insert(doctype ? doctype[0].length : 0, prelude);
}

/**
 * What goes into a render's fingerprint: the same page at the same size,
 * length and rate gives the same file, so it is never rendered twice.
 */
export function renderFingerprint(o: {
  html: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  transparent: boolean;
}): string {
  const key = `${o.width}x${o.height}@${o.fps}/${o.duration}/${o.transparent ? "a" : "o"}\n${o.html}`;
  // Two independent 32-bit hashes: 64 bits, plenty for a cache of files.
  return `${fnv1a(key).toString(16).padStart(8, "0")}${fnv1a(`${key}\u0000${key.length}`).toString(16).padStart(8, "0")}`;
}

/**
 * A catalogue block as an editable composition: its page at a pixel size,
 * with the props inlined, so the HTML can be changed by hand (or by an AI).
 */
export function compositionFromBlock(
  block: Block,
  given: Record<string, unknown>,
  size: BlockSize,
  id = `${block.id}-custom`,
): Composition {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const at = { width: even(size.width), height: even(size.height) };
  return {
    id,
    label: `${block.label} (custom)`,
    description: `From the ${block.label} block: ${block.description}`,
    box: at,
    duration: block.duration,
    transparent: block.transparent,
    props: [],
    html: block.html(resolveProps(block, given), at),
  };
}

/** A starting point for a new composition: a page that draws by `setT`. */
export const EXAMPLE_COMPOSITION: Composition = {
  id: "orbit-badge",
  label: "Orbit badge",
  description:
    "A label that circles a dot: drawn by setT, so any frame is exact.",
  box: { width: 640, height: 360 },
  duration: 3,
  transparent: true,
  props: [
    { name: "text", label: "Text", type: "text", default: "New" },
    { name: "accent", label: "Accent", type: "color", default: "#e9a100" },
    { name: "ink", label: "Text colour", type: "color", default: "#16241c" },
  ],
  html: `<!doctype html>
<html><head><meta charset="utf-8">
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Inter,system-ui,sans-serif}
.dot{position:absolute;left:50%;top:50%;width:14%;height:25%;margin:-12.5% 0 0 -7%;border-radius:50%;background:{{accent}}}
.tag{position:absolute;left:50%;top:50%;padding:.3em .8em;border-radius:999px;background:{{ink}};color:#fff;font-weight:800;font-size:40px;transform:translate(-50%,-50%)}
</style></head>
<body><div class="dot"></div><div class="tag" id="tag">{{text}}</div>
<script>
var tag=document.getElementById("tag");
window.setT=function(t){
  var a=t/window.__duration*Math.PI*2, r=window.__size.width*0.3;
  var s=Math.min(1,t*3);
  tag.style.transform="translate(-50%,-50%) translate("+(Math.cos(a)*r)+"px,"+(Math.sin(a)*r*0.5)+"px) scale("+s+")";
};
window.setT(0);
</script></body></html>`,
};
