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
.t{font-weight:900;font-size:${titleSize(v.title ?? "", s)}px;line-height:1.02;color:${safeColor(v.ink, "#16241c")};letter-spacing:-0.02em}
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
  // The elements below are the ones shared motion-design prompts ask for
  // most (graphs, loaders, chips, typed inputs, chat, toasts, cards,
  // wordmarks): goScreen's own take, so an inspiration can be laid out with them.
  {
    id: "line-chart",
    label: "Line chart",
    description:
      "A line draws itself across its points, the area fills, and the last value pops in a badge.",
    box: { x: 0.5, y: 0.5, width: 0.8, height: 0.5 },
    duration: 4,
    transparent: true,
    props: [
      p("points", "Points (comma separated)", "text", "12, 18, 15, 26, 31, 44"),
      p("value", "Badge", "text", "+22%"),
      p("label", "Label", "text", "Orders this month"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Line colour", "color", "#e9a100"),
    ],
    html: (v, s) => {
      const { line, area, end } = chartPath(v.points ?? "", s);
      const ink = safeColor(v.ink, "#16241c");
      const accent = safeColor(v.accent, "#e9a100");
      return page(
        `.wrap{position:relative;height:100%}
.l{position:absolute;left:0;top:0;font-weight:700;font-size:${s.height * 0.08}px;color:${ink};opacity:.8;animation:fade .5s ease-out}
svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.line{fill:none;stroke:${accent};stroke-width:${Math.max(3, s.height * 0.018)};stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.6s cubic-bezier(.65,0,.35,1) .3s}
@keyframes draw{to{stroke-dashoffset:0}}
.area{fill:${accent};opacity:0;animation:area .8s ease-out 1.4s}
@keyframes area{to{opacity:.14}}
.dot{fill:${accent};transform-box:fill-box;transform-origin:center;animation:pop .45s cubic-bezier(.34,1.56,.64,1) 1.85s}
@keyframes pop{from{transform:scale(0)}to{transform:none}}
.b{position:absolute;left:${end.x}px;top:${end.y}px;transform:translate(-50%,-150%);padding:${s.height * 0.025}px ${s.height * 0.05}px;border-radius:999px;background:${ink};color:#fff;font-weight:800;font-size:${s.height * 0.08}px;white-space:nowrap;animation:badge .5s cubic-bezier(.34,1.56,.64,1) 2s}
@keyframes badge{from{opacity:0;transform:translate(-50%,-90%) scale(.6)}to{opacity:1;transform:translate(-50%,-150%)}}
@keyframes fade{from{opacity:0}to{opacity:.8}}`,
        `<div class="wrap">${v.label ? `<div class="l">${escapeHtml(v.label)}</div>` : ""}<svg viewBox="0 0 ${s.width} ${s.height}"><path class="area" d="${area}"/><path class="line" pathLength="1" d="${line}"/><circle class="dot" cx="${end.x}" cy="${end.y}" r="${Math.max(5, s.height * 0.03)}"/></svg>${v.value ? `<div class="b">${escapeHtml(v.value)}</div>` : ""}</div>`,
        s,
      );
    },
  },
  {
    id: "progress-ring",
    label: "Progress ring",
    description: "A ring fills to a percentage while the number counts up.",
    box: { x: 0.5, y: 0.5, width: 0.4, height: 0.4 },
    duration: 3,
    transparent: true,
    props: [
      p("value", "Percent", "number", 87),
      p("label", "Label", "text", "orders delivered"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Ring colour", "color", "#e9a100"),
    ],
    html: (v, s) => {
      const value = Math.round(Math.min(100, Math.max(0, num(v.value, 87))));
      const side = Math.min(s.width, s.height);
      const ink = safeColor(v.ink, "#16241c");
      return page(
        `@property --n{syntax:'<integer>';inherits:false;initial-value:0}
.wrap{height:100%;display:grid;place-items:center}
.ring{position:relative;width:${side * 0.8}px;height:${side * 0.8}px;animation:pop .5s cubic-bezier(.34,1.56,.64,1)}
svg{width:100%;height:100%;transform:rotate(-90deg)}
circle{fill:none;stroke-width:9}
.track{stroke:${ink};opacity:.12}
.fill{stroke:${safeColor(v.accent, "#e9a100")};stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:100;animation:fill 1.6s cubic-bezier(.22,1,.36,1) .3s}
@keyframes fill{to{stroke-dashoffset:${100 - value}}}
.in{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:${ink}}
.n{font-weight:900;font-size:${side * 0.2}px;font-variant-numeric:tabular-nums;counter-reset:n var(--n);animation:count 1.6s cubic-bezier(.22,1,.36,1) .3s}
.n::before{content:counter(n) "%"}
@keyframes count{from{--n:0}to{--n:${value}}}
.l{font-weight:600;font-size:${side * 0.065}px;opacity:.75;max-width:70%;animation:fade .5s ease-out .9s}
@keyframes fade{from{opacity:0}to{opacity:.75}}
@keyframes pop{from{transform:scale(.7);opacity:0}to{transform:none;opacity:1}}`,
        `<div class="wrap"><div class="ring"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="fill" cx="50" cy="50" r="44" pathLength="100"/></svg><div class="in"><div class="n"></div>${v.label ? `<div class="l">${escapeHtml(v.label)}</div>` : ""}</div></div></div>`,
        s,
      );
    },
  },
  {
    id: "chips",
    label: "Chips",
    description: "Tags pop in one after another, like filters or features.",
    box: { x: 0.5, y: 0.5, width: 0.8, height: 0.22 },
    duration: 3,
    transparent: true,
    props: [
      p(
        "items",
        "Chips (one per line)",
        "longtext",
        "Fresh\nLocal\nVerified\nSame day",
      ),
      p("accent", "Chip colour", "color", "#e9a100"),
      p("ink", "Chip text", "color", "#16241c"),
    ],
    html: (v, s) => {
      const items = lines(v.items, 10);
      const h = Math.min(s.height * 0.42, s.width / 8);
      const chips = items
        .map(
          (t, k) =>
            `<span class="c" style="animation-delay:${(0.15 + k * 0.12).toFixed(2)}s">${escapeHtml(t)}</span>`,
        )
        .join("");
      return page(
        `.wrap{height:100%;display:flex;flex-wrap:wrap;align-items:center;align-content:center;justify-content:center;gap:${h * 0.3}px}
.c{display:inline-flex;align-items:center;height:${h}px;padding:0 ${h * 0.5}px;border-radius:999px;background:${safeColor(v.accent, "#e9a100")};color:${safeColor(v.ink, "#16241c")};font-weight:700;font-size:${h * 0.42}px;white-space:nowrap;animation:pop .45s cubic-bezier(.34,1.56,.64,1)}
@keyframes pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}`,
        `<div class="wrap">${chips}</div>`,
        s,
      );
    },
  },
  {
    id: "prompt-input",
    label: "Typed input",
    description:
      "A search or AI prompt field: the request types itself, then the send button is pressed.",
    box: { x: 0.5, y: 0.5, width: 0.8, height: 0.2 },
    duration: 4,
    transparent: true,
    props: [
      p("text", "Typed text", "text", "Fresh eggs near me, delivered today"),
      p("button", "Button", "text", "Send"),
      p("panel", "Field colour", "color", "#ffffff"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Button colour", "color", "#e9a100"),
    ],
    html: (v, s) => {
      const text = [...(v.text ?? "")].slice(0, 120);
      const step = Math.min(0.06, 2.2 / Math.max(1, text.length));
      const done = 0.4 + text.length * step;
      const h = s.height;
      const chars = text
        .map(
          (c, k) =>
            `<span class="k" style="animation-delay:${(0.4 + k * step).toFixed(3)}s">${c === " " ? "&nbsp;" : escapeHtml(c)}</span>`,
        )
        .join("");
      return page(
        `.f{position:absolute;inset:${h * 0.12}px;display:flex;align-items:center;gap:${h * 0.12}px;padding:0 ${h * 0.12}px 0 ${h * 0.25}px;border-radius:${h * 0.3}px;background:${safeColor(v.panel, "#ffffff")};box-shadow:0 ${h * 0.04}px ${h * 0.18}px rgba(0,0,0,.16),0 0 0 ${Math.max(2, h * 0.015)}px ${safeColor(v.accent, "#e9a100")}55;animation:in .5s cubic-bezier(.22,1,.36,1)}
@keyframes in{from{opacity:0;transform:translateY(20%) scale(.96)}to{opacity:1;transform:none}}
.t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;font-weight:600;font-size:${h * 0.24}px;color:${safeColor(v.ink, "#16241c")}}
.k{font-size:0;animation:key 1ms steps(1,jump-start)}
@keyframes key{from{font-size:0}to{font-size:${h * 0.24}px}}
.caret{display:inline-block;width:${Math.max(2, h * 0.015)}px;height:1.1em;vertical-align:-.2em;background:currentColor;animation:blink 1s steps(1,jump-none) infinite}
@keyframes blink{50%{opacity:0}}
.b{flex:none;height:${h * 0.5}px;padding:0 ${h * 0.22}px;border-radius:999px;display:grid;place-items:center;background:${safeColor(v.accent, "#e9a100")};color:${safeColor(v.ink, "#16241c")};font-weight:800;font-size:${h * 0.18}px;animation:press .3s ease-in-out ${(done + 0.35).toFixed(2)}s}
@keyframes press{50%{transform:scale(.88)}}`,
        `<div class="f"><div class="t">${chars}<span class="caret"></span></div>${v.button ? `<div class="b">${escapeHtml(v.button)}</div>` : ""}</div>`,
        s,
      );
    },
  },
  {
    id: "chat-bubbles",
    label: "Chat",
    description:
      "A conversation: each message appears in turn, replies after typing dots.",
    box: { x: 0.5, y: 0.5, width: 0.6, height: 0.6 },
    duration: 5,
    transparent: true,
    props: [
      p(
        "messages",
        "Messages (one per line, alternating)",
        "longtext",
        "Do you have eggs today?\nYes, 30 trays in Calavi.\nPerfect, I'll take two.",
      ),
      p("accent", "Your bubbles", "color", "#e9a100"),
      p("mine", "Text on your bubbles", "color", "#16241c"),
      p("panel", "Their bubbles", "color", "#ffffff"),
      p("ink", "Text colour", "color", "#16241c"),
    ],
    html: (v, s) => {
      const msgs = lines(v.messages, 6);
      const size = Math.min(s.height / (msgs.length * 2.4 + 1), s.width * 0.05);
      let t = 0.2;
      // A reply first shows typing dots in its own bubble, then its words.
      const rows = msgs
        .map((m, k) => {
          const mine = k % 2 === 0;
          const at = t;
          const words = mine ? at : at + 0.8;
          t = words + 0.5 + Math.min(1.2, m.length * 0.02);
          const dots = mine
            ? ""
            : `<span class="dots" style="--z:${words.toFixed(2)}s"><i></i><i></i><i></i></span>`;
          return `<div class="row ${mine ? "me" : "them"}" style="--a:${at.toFixed(2)}s"><div class="bub">${dots}<span class="msg" style="--z:${words.toFixed(2)}s">${escapeHtml(m)}</span></div></div>`;
        })
        .join("");
      return page(
        `.wrap{height:100%;display:flex;flex-direction:column;justify-content:center;gap:${size * 0.5}px;padding:0 ${size * 0.4}px}
.row{display:flex;animation:in .4s cubic-bezier(.34,1.56,.64,1) var(--a)}
.me{justify-content:flex-end}
.bub{max-width:78%;padding:${size * 0.55}px ${size * 0.8}px;border-radius:${size * 1.1}px;font-weight:600;font-size:${size}px;line-height:1.3;color:${safeColor(v.ink, "#16241c")};background:${safeColor(v.panel, "#ffffff")};box-shadow:0 ${size * 0.15}px ${size * 0.6}px rgba(0,0,0,.12)}
.me .bub{background:${safeColor(v.accent, "#e9a100")};color:${safeColor(v.mine, "#16241c")};border-bottom-right-radius:${size * 0.25}px}
.them .bub{border-bottom-left-radius:${size * 0.25}px}
@keyframes in{from{opacity:0;transform:translateY(40%) scale(.8)}to{opacity:1;transform:none}}
.them .msg{animation:show 1ms steps(1,jump-start) var(--z)}
@keyframes show{from{font-size:0}to{font-size:${size}px}}
.dots{display:inline-flex;gap:${size * 0.18}px;padding:${size * 0.25}px 0;animation:hide 1ms steps(1,jump-start) var(--z)}
@keyframes hide{from{font-size:${size}px}to{font-size:0;padding:0}}
.dots i{width:.45em;height:.45em;border-radius:50%;background:currentColor;opacity:.4;animation:bob .6s ease-in-out infinite}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes bob{50%{transform:translateY(-35%);opacity:.9}}`,
        `<div class="wrap">${rows}</div>`,
        s,
      );
    },
  },
  {
    id: "toast",
    label: "Notification",
    description:
      "A notification slides down, stays a moment and leaves: an order, a payment, a message.",
    box: { x: 0.5, y: 0.14, width: 0.7, height: 0.18 },
    duration: 3.5,
    transparent: true,
    props: [
      p("title", "Title", "text", "New order"),
      p("body", "Text", "text", "2 trays · Calavi · paid"),
      p("icon", "Icon letter", "text", "O"),
      p("panel", "Card colour", "color", "#ffffff"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Icon colour", "color", "#e9a100"),
      p("mark", "Icon letter colour", "color", "#16241c"),
    ],
    html: (v, s) => {
      const h = s.height;
      return page(
        `.n{position:absolute;inset:${h * 0.1}px;display:flex;align-items:center;gap:${h * 0.14}px;padding:0 ${h * 0.18}px;border-radius:${h * 0.24}px;background:${safeColor(v.panel, "#ffffff")};color:${safeColor(v.ink, "#16241c")};box-shadow:0 ${h * 0.05}px ${h * 0.25}px rgba(0,0,0,.18);animation:down .55s cubic-bezier(.34,1.3,.64,1),up .45s cubic-bezier(.55,0,.75,0) 2.9s}
@keyframes down{from{transform:translateY(-130%);opacity:0}to{transform:none;opacity:1}}
@keyframes up{to{transform:translateY(-130%);opacity:0}}
.i{flex:none;width:${h * 0.5}px;height:${h * 0.5}px;border-radius:${h * 0.13}px;display:grid;place-items:center;background:${safeColor(v.accent, "#e9a100")};color:${safeColor(v.mark, "#16241c")};font-weight:900;font-size:${h * 0.26}px}
.x{min-width:0}
.t{font-weight:800;font-size:${h * 0.2}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.b{font-weight:500;font-size:${h * 0.16}px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
        `<div class="n"><div class="i">${escapeHtml([...(v.icon ?? "")].slice(0, 2).join(""))}</div><div class="x"><div class="t">${escapeHtml(v.title ?? "")}</div><div class="b">${escapeHtml(v.body ?? "")}</div></div></div>`,
        s,
      );
    },
  },
  {
    id: "cards-row",
    label: "Cards",
    description:
      "Cards rise in a fan, one after another: products, offers, results.",
    box: { x: 0.5, y: 0.5, width: 0.9, height: 0.5 },
    duration: 4,
    transparent: true,
    props: [
      p(
        "items",
        "Cards (title | text | tag, one per line)",
        "longtext",
        "Ferme Or | 30 trays · Calavi | 2 500 F\nAkpro Farm | 12 trays · Abomey | 2 400 F\nLa Poule Verte | 45 trays · Porto-Novo | 2 600 F",
      ),
      p("panel", "Card colour", "color", "#ffffff"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Tag colour", "color", "#e9a100"),
      p("tagInk", "Tag text", "color", "#16241c"),
    ],
    html: (v, s) => {
      const cards = lines(v.items, 5).map((l) => {
        const [title = "", text = "", tag = ""] = l
          .split("|")
          .map((x) => x.trim());
        return { title, text, tag };
      });
      const n = Math.max(1, cards.length);
      const w = Math.min(s.width / (n + 0.4), s.height * 0.8);
      const mid = (n - 1) / 2;
      const html = cards
        .map(
          (c, k) =>
            `<div class="c" style="--r:${((k - mid) * 4).toFixed(1)}deg;--y:${(Math.abs(k - mid) * w * 0.06).toFixed(1)}px;animation-delay:${(0.15 + k * 0.15).toFixed(2)}s"><div class="t">${escapeHtml(c.title)}</div><div class="x">${escapeHtml(c.text)}</div>${c.tag ? `<div class="g">${escapeHtml(c.tag)}</div>` : ""}</div>`,
        )
        .join("");
      return page(
        `.wrap{height:100%;display:flex;align-items:center;justify-content:center;gap:${w * 0.08}px}
.c{width:${w}px;padding:${w * 0.09}px;border-radius:${w * 0.09}px;background:${safeColor(v.panel, "#ffffff")};color:${safeColor(v.ink, "#16241c")};box-shadow:0 ${w * 0.04}px ${w * 0.14}px rgba(0,0,0,.16);transform:translateY(var(--y)) rotate(var(--r));display:flex;flex-direction:column;gap:${w * 0.04}px;animation:rise .6s cubic-bezier(.34,1.4,.64,1)}
@keyframes rise{from{opacity:0;transform:translateY(60%) rotate(0deg) scale(.85)}to{opacity:1;transform:translateY(var(--y)) rotate(var(--r))}}
.t{font-weight:800;font-size:${w * 0.1}px}
.x{font-weight:500;font-size:${w * 0.075}px;opacity:.7}
.g{align-self:flex-start;margin-top:${w * 0.03}px;padding:${w * 0.02}px ${w * 0.06}px;border-radius:999px;background:${safeColor(v.accent, "#e9a100")};color:${safeColor(v.tagInk, "#16241c")};font-weight:800;font-size:${w * 0.075}px}`,
        `<div class="wrap">${html}</div>`,
        s,
      );
    },
  },
  {
    id: "wordmark",
    label: "Wordmark",
    description:
      "The brand name rises letter by letter and ends on an accent period that pops.",
    box: { x: 0.5, y: 0.5, width: 0.7, height: 0.3 },
    duration: 3,
    transparent: true,
    props: [
      p("name", "Name", "text", "oeufdor"),
      p("ink", "Text colour", "color", "#16241c"),
      p("accent", "Period colour", "color", "#e9a100"),
    ],
    html: (v, s) => {
      const letters = [...(v.name ?? "")].slice(0, 24);
      const size = Math.min(
        s.height * 0.62,
        (s.width / Math.max(4, letters.length + 1)) * 1.6,
      );
      const spans = letters
        .map(
          (c, k) =>
            `<span class="ch" style="animation-delay:${(0.1 + k * 0.05).toFixed(2)}s">${c === " " ? "&nbsp;" : escapeHtml(c)}</span>`,
        )
        .join("");
      return page(
        `.wrap{height:100%;display:flex;align-items:center;justify-content:center}
.w{display:flex;align-items:baseline;overflow:hidden;padding:.1em 0;font-weight:900;font-size:${size}px;letter-spacing:-.04em;color:${safeColor(v.ink, "#16241c")}}
.ch{display:inline-block;animation:rise .55s cubic-bezier(.22,1,.36,1)}
@keyframes rise{from{transform:translateY(110%)}to{transform:none}}
.dot{display:inline-block;width:.2em;height:.2em;margin-left:.06em;border-radius:50%;background:${safeColor(v.accent, "#e9a100")};animation:pop .5s cubic-bezier(.34,1.8,.64,1) ${(0.25 + letters.length * 0.05).toFixed(2)}s}
@keyframes pop{from{transform:scale(0)}to{transform:none}}`,
        `<div class="wrap"><div class="w">${spans}<span class="dot"></span></div></div>`,
        s,
      );
    },
  },
];

/**
 * A headline's size: as big as the box allows, but a long title wraps on two
 * lines instead of running off the sides (a black glyph is about 0.6 em wide).
 */
export function titleSize(title: string, s: BlockSize): number {
  const longest = Math.max(0, ...title.split(/\s+/).map((w) => [...w].length));
  const perLine = Math.max(8, longest, Math.ceil([...title].length / 2));
  return Math.round(
    Math.min(s.height * 0.26, (s.width * 0.95) / (perLine * 0.6)),
  );
}

/** Non-empty lines of a longtext prop, at most `max`. */
function lines(text: string | undefined, max: number): string[] {
  return (text ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * A line chart's path in pixels: points spread across the width, the
 * highest at the top of the plot, a margin left for the label and the badge.
 */
export function chartPath(
  points: string,
  s: BlockSize,
): { line: string; area: string; end: { x: number; y: number } } {
  const values = points
    .split(/[,\s;]+/)
    .map(Number)
    .filter(Number.isFinite)
    .slice(0, 40);
  const ys = values.length >= 2 ? values : [0, 1];
  const min = Math.min(...ys);
  const span = Math.max(...ys) - min || 1;
  const left = s.width * 0.04;
  const right = s.width * 0.9;
  const top = s.height * 0.3;
  const bottom = s.height * 0.92;
  const at = ys.map((y, i) => ({
    x: Math.round(left + (i / (ys.length - 1)) * (right - left)),
    y: Math.round(bottom - ((y - min) / span) * (bottom - top)),
  }));
  const line = at.map((pt, i) => `${i ? "L" : "M"}${pt.x} ${pt.y}`).join(" ");
  const end = at[at.length - 1];
  return {
    line,
    area: `${line} L${end.x} ${bottom} L${at[0].x} ${bottom} Z`,
    end,
  };
}

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
