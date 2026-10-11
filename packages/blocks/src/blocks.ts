import { z } from "zod";

// Motion-design blocks, the HyperFrames way: each one is a small HTML page
// animated with CSS only (no script), so any frame can be drawn by seeking
// its animations. goScreen renders them in headless Chrome to a video layer
// (with transparency) and keeps the props to render again after an edit.

export type PropSpec = {
  name: string;
  label: string;
  type: "text" | "longtext" | "color" | "number";
  default: string | number;
};

export type BlockSize = { width: number; height: number };

export type Block = {
  id: string;
  label: string;
  description: string;
  // Where it sits by default (fractions of the frame) and how long it plays.
  box: { x: number; y: number; width: number; height: number };
  duration: number;
  // A full-frame block paints its own background.
  transparent: boolean;
  props: PropSpec[];
  html: (props: Record<string, string>, size: BlockSize) => string;
};

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

const color = /^#[0-9a-fA-F]{6}$/;
const safeColor = (v: string | undefined, fallback: string) =>
  v && color.test(v) ? v : fallback;
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const FONT =
  "'Inter', 'SF Pro Display', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** The page around a block: transparent, sized, no margins. */
function page(css: string, body: string, size: BlockSize, bg = "transparent") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${size.width}px;height:${size.height}px;overflow:hidden;background:${bg};font-family:${FONT};-webkit-font-smoothing:antialiased}
*{animation-fill-mode:both!important}
${css}
</style></head><body>${body}</body></html>`;
}

const words = (text: string, cls: string, step: number, from = 0) =>
  escapeHtml(text)
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (w, i) =>
        `<span class="${cls}" style="animation-delay:${(from + i * step).toFixed(2)}s">${w}</span>`,
    )
    .join(" ");

const p = (
  name: string,
  label: string,
  type: PropSpec["type"],
  def: string | number,
): PropSpec => ({ name, label, type, default: def });

export const BLOCKS: Block[] = [
  {
    id: "kinetic-title",
    label: "Kinetic title",
    description: "A big headline whose words punch in, with a line underneath.",
    box: { x: 0.5, y: 0.5, width: 0.9, height: 0.45 },
    duration: 3.5,
    transparent: true,
    props: [
      p("title", "Title", "text", "Find it. Pay. Receive."),
      p("subtitle", "Subtitle", "text", "All in one place"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Accent", "color", "#e9a100"),
    ],
    html: (v, s) =>
      page(
        `.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${s.height * 0.06}px;text-align:center}
.t{font-weight:900;font-size:${s.height * 0.26}px;line-height:1.02;color:${safeColor(v.ink, "#16241c")};letter-spacing:-0.02em}
.w{display:inline-block;animation:punch .55s cubic-bezier(.34,1.56,.64,1)}
@keyframes punch{from{opacity:0;transform:translateY(40%) scale(.7);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
.line{height:${Math.max(4, s.height * 0.025)}px;width:${s.width * 0.35}px;background:${safeColor(v.accent, "#e9a100")};border-radius:99px;transform-origin:left;animation:grow .7s cubic-bezier(.22,1,.36,1) .8s}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.s{font-size:${s.height * 0.1}px;font-weight:600;color:${safeColor(v.ink, "#16241c")};opacity:.75;animation:up .6s ease-out 1.1s}
@keyframes up{from{opacity:0;transform:translateY(30%)}to{opacity:.75;transform:none}}`,
        `<div class="wrap"><div class="t">${words(v.title ?? "", "w", 0.12)}</div><div class="line"></div>${v.subtitle ? `<div class="s">${escapeHtml(v.subtitle)}</div>` : ""}</div>`,
        s,
      ),
  },
  {
    id: "lower-third",
    label: "Lower third",
    description: "A name and a role slide in on a bar, like a TV caption.",
    box: { x: 0.32, y: 0.84, width: 0.56, height: 0.16 },
    duration: 4,
    transparent: true,
    props: [
      p("name", "Name", "text", "Ferme Or"),
      p("role", "Role", "text", "Verified producer · Calavi"),
      p("accent", "Bar colour", "color", "#e9a100"),
      p("panel", "Panel colour", "color", "#16241c"),
      p("ink", "Text colour", "color", "#ffffff"),
    ],
    html: (v, s) =>
      page(
        `.lt{position:absolute;left:0;top:${s.height * 0.12}px;height:${s.height * 0.76}px;display:flex;align-items:stretch;animation:in .7s cubic-bezier(.22,1,.36,1)}
@keyframes in{from{transform:translateX(-110%)}to{transform:none}}
.bar{width:${s.height * 0.08}px;background:${safeColor(v.accent, "#e9a100")}}
.panel{background:${safeColor(v.panel, "#16241c")};padding:0 ${s.height * 0.3}px;display:flex;flex-direction:column;justify-content:center;clip-path:inset(0 100% 0 0);animation:open .6s cubic-bezier(.22,1,.36,1) .25s}
@keyframes open{to{clip-path:inset(0 0 0 0)}}
.n{font-size:${s.height * 0.28}px;font-weight:800;color:${safeColor(v.ink, "#ffffff")}}
.r{font-size:${s.height * 0.16}px;font-weight:500;color:${safeColor(v.ink, "#ffffff")};opacity:.8;animation:fade .5s ease-out .6s}
@keyframes fade{from{opacity:0}to{opacity:.8}}`,
        `<div class="lt"><div class="bar"></div><div class="panel"><div class="n">${escapeHtml(v.name ?? "")}</div><div class="r">${escapeHtml(v.role ?? "")}</div></div></div>`,
        s,
      ),
  },
  {
    id: "stat-counter",
    label: "Stat counter",
    description: "A number counts up to its value, with a label.",
    box: { x: 0.5, y: 0.5, width: 0.6, height: 0.4 },
    duration: 3,
    transparent: true,
    props: [
      p("value", "Value", "number", 2184),
      p("prefix", "Before the number", "text", ""),
      p("suffix", "After the number", "text", " trays"),
      p("label", "Label", "text", "available today"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Number colour", "color", "#e9a100"),
    ],
    html: (v, s) => {
      const target = Math.round(num(v.value, 2184));
      return page(
        `@property --n{syntax:'<integer>';inherits:false;initial-value:0}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:${s.height * 0.04}px}
.num{font-weight:900;font-size:${s.height * 0.42}px;color:${safeColor(v.accent, "#e9a100")};font-variant-numeric:tabular-nums;counter-reset:n var(--n);animation:count 1.6s cubic-bezier(.22,1,.36,1) .2s,pop .5s cubic-bezier(.34,1.56,.64,1)}
.num .c::after{content:counter(n)}
@keyframes count{from{--n:0}to{--n:${target}}}
@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
.l{font-size:${s.height * 0.13}px;font-weight:600;color:${safeColor(v.ink, "#16241c")};animation:up .6s ease-out .9s}
@keyframes up{from{opacity:0;transform:translateY(30%)}to{opacity:1;transform:none}}`,
        `<div class="wrap"><div class="num">${escapeHtml(v.prefix ?? "")}<span class="c"></span>${escapeHtml(v.suffix ?? "")}</div><div class="l">${escapeHtml(v.label ?? "")}</div></div>`,
        s,
      );
    },
  },
  {
    id: "bar-chart",
    label: "Bar chart",
    description: "Bars grow one after another, with labels and values.",
    box: { x: 0.5, y: 0.5, width: 0.8, height: 0.55 },
    duration: 4,
    transparent: true,
    props: [
      p(
        "items",
        "Bars (label: value, one per line)",
        "longtext",
        "Mon: 120\nTue: 180\nWed: 150\nThu: 240\nFri: 310",
      ),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Bar colour", "color", "#e9a100"),
    ],
    html: (v, s) => {
      const items = (v.items ?? "")
        .split("\n")
        .map((l) => l.split(":"))
        .filter((x) => x.length >= 2)
        .map(([label, value]) => ({
          label: label.trim(),
          value: Math.max(0, num(value, 0)),
        }))
        .slice(0, 12);
      const max = Math.max(1, ...items.map((i) => i.value));
      const bars = items
        .map(
          (i, k) =>
            `<div class="col"><div class="val" style="animation-delay:${(0.3 + k * 0.15 + 0.5).toFixed(2)}s">${i.value}</div><div class="bar" style="height:${((i.value / max) * 100).toFixed(1)}%;animation-delay:${(0.3 + k * 0.15).toFixed(2)}s"></div><div class="lab">${escapeHtml(i.label)}</div></div>`,
        )
        .join("");
      return page(
        `.chart{height:100%;display:flex;align-items:flex-end;gap:${s.width * 0.03}px;padding:${s.height * 0.05}px}
.col{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:${s.height * 0.02}px}
.bar{width:100%;background:${safeColor(v.accent, "#e9a100")};border-radius:${s.height * 0.02}px ${s.height * 0.02}px 0 0;transform-origin:bottom;max-height:78%;animation:grow .8s cubic-bezier(.22,1,.36,1)}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.val{font-weight:800;font-size:${s.height * 0.07}px;color:${safeColor(v.ink, "#16241c")};animation:fade .4s ease-out}
.lab{font-weight:600;font-size:${s.height * 0.06}px;color:${safeColor(v.ink, "#16241c")};opacity:.7}
@keyframes fade{from{opacity:0;transform:translateY(20%)}to{opacity:1;transform:none}}`,
        `<div class="chart">${bars}</div>`,
        s,
      );
    },
  },
  {
    id: "checklist",
    label: "Checklist",
    description: "Points tick themselves off one by one.",
    box: { x: 0.5, y: 0.5, width: 0.7, height: 0.5 },
    duration: 4,
    transparent: true,
    props: [
      p(
        "items",
        "Points (one per line)",
        "longtext",
        "Real stock, updated live\nPay OEUF D'OR, not the seller\nCode at delivery",
      ),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Tick colour", "color", "#1e6a43"),
    ],
    html: (v, s) => {
      const items = (v.items ?? "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 8);
      const row = s.height / Math.max(3, items.length + 1);
      const list = items
        .map(
          (t, k) =>
            `<li style="animation-delay:${(0.2 + k * 0.45).toFixed(2)}s"><span class="box"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" style="animation-delay:${(0.45 + k * 0.45).toFixed(2)}s"/></svg></span>${escapeHtml(t)}</li>`,
        )
        .join("");
      return page(
        `ul{list-style:none;height:100%;display:flex;flex-direction:column;justify-content:center;gap:${row * 0.25}px;padding:0 ${s.width * 0.04}px}
li{display:flex;align-items:center;gap:${row * 0.3}px;font-weight:700;font-size:${row * 0.42}px;color:${safeColor(v.ink, "#16241c")};animation:in .5s cubic-bezier(.22,1,.36,1)}
@keyframes in{from{opacity:0;transform:translateX(-12%)}to{opacity:1;transform:none}}
.box{flex:none;width:${row * 0.62}px;height:${row * 0.62}px;border-radius:${row * 0.18}px;background:${safeColor(v.accent, "#1e6a43")};display:grid;place-items:center}
svg{width:70%;height:70%}
path{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:24;stroke-dashoffset:24;animation:tick .35s ease-out}
@keyframes tick{to{stroke-dashoffset:0}}`,
        `<ul>${list}</ul>`,
        s,
      );
    },
  },
  {
    id: "cta-button",
    label: "Call to action",
    description:
      "A button pops in, gets clicked and pulses, with the address under it.",
    box: { x: 0.5, y: 0.78, width: 0.7, height: 0.28 },
    duration: 3.5,
    transparent: true,
    props: [
      p("label", "Button", "text", "Order now"),
      p("url", "Address", "text", "oeufsdor.vercel.app"),
      p("accent", "Button colour", "color", "#e9a100"),
      p("ink", "Button text", "color", "#16241c"),
      p("note", "Address colour", "color", "#16241c"),
    ],
    html: (v, s) =>
      page(
        `.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${s.height * 0.08}px}
.btn{position:relative;padding:${s.height * 0.12}px ${s.height * 0.4}px;border-radius:999px;background:${safeColor(v.accent, "#e9a100")};color:${safeColor(v.ink, "#16241c")};font-weight:800;font-size:${s.height * 0.2}px;box-shadow:0 ${s.height * 0.04}px ${s.height * 0.12}px rgba(0,0,0,.18);animation:pop .6s cubic-bezier(.34,1.56,.64,1),press .25s ease-in-out 1.3s,pulse 1.4s ease-in-out 1.7s 2}
@keyframes pop{from{transform:scale(.3);opacity:0}to{transform:none;opacity:1}}
@keyframes press{50%{transform:scale(.92)}}
@keyframes pulse{50%{transform:scale(1.06)}}
.ring{position:absolute;left:62%;top:55%;width:${s.height * 0.3}px;height:${s.height * 0.3}px;margin:-${s.height * 0.15}px;border-radius:50%;border:${s.height * 0.025}px solid ${safeColor(v.ink, "#16241c")};opacity:0;animation:ripple .6s ease-out 1.3s}
@keyframes ripple{from{transform:scale(.3);opacity:.9}to{transform:scale(1.6);opacity:0}}
.u{font-size:${s.height * 0.12}px;font-weight:600;color:${safeColor(v.note, "#16241c")};opacity:.8;animation:fade .5s ease-out .5s}
@keyframes fade{from{opacity:0}to{opacity:.8}}`,
        `<div class="wrap"><div class="btn">${escapeHtml(v.label ?? "")}<span class="ring"></span></div>${v.url ? `<div class="u">${escapeHtml(v.url)}</div>` : ""}</div>`,
        s,
      ),
  },
  {
    id: "steps",
    label: "Steps",
    description: "Numbered steps light up in turn, joined by a growing line.",
    box: { x: 0.5, y: 0.5, width: 0.9, height: 0.3 },
    duration: 4,
    transparent: true,
    props: [
      p(
        "items",
        "Steps (one per line)",
        "longtext",
        "Search\nOrder\nPay\nReceive",
      ),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Accent", "color", "#e9a100"),
    ],
    html: (v, s) => {
      const items = (v.items ?? "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 6);
      const n = Math.max(1, items.length);
      const dot = s.height * 0.32;
      const cells = items
        .map(
          (t, k) =>
            `<div class="st"><div class="dot" style="animation-delay:${(0.2 + k * 0.6).toFixed(2)}s">${k + 1}</div><div class="lb" style="animation-delay:${(0.35 + k * 0.6).toFixed(2)}s">${escapeHtml(t)}</div></div>`,
        )
        .join("");
      return page(
        `.row{position:relative;height:100%;display:grid;grid-template-columns:repeat(${n},1fr);align-items:center}
.track{position:absolute;left:${(100 / n / 2).toFixed(2)}%;right:${(100 / n / 2).toFixed(2)}%;top:${s.height * 0.5 - dot / 2 + dot / 2 - s.height * 0.015}px;height:${s.height * 0.03}px;background:${safeColor(v.accent, "#e9a100")};transform-origin:left;animation:grow ${(0.6 * n).toFixed(2)}s linear .2s}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.st{position:relative;display:flex;flex-direction:column;align-items:center;gap:${s.height * 0.08}px;padding-top:${s.height * 0.22}px}
.dot{width:${dot}px;height:${dot}px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:${dot * 0.45}px;background:${safeColor(v.accent, "#e9a100")};color:${safeColor(v.ink, "#16241c")};animation:pop .45s cubic-bezier(.34,1.56,.64,1)}
@keyframes pop{from{transform:scale(0)}to{transform:none}}
.lb{font-weight:700;font-size:${s.height * 0.14}px;color:${safeColor(v.ink, "#16241c")};animation:fade .4s ease-out}
@keyframes fade{from{opacity:0;transform:translateY(25%)}to{opacity:1;transform:none}}`,
        `<div class="row"><div class="track"></div>${cells}</div>`,
        s,
      );
    },
  },
  {
    id: "quote",
    label: "Quote",
    description:
      "A testimonial: the quote mark lands, words follow, then the author.",
    box: { x: 0.5, y: 0.5, width: 0.82, height: 0.5 },
    duration: 5,
    transparent: true,
    props: [
      p(
        "text",
        "Quote",
        "longtext",
        "Fresh eggs, delivered the same day. I order every week.",
      ),
      p("author", "Author", "text", "Awa, restaurant owner"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Accent", "color", "#e9a100"),
    ],
    html: (v, s) =>
      page(
        `.wrap{height:100%;display:flex;flex-direction:column;justify-content:center;gap:${s.height * 0.06}px;padding:0 ${s.width * 0.04}px}
.m{font-size:${s.height * 0.5}px;line-height:.6;font-weight:900;color:${safeColor(v.accent, "#e9a100")};height:${s.height * 0.22}px;animation:drop .6s cubic-bezier(.34,1.56,.64,1)}
@keyframes drop{from{opacity:0;transform:translateY(-40%) scale(1.4)}to{opacity:1;transform:none}}
.q{font-size:${s.height * 0.11}px;font-weight:700;line-height:1.3;color:${safeColor(v.ink, "#16241c")}}
.w{display:inline-block;animation:fade .45s ease-out}
@keyframes fade{from{opacity:0;transform:translateY(30%)}to{opacity:1;transform:none}}
.a{font-size:${s.height * 0.075}px;font-weight:600;color:${safeColor(v.ink, "#16241c")};opacity:.7;animation:fade .5s ease-out 2.4s}`,
        `<div class="wrap"><div class="m">“</div><div class="q">${words(v.text ?? "", "w", 0.08, 0.4)}</div>${v.author ? `<div class="a">— ${escapeHtml(v.author)}</div>` : ""}</div>`,
        s,
      ),
  },
  {
    id: "highlight",
    label: "Highlighted sentence",
    description: "A sentence appears and one word gets a marker swipe.",
    box: { x: 0.5, y: 0.2, width: 0.86, height: 0.2 },
    duration: 3.5,
    transparent: true,
    props: [
      p("before", "Text before", "text", "Your stock is"),
      p("word", "Highlighted word", "text", "reserved"),
      p("after", "Text after", "text", "for 15 minutes"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Marker colour", "color", "#fde047"),
    ],
    html: (v, s) =>
      page(
        `.wrap{height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:800;font-size:${s.height * 0.32}px;color:${safeColor(v.ink, "#16241c")};animation:fade .5s ease-out}
@keyframes fade{from{opacity:0;transform:translateY(20%)}to{opacity:1;transform:none}}
.hl{position:relative;padding:0 .15em;margin:0 .1em}
.hl::before{content:"";position:absolute;inset:12% 0 6% 0;background:${safeColor(v.accent, "#fde047")};z-index:-1;border-radius:.12em;transform-origin:left;animation:swipe .6s cubic-bezier(.22,1,.36,1) .7s}
@keyframes swipe{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.hl{isolation:isolate}`,
        `<div class="wrap"><span>${escapeHtml(v.before ?? "")} <span class="hl">${escapeHtml(v.word ?? "")}</span> ${escapeHtml(v.after ?? "")}</span></div>`,
        s,
      ),
  },
  {
    id: "logo-reveal",
    label: "Logo reveal",
    description:
      "A full-frame brand card: the name wipes in over a colour, with a tagline.",
    box: { x: 0.5, y: 0.5, width: 1, height: 1 },
    duration: 3,
    transparent: false,
    props: [
      p("name", "Brand", "text", "OEUF D'OR"),
      p("tagline", "Tagline", "text", "Find. Pay. Receive."),
      p("background", "Background", "color", "#16241c"),
      p("ink", "Text colour", "color", "#f7f7f2"),
      p("accent", "Accent", "color", "#e9a100"),
    ],
    html: (v, s) =>
      page(
        `.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.min(s.width, s.height) * 0.03}px}
.dot{width:${Math.min(s.width, s.height) * 0.06}px;height:${Math.min(s.width, s.height) * 0.06}px;border-radius:50%;background:${safeColor(v.accent, "#e9a100")};animation:pop .5s cubic-bezier(.34,1.56,.64,1)}
@keyframes pop{from{transform:scale(0)}to{transform:none}}
.n{font-weight:900;font-size:${Math.min(s.width, s.height) * 0.13}px;letter-spacing:.02em;color:${safeColor(v.ink, "#f7f7f2")};clip-path:inset(0 100% 0 0);animation:wipe .8s cubic-bezier(.22,1,.36,1) .3s}
@keyframes wipe{to{clip-path:inset(0 0 0 0)}}
.t{font-weight:600;font-size:${Math.min(s.width, s.height) * 0.04}px;color:${safeColor(v.ink, "#f7f7f2")};opacity:.75;animation:up .6s ease-out 1s}
@keyframes up{from{opacity:0;transform:translateY(40%)}to{opacity:.75;transform:none}}`,
        `<div class="wrap"><div class="dot"></div><div class="n">${escapeHtml(v.name ?? "")}</div>${v.tagline ? `<div class="t">${escapeHtml(v.tagline)}</div>` : ""}</div>`,
        s,
        safeColor(v.background, "#16241c"),
      ),
  },
];

export function blockById(id: string): Block | undefined {
  return BLOCKS.find((b) => b.id === id);
}

/** A block's props with defaults filled and every value a string. */
export function resolveProps(
  block: Block,
  given: Record<string, unknown> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of block.props) {
    const v = given[spec.name];
    out[spec.name] =
      v === undefined || v === null ? String(spec.default) : String(v);
  }
  return out;
}

/** The page for a block at a pixel size (even sides, for video). */
export function renderHtml(
  block: Block,
  given: Record<string, unknown>,
  size: BlockSize,
): string {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return block.html(resolveProps(block, given), {
    width: even(size.width),
    height: even(size.height),
  });
}

/** Where a block's source lives on its overlay (to render it again). */
export const blockSourceSchema = z.object({
  block: z.string().min(1),
  props: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type BlockSource = z.infer<typeof blockSourceSchema>;
