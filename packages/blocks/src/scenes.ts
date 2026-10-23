import type { Composition } from "./composition.ts";

// Scenes: a library of dynamic compositions, built in, in the look of modern
// SaaS ads: everything in CSS 3D, drawn by `setT(t)` (no CSS animation, so
// any frame is exact), expo-out curves, a permanent slow drift (nothing ever
// stops dead), a small glow on every element, dark gradients with a beam or
// a halo in the brand colour. Colours are props (#rrggbb), texts are props.
// A scene that shows a screen takes the name of a montage asset (`screen`),
// served by the renderer as http://goscreen.assets/<name>; without one, or
// in a browser preview, it draws a mock interface instead.

export type SceneAspect =
  | "auto"
  | "16:9"
  | "9:16"
  | "1:1"
  | "4:5"
  | "4:3"
  | "3:4";

/** The frame a scene fills, per aspect (1080p). */
export const SCENE_BOXES: Record<
  SceneAspect,
  { width: number; height: number }
> = {
  auto: { width: 1920, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "4:3": { width: 1440, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
};

const color = (name: string, label: string, def: string) =>
  ({ name, label, type: "color", default: def }) as const;
const text = (name: string, label: string, def: string) =>
  ({ name, label, type: "text", default: def }) as const;
const longtext = (name: string, label: string, def: string) =>
  ({ name, label, type: "longtext", default: def }) as const;
const number = (name: string, label: string, def: number) =>
  ({ name, label, type: "number", default: def }) as const;

const ACCENT = "#6d5cff";
const INK = "#ffffff";
const BACKGROUND = "#0b0d14";

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='7' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='300' height='300' filter='url(%23n)'/></svg>\")";

// What every scene shares: a reset, the 3D stage, glass cards, the grain.
const BASE_CSS = `
*{box-sizing:border-box}
:root{--a:109 92 255;--ink:255 255 255;--bg:11 13 20;--frame:21 23 31}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Inter,"SF Pro Display","Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:rgb(var(--ink))}
.stage{position:absolute;inset:0;perspective:170vmin;perspective-origin:50% 50%;overflow:hidden}
.p3{transform-style:preserve-3d;will-change:transform}
.glass{background:linear-gradient(160deg,rgba(255,255,255,.13),rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.16);border-radius:2.4vmin;box-shadow:0 2vmin 6vmin rgba(0,0,0,.45),0 0 4vmin rgb(var(--a)/.18)}
.grain{position:absolute;inset:0;pointer-events:none;opacity:.07;background-image:${GRAIN};background-size:300px 300px;mix-blend-mode:overlay}
.vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 100% at 50% 50%,transparent 55%,rgba(0,0,0,.55) 100%)}
`;

// A device (window, tablet or phone) with a screen: a montage asset, or a
// mock interface drawn in CSS when there is none (or it cannot load).
const DEVICE_CSS = `
.dev{position:absolute;left:50%;top:50%;transform-style:preserve-3d;background:rgb(var(--frame));border:1px solid rgba(255,255,255,.14);box-shadow:0 4vmin 10vmin rgba(0,0,0,.6),0 0 8vmin rgb(var(--a)/.25);overflow:hidden;border-radius:2.2vmin;padding:.9vmin}
.dev.tablet{border-radius:4vmin;padding:1.6vmin}
.dev.phone{border-radius:6vmin;padding:1.1vmin}
.dev .bar{height:2.6vmin;display:flex;align-items:center;gap:.8vmin;padding:0 1.2vmin}
.dev .bar i{width:1.1vmin;height:1.1vmin;border-radius:50%;background:rgba(255,255,255,.22)}
.dev.phone .bar,.dev.tablet .bar{display:none}
.dev .screen{position:absolute;left:.9vmin;right:.9vmin;top:3.5vmin;bottom:.9vmin;border-radius:1.4vmin;background:#0f1118;overflow:hidden}
.dev.tablet .screen{left:1.6vmin;right:1.6vmin;top:1.6vmin;bottom:1.6vmin;border-radius:2.6vmin}
.dev.phone .screen{left:1.1vmin;right:1.1vmin;top:1.1vmin;bottom:1.1vmin;border-radius:5vmin}
.dev .screen img,.dev .screen video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.dev .screen.mock img,.dev .screen.mock video{display:none}
.dev .ui{position:absolute;inset:0;display:none;background:#0f1118}
.dev .screen.mock .ui{display:flex}
.dev .ui .side{width:19%;border-right:1px solid rgba(255,255,255,.08);padding:1.4em .9em;display:flex;flex-direction:column;gap:1em}
.dev.phone .ui .side{display:none}
.dev .ui .side i{display:block;height:.55em;border-radius:999px;background:rgba(255,255,255,.12)}
.dev .ui .side i:first-child{background:rgb(var(--a))}
.dev .ui .main{flex:1;padding:1.2em;display:flex;flex-direction:column;gap:1em}
.dev .ui .top{display:flex;justify-content:space-between;align-items:center}
.dev .ui .top b{display:block;width:34%;height:.9em;border-radius:999px;background:rgba(255,255,255,.2)}
.dev .ui .top s{display:block;width:2.2em;height:2.2em;border-radius:50%;background:rgb(var(--a)/.7)}
.dev .ui .cards{display:flex;gap:.8em}
.dev .ui .card{flex:1;aspect-ratio:1.55;border-radius:.8em;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);padding:.8em;display:flex;flex-direction:column;justify-content:space-between}
.dev .ui .card:first-child{background:linear-gradient(135deg,rgb(var(--a)/.9),rgb(var(--a)/.45));border-color:transparent}
.dev .ui .card em{display:block;width:40%;height:.5em;border-radius:999px;background:rgba(255,255,255,.4)}
.dev .ui .card u{display:block;width:60%;height:1.1em;border-radius:.3em;background:rgba(255,255,255,.55)}
.dev .ui .rows{display:flex;flex-direction:column;gap:.6em}
.dev .ui .rows p{margin:0;height:.6em;border-radius:999px;background:rgba(255,255,255,.1)}
.dev .ui .rows p:nth-child(1){width:92%}.dev .ui .rows p:nth-child(2){width:68%}.dev .ui .rows p:nth-child(3){width:80%}.dev .ui .rows p:nth-child(4){width:50%}
.dev .shine{position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.09) 50%,transparent 58%);background-size:260% 100%;background-position:100% 0}
.dev .home{position:absolute;left:50%;bottom:1.6vmin;width:30%;height:.5vmin;border-radius:999px;background:rgba(255,255,255,.35);transform:translateX(-50%);display:none}
.dev.phone .home{display:block}
`;

const DEVICE_HTML = `<div class="bar"><i></i><i></i><i></i></div><div class="screen"><div class="ui"><div class="side"><i></i><i></i><i></i><i></i><i></i></div><div class="main"><div class="top"><b></b><s></s></div><div class="cards"><div class="card"><em></em><u></u></div><div class="card"><em></em><u></u></div><div class="card"><em></em><u></u></div></div><div class="rows"><p></p><p></p><p></p><p></p></div></div></div></div><div class="shine"></div><div class="home"></div>`;

const CURSOR_SVG = `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.8 L11.5 14 L17.5 14 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

// The script every scene starts with: props, size, curves, colours, assets.
const LIB = `
var W=window.__size.width,H=window.__size.height,D=window.__duration,P=window.__props||{};
var VM=Math.min(W,H)/100;
var ASSETS="http://goscreen.assets/";
function clamp(x,a,b){return x<a?a:x>b?b:x}
function expoOut(x){x=clamp(x,0,1);return x>=1?1:1-Math.pow(2,-10*x)}
function at(t,t0,d){return expoOut((t-t0)/d)}
function lerp(a,b,x){return a+(b-a)*x}
function sway(t,f,ph){return Math.sin(t*f*Math.PI*2+(ph||0))}
function rgb(h){h=String(h||"").replace("#","");if(!/^[0-9a-fA-F]{6}$/.test(h))return null;return parseInt(h.slice(0,2),16)+" "+parseInt(h.slice(2,4),16)+" "+parseInt(h.slice(4,6),16)}
function vars(){var r=document.documentElement.style;var a=rgb(P.accent),i=rgb(P.ink),b=rgb(P.background),f=rgb(P.frame);if(a)r.setProperty("--a",a);if(i)r.setProperty("--ink",i);if(b)r.setProperty("--bg",b);if(f)r.setProperty("--frame",f)}
function list(s){return String(s||"").split(/[|,\\n]/).map(function(x){return x.trim()}).filter(Boolean)}
function pair(s){var p=String(s||"").split("|");return{label:(p[0]||"").trim(),value:(p[1]||"").trim()}}
function isPicture(s){return /\\.(png|jpe?g|webp)$/i.test(String(s||""))}
function isClip(s){return /\\.(mp4|webm)$/i.test(String(s||""))}
function el(tag,cls,parent){var e=document.createElement(tag);if(cls)e.className=cls;if(parent)parent.appendChild(e);return e}
var loads=[];
function media(host,name,onsize){
  var screen=host.querySelector(".screen")||host;var m=null;
  if(isClip(name)){m=document.createElement("video");m.muted=true;m.preload="auto";m.playsInline=true;}
  else if(isPicture(name)){m=document.createElement("img");}
  if(!m){screen.classList.add("mock");return null}
  var sized=function(w,h){if(onsize&&w>0&&h>0)onsize(w/h)};
  loads.push(new Promise(function(res){m.onerror=function(){screen.classList.add("mock");res()};if(m.tagName==="VIDEO"){m.onloadeddata=function(){sized(m.videoWidth,m.videoHeight);res()}}else{m.onload=function(){sized(m.naturalWidth,m.naturalHeight);res()}}}));
  m.src=ASSETS+name;screen.insertBefore(m,screen.firstChild);
  if(m.tagName!=="VIDEO")return null;
  return function(t){var want=clamp(t,0,Math.max(0,(m.duration||t)-0.04));if(m.readyState>=2&&Math.abs(m.currentTime-want)<0.001)return Promise.resolve();return new Promise(function(res){m.addEventListener("seeked",function(){res()},{once:true});m.currentTime=want})};
}

// A device whose screen keeps its picture's own ratio: never cropped, never
// stretched. "auto" (the default) picks the body from that ratio: a portrait
// capture goes in a phone, a square-ish one in a tablet, a wide one in a window.
function device(host,kind,name){
  var fixed=kind==="phone"||kind==="tablet"||kind==="window";
  host.classList.add("dev");host.innerHTML=${JSON.stringify(DEVICE_HTML)};
  var d={el:host,w:0,h:0,seek:null,shine:host.querySelector(".shine"),k:1};
  var cur={body:fixed?kind:"window",r:null};
  var bodyFor=function(r){return r<.8?"phone":r<1.2?"tablet":"window"};
  var layout=function(k,r){
    cur.body=k;cur.r=r;
    host.classList.remove("phone","tablet","window");host.classList.add(k);
    // Screen insets in vmin (side, top, bottom), as in DEVICE_CSS.
    var ins=k==="phone"?[1.1,1.1,1.1]:k==="tablet"?[1.6,1.6,1.6]:[.9,3.5,.9];
    var sx=2*ins[0]*VM,sy=(ins[1]+ins[2])*VM;
    var maxW=k==="window"?.86*W:.9*W,maxH=k==="window"?.8*H:.8*H;
    var ratio=r||(k==="phone"?.46:k==="tablet"?.72:1.6);
    var sh=Math.min(maxH-sy,(maxW-sx)/ratio),sw=sh*ratio;
    var w=(sw+sx)*d.k,h=(sh+sy)*d.k;d.w=w;d.h=h;
    host.style.width=w+"px";host.style.height=h+"px";host.style.marginLeft=(-w/2)+"px";host.style.marginTop=(-h/2)+"px";
    host.querySelector(".screen").style.fontSize=(Math.max(w,h*.6)/46)+"px";
  };
  // A smaller device (a scene that puts things around it): kept on reload.
  d.fit=function(f){d.k=f;layout(cur.body,cur.r)};
  layout(cur.body,null);
  d.seek=media(host,name,function(r){layout(fixed?kind:bodyFor(r),r)});
  return d;
}
vars();
`;

function page(o: {
  css?: string;
  body: string;
  script: string;
  device?: boolean;
}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${BASE_CSS}${o.device ? DEVICE_CSS : ""}${o.css ?? ""}</style>
</head><body>${o.body}
<script>
${LIB}
${o.script}
window.__goscreenReady=Promise.all(loads.length?loads:[Promise.resolve()]);
window.setT(0);
</script></body></html>`;
}

const box16x9 = SCENE_BOXES["16:9"];

const screenProp = text(
  "screen",
  "Screen (asset file name, png/jpg/webp/mp4/webm)",
  "",
);

/** The built-in scenes, at their 16:9 box; `sceneFor` fits one to a format. */
export const SCENES: Composition[] = [
  {
    id: "glow-stage",
    label: "Glow stage",
    description:
      "Dark gradient backdrop with a slow light beam (or a halo ring), light grain and vignette, and an optional hook: a brand kicker and a title whose words rise one by one (*word* in the accent). Opaque: the plate under every other scene.",
    box: box16x9,
    duration: 8,
    transparent: false,
    props: [
      color("background", "Background", BACKGROUND),
      color("accent", "Accent", ACCENT),
      color("ink", "Ink", INK),
      text("variant", "Variant (beam or ring)", "beam"),
      number("intensity", "Intensity (0.2-2)", 1),
      text("title", "Title (*word* = accent; empty = plate only)", ""),
      text("brand", "Brand above the title", ""),
    ],
    html: page({
      css: `
.bg{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 115%,rgb(var(--a)/.22),transparent 60%),linear-gradient(180deg,rgb(var(--bg)) 0%,rgb(var(--bg)) 100%)}
.beam{position:absolute;left:50%;top:50%;width:34vmin;height:260vmin;margin:-130vmin 0 0 -17vmin;background:linear-gradient(90deg,transparent,rgb(var(--a)/.55) 50%,transparent);filter:blur(5vmin);mix-blend-mode:screen;opacity:0}
.beam.b2{width:14vmin;margin-left:-7vmin;background:linear-gradient(90deg,transparent,rgb(var(--ink)/.35) 50%,transparent)}
.ring{position:absolute;left:50%;top:50%;width:70vmin;height:70vmin;margin:-35vmin 0 0 -35vmin;border-radius:50%;border:1.3vmin solid rgb(var(--a)/.9);box-shadow:0 0 9vmin rgb(var(--a)/.6),inset 0 0 9vmin rgb(var(--a)/.45);filter:blur(.5vmin);opacity:0}
.halo{position:absolute;left:50%;top:50%;width:120vmin;height:120vmin;margin:-60vmin 0 0 -60vmin;border-radius:50%;background:radial-gradient(circle,rgb(var(--a)/.28),transparent 60%);filter:blur(4vmin);opacity:0}
.hook{position:absolute;left:8%;right:8%;top:50%;transform:translateY(-50%);text-align:center}
.hook b{display:inline-block;font-weight:700;font-size:3.2vmin;letter-spacing:.32em;text-transform:uppercase;color:rgb(var(--a));text-shadow:0 0 3vmin rgb(var(--a)/.6);margin-bottom:2.6vmin;opacity:0}
.hook h1{margin:0;font-weight:800;font-size:9.5vmin;line-height:1.02;letter-spacing:-.035em;text-shadow:0 .6vmin 3vmin rgba(0,0,0,.45)}
.hook h1 span{display:inline-block;opacity:0;will-change:transform,opacity,filter}
.hook h1 span.acc{color:rgb(var(--a));text-shadow:0 0 4vmin rgb(var(--a)/.55)}
`,
      body: `<div class="bg"></div><div class="halo" id="halo"></div><div class="beam" id="beam"></div><div class="beam b2" id="beam2"></div><div class="ring" id="ring"></div><div class="grain"></div><div class="vignette"></div><div class="hook" id="hook"><b id="brand"></b><h1 id="title"></h1></div>`,
      script: `
var k=clamp(Number(P.intensity)||1,.2,2),ring=P.variant==="ring";
// The hook: words rise one by one (expo-out, from a blur); *words* take the accent.
var words=[],brandEl=document.getElementById("brand"),titleEl=document.getElementById("title");
brandEl.textContent=String(P.brand||"");
String(P.title||"").split(/\\s+/).filter(Boolean).forEach(function(w,i){
  var acc=/^\\*.*\\*[.,!?]*$/.test(w);var sp=document.createElement("span");
  sp.textContent=w.replace(/\\*/g,"");if(acc)sp.className="acc";
  // The space lives between the blocks: inside one, it would collapse.
  if(words.length)titleEl.appendChild(document.createTextNode(" "));titleEl.appendChild(sp);words.push(sp);
});
var beam=document.getElementById("beam"),beam2=document.getElementById("beam2"),ringEl=document.getElementById("ring"),halo=document.getElementById("halo");
window.setT=function(t){
  var e=at(t,0,1.6);
  var be=at(t,.1,.7);brandEl.style.opacity=be;brandEl.style.transform="translateY("+lerp(2,0,be)*VM+"px)";
  words.forEach(function(sp,i){var w=at(t,.25+i*.07,.7);sp.style.opacity=w;sp.style.filter="blur("+lerp(1.4,0,w)*VM+"px)";sp.style.transform="translateY("+(lerp(5,0,w)*VM+sway(t,.1,i)*.2*VM)+"px) scale("+lerp(1.06,1,w)+")"});
  if(ring){
    beam.style.opacity=0;beam2.style.opacity=0;
    var s=lerp(.7,1,e)*(1+.02*sway(t,.12));
    ringEl.style.opacity=e*k*.9;ringEl.style.transform="rotate("+(t*6)+"deg) scale("+s+")";
    halo.style.opacity=e*k*.9;halo.style.transform="scale("+(1+.05*sway(t,.08,1))+")";
  }else{
    ringEl.style.opacity=0;
    var a=-28+sway(t,.05)*5,x=lerp(-40,0,e)*VM+sway(t,.07,2)*6*VM;
    beam.style.opacity=e*k*.9;beam.style.transform="translateX("+x+"px) rotate("+a+"deg)";
    beam2.style.opacity=e*k*.6;beam2.style.transform="translateX("+(x+12*VM)+"px) rotate("+(a+2)+"deg)";
    halo.style.opacity=e*k*.5;halo.style.transform="translate("+(sway(t,.04)*10*VM)+"px,"+(20*VM+sway(t,.06,1)*5*VM)+"px) scale(1.2)";
  }
};`,
    }),
  },
  {
    id: "device-3d",
    label: "Device in 3D",
    description:
      "A window, tablet or phone in perspective: it rises from below, turns slowly, then straightens, and keeps drifting. The screen is a montage asset (image or clip) or a mock interface.",
    box: box16x9,
    duration: 6,
    transparent: true,
    props: [
      screenProp,
      text("kind", "Kind (auto, window, tablet or phone)", "auto"),
      color("accent", "Accent", ACCENT),
      color("frame", "Frame colour", "#15171f"),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "floating-cards",
    label: "Floating cards",
    description:
      "A screen in perspective, and three cards that come out of it and float in front with shadow and glow. A card is 'Label|Value', or the name of a picture asset.",
    box: box16x9,
    duration: 6,
    transparent: true,
    props: [
      screenProp,
      text("card1", "Card 1 (Label|Value)", "Revenue|+24%"),
      text("card2", "Card 2", "Tasks done|1,284"),
      text("card3", "Card 3", "Latency|38 ms"),
      color("accent", "Accent", ACCENT),
      color("frame", "Frame colour", "#15171f"),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "cards-stack-3d",
    label: "Stacked cards",
    description:
      "Cards stacked in perspective that deploy one by one, then breathe. Each card is 'Title|Subtitle'.",
    box: box16x9,
    duration: 5,
    transparent: true,
    props: [
      text(
        "card1",
        "Card 1 (Title|Subtitle)",
        "Plan|Weekly goals, auto-sorted",
      ),
      text("card2", "Card 2", "Write|Drafts in your voice"),
      text("card3", "Card 3", "Review|One click to approve"),
      text("card4", "Card 4", "Ship|Published everywhere"),
      color("accent", "Accent", ACCENT),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "icon-grid-3d",
    label: "Icon grid in 3D",
    description:
      "A grid of glass tiles (letters or short marks, never emoji) that fly in from the depth to their place, then tilt gently.",
    box: box16x9,
    duration: 5,
    transparent: true,
    props: [
      longtext("items", "Tiles (comma separated)", "A,B,C,D,E,F,G,H,I,J,K,L"),
      number("cols", "Columns", 4),
      color("accent", "Accent", ACCENT),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "carousel-3d",
    label: "3D carousel",
    description:
      "Three to five cards on a ring that turns one step at a time (expo-out), the far ones dimmed. Each card is 'Title|Subtitle'.",
    box: box16x9,
    duration: 8,
    transparent: true,
    props: [
      text("card1", "Card 1 (Title|Subtitle)", "Inbox|Zero by noon"),
      text("card2", "Card 2", "Calendar|Meetings that matter"),
      text("card3", "Card 3", "Notes|Searchable, always"),
      text("card4", "Card 4", "Reports|Ready on Monday"),
      text("card5", "Card 5", ""),
      color("accent", "Accent", ACCENT),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "kinetic-counter",
    label: "Kinetic counter",
    description:
      "A huge number that counts from one value to another (expo-out) while a label changes: 'Not 15 % / Off 25 % / But 40 %'.",
    box: box16x9,
    duration: 5,
    transparent: true,
    props: [
      number("from", "From", 15),
      number("to", "To", 40),
      text("prefix", "Prefix", ""),
      text("suffix", "Suffix", "%"),
      longtext("labels", "Labels, in order (| separated)", "Not|Off|But"),
      text("caption", "Caption under the number", "faster onboarding"),
      color("accent", "Accent", ACCENT),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "text-inline-icon",
    label: "Text with inline icon",
    description:
      "A sentence whose words rise one by one, with a glowing pill (a glyph or a letter) inline after a chosen word; then everything lifts out.",
    box: box16x9,
    duration: 5,
    transparent: true,
    props: [
      text("text", "Sentence", "Ship updates your users notice"),
      text("icon", "Pill glyph (1-2 characters)", "→"),
      number("iconAfter", "Pill after word number (0 = none)", 2),
      color("accent", "Accent", ACCENT),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "brand-blur",
    label: "Brand blur",
    description:
      "The brand name, giant and blurred behind, with a device in front of it. Opaque: a hero shot.",
    box: box16x9,
    duration: 6,
    transparent: false,
    props: [
      text("brand", "Brand", "NEURAFLOW"),
      screenProp,
      text("kind", "Device (window, tablet or phone)", "window"),
      color("background", "Background", BACKGROUND),
      color("accent", "Accent", ACCENT),
      color("frame", "Frame colour", "#15171f"),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "orbit-updates",
    label: "Orbit updates",
    description:
      "A luminous ring with a title at its centre and glass pills (letters or marks) orbiting around it in a tilted plane.",
    box: box16x9,
    duration: 8,
    transparent: true,
    props: [
      text("title", "Title", "New Updates"),
      text("subtitle", "Subtitle", "Version 2.4"),
      longtext("items", "Pills (comma separated)", "AI,⌘,A,B,C,D"),
      color("accent", "Accent", ACCENT),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "chat-typing",
    label: "Chat typing (3D)",
    description:
      "A tilted glass chat panel: typing dots, then each bubble pops in while the thread slides up, nothing jumps.",
    box: box16x9,
    duration: 7,
    transparent: true,
    props: [
      longtext(
        "m1",
        "Message 1 (user)",
        "Can you summarise last week's calls?",
      ),
      longtext(
        "m2",
        "Message 2 (assistant)",
        "Sure. 14 calls, 3 need a follow-up.",
      ),
      longtext("m3", "Message 3 (user)", "Draft the follow-ups for me"),
      longtext(
        "m4",
        "Message 4 (assistant)",
        "Done. Three drafts are in your outbox.",
      ),
      color("accent", "Accent", ACCENT),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "search-focus",
    label: "Search focus",
    description:
      "A search field that zooms in, types a query, a cursor that glides to the button and clicks it, then selection handles around the field.",
    box: box16x9,
    duration: 5,
    transparent: true,
    props: [
      text("placeholder", "Placeholder", "Search anything…"),
      text("query", "Typed query", "invoices from Q3"),
      text("button", "Button", "Search"),
      color("accent", "Accent", ACCENT),
      color("ink", "Ink", INK),
    ],
    html: "",
  },
  {
    id: "cursor-click",
    label: "Cursor click",
    description:
      "A cursor that glides (expo-out) from one point to another and clicks with two glowing rings. Transparent: lay it over a capture; positions are fractions of the frame.",
    box: box16x9,
    duration: 2.5,
    transparent: true,
    props: [
      number("fromX", "Start x (0-1)", 0.2),
      number("fromY", "Start y (0-1)", 0.8),
      number("toX", "Click x (0-1)", 0.6),
      number("toY", "Click y (0-1)", 0.45),
      number("clickAt", "Click at (seconds)", 1.2),
      number("size", "Cursor size (1 = normal)", 1),
      color("accent", "Accent", ACCENT),
    ],
    html: "",
  },
];

// The pages, written next to the catalogue entries to keep them readable.

const DEVICE_SCRIPT = `
var d=device(document.getElementById("dev"),P.kind,P.screen);
window.setT=function(t){
  var e=at(t,0,1.6),s=at(t,2.2,2);
  var ry=lerp(-34,-12,e)+lerp(0,12,s)+sway(t,.12)*1.5;
  var rx=lerp(16,6,e)+lerp(0,-6,s)+sway(t,.09,1);
  var y=lerp(18,0,e)*VM+sway(t,.15,2)*.6*VM;
  d.el.style.opacity=clamp(e*3,0,1);
  d.el.style.transform="translate3d(0,"+y+"px,0) rotateX("+rx+"deg) rotateY("+ry+"deg) scale("+lerp(.9,1,e)+")";
  d.shine.style.backgroundPosition=(100-clamp((t-.6)/3,0,1)*100)+"% 0";
  if(d.seek)return d.seek(t);
};`;

SCENES[1].html = page({
  device: true,
  body: `<div class="stage"><div class="p3" id="dev"></div></div>`,
  script: DEVICE_SCRIPT,
});

SCENES[2].html = page({
  device: true,
  css: `
.card{position:absolute;left:50%;top:50%;width:30vmin;min-height:12vmin;padding:2.2vmin 2.6vmin;display:flex;flex-direction:column;gap:.8vmin;opacity:0}
.card small{font-size:2.2vmin;letter-spacing:.08em;text-transform:uppercase;color:rgb(var(--ink)/.6)}
.card b{font-size:5.2vmin;font-weight:800;letter-spacing:-.02em;text-shadow:0 0 2vmin rgb(var(--a)/.4)}
.card.pic{padding:0;overflow:hidden;min-height:0}
.card.pic img{display:block;width:100%;height:auto}
.card i{position:absolute;left:3vmin;right:3vmin;bottom:-1px;height:.3vmin;background:linear-gradient(90deg,transparent,rgb(var(--a)),transparent)}
`,
  body: `<div class="stage"><div class="p3" id="dev"></div><div class="glass card p3" id="c0"></div><div class="glass card p3" id="c1"></div><div class="glass card p3" id="c2"></div></div>`,
  script: `
var host=document.getElementById("dev");host.innerHTML="";
var d=device(host,"auto",P.screen);
d.fit(.78);
var spots=[[-.30,-.26],[.30,-.04],[-.22,.28]];
var cards=[0,1,2].map(function(i){
  var c=document.getElementById("c"+i),v=P["card"+(i+1)]||"";
  if(isPicture(v)){c.classList.add("pic");var im=document.createElement("img");loads.push(new Promise(function(res){im.onload=res;im.onerror=res}));im.src=ASSETS+v;c.appendChild(im);}
  else{var p=pair(v);var s=el("small","",c);s.textContent=p.label;var b=el("b","",c);b.textContent=p.value||p.label;if(!p.value)s.remove();el("i","",c);}
  return c;
});
window.setT=function(t){
  var e=at(t,0,1.4);
  var ry=-18+sway(t,.1)*2,rx=4+sway(t,.08,1)*1.5;
  d.el.style.opacity=clamp(e*3,0,1);
  d.el.style.transform="translate3d(0,"+(lerp(10,0,e)*VM)+"px,0) rotateX("+rx+"deg) rotateY("+ry+"deg)";
  d.shine.style.backgroundPosition=(100-clamp((t-.5)/3,0,1)*100)+"% 0";
  cards.forEach(function(c,i){
    var p=at(t,1+i*.35,1.3);
    var x=spots[i][0]*W+sway(t,.17,i)*.8*VM,y=spots[i][1]*H+sway(t,.2,i*2)*1.4*VM;
    c.style.opacity=p;
    c.style.transform="translate(-50%,-50%) translate3d("+x+"px,"+y+"px,"+(lerp(-4,18,p)*VM)+"px) rotateY("+(-18+lerp(0,8,p)+sway(t,.1)*2)+"deg) rotateX("+(sway(t,.13,i)*2)+"deg) scale("+lerp(.8,1,p)+")";
  });
  if(d.seek)return d.seek(t);
};`,
});

SCENES[3].html = page({
  css: `
.deck{position:absolute;left:50%;top:50%;width:0;height:0}
.card{position:absolute;left:-28vmin;top:-7.5vmin;width:56vmin;height:15vmin;padding:2.6vmin 3.2vmin;display:flex;flex-direction:column;justify-content:center;gap:.9vmin;opacity:0;backface-visibility:hidden}
.card b{font-size:4.6vmin;font-weight:800;letter-spacing:-.02em}
.card span{font-size:2.4vmin;color:rgb(var(--ink)/.6)}
.card i{position:absolute;left:0;top:0;bottom:0;width:.5vmin;border-radius:2.4vmin 0 0 2.4vmin;background:rgb(var(--a));box-shadow:0 0 2vmin rgb(var(--a)/.8)}
.card u{position:absolute;right:3vmin;top:50%;width:3.6vmin;height:3.6vmin;margin-top:-1.8vmin;border-radius:50%;background:rgb(var(--a)/.25);border:1px solid rgb(var(--a)/.8);text-decoration:none;font-size:2vmin;display:flex;align-items:center;justify-content:center;font-weight:700}
`,
  body: `<div class="stage"><div class="deck p3" id="deck"></div></div>`,
  script: `
var deck=document.getElementById("deck");
var items=[1,2,3,4].map(function(n){return P["card"+n]||""}).filter(Boolean);
var cards=items.map(function(v,i){var c=el("div","glass card p3",deck);var p=pair(v);el("i","",c);var b=el("b","",c);b.textContent=p.label;var s=el("span","",c);s.textContent=p.value;var u=el("u","",c);u.textContent=String(i+1);return c});
var n=cards.length,gap=17.5;
window.setT=function(t){
  var e=at(t,0,1.4);
  deck.style.transform="rotateX("+(lerp(62,38,at(t,.3,2.4))+sway(t,.08)*2)+"deg) rotateZ("+(-10+sway(t,.06,1)*2)+"deg) translateZ("+(-10*VM)+"px) scale("+lerp(.9,1,e)+")";
  cards.forEach(function(c,i){
    var p=at(t,.5+i*.32,1.3);
    var y=lerp(0,(i-(n-1)/2)*gap,p)*VM+sway(t,.2,i)*.6*VM;
    var z=lerp(i*1.2,i*3,p)*VM;
    c.style.opacity=at(t,.2+i*.12,.8);
    c.style.transform="translate3d(0,"+y+"px,"+z+"px)";
  });
};`,
});

SCENES[4].html = page({
  css: `
.grid{position:absolute;left:50%;top:50%;width:0;height:0}
.tile{position:absolute;width:13vmin;height:13vmin;margin:-6.5vmin 0 0 -6.5vmin;display:flex;align-items:center;justify-content:center;font-size:5.2vmin;font-weight:800;letter-spacing:-.02em;opacity:0;border-radius:3vmin}
.tile.hot{background:linear-gradient(150deg,rgb(var(--a)),rgb(var(--a)/.55));border-color:transparent;box-shadow:0 2vmin 6vmin rgba(0,0,0,.45),0 0 5vmin rgb(var(--a)/.55)}
`,
  body: `<div class="stage"><div class="grid p3" id="grid"></div></div>`,
  script: `
var grid=document.getElementById("grid"),items=list(P.items),cols=Math.max(1,Math.round(Number(P.cols)||4));
var rnd=window.random(11),step=16;
var rows=Math.ceil(items.length/cols);
var tiles=items.map(function(s,i){
  var c=el("div","glass tile p3",grid);c.textContent=s.slice(0,2);if(i%5===2)c.classList.add("hot");
  var col=i%cols,row=Math.floor(i/cols);
  return{el:c,x:(col-(cols-1)/2)*step,y:(row-(rows-1)/2)*step,sx:(rnd()-.5)*140,sy:(rnd()-.5)*90,sz:-60-rnd()*80,sr:(rnd()-.5)*160};
});
window.setT=function(t){
  grid.style.transform="rotateX("+(sway(t,.07)*5)+"deg) rotateY("+(sway(t,.05,1)*7)+"deg)";
  tiles.forEach(function(k,i){
    var p=at(t,.2+i*.11,1.5);
    var x=lerp(k.sx,k.x,p)*VM,y=lerp(k.sy,k.y,p)*VM+sway(t,.22,i)*.5*VM,z=lerp(k.sz,0,p)*VM+sway(t,.15,i*.7)*1.2*VM;
    k.el.style.opacity=clamp(p*2,0,1);
    k.el.style.transform="translate3d("+x+"px,"+y+"px,"+z+"px) rotateY("+lerp(k.sr,0,p)+"deg) rotateX("+lerp(k.sr*.5,0,p)+"deg)";
  });
};`,
});

SCENES[5].html = page({
  css: `
.ring{position:absolute;left:50%;top:50%;width:0;height:0}
.card{position:absolute;left:-15vmin;top:-20vmin;width:30vmin;height:40vmin;padding:3vmin;display:flex;flex-direction:column;justify-content:flex-end;gap:1vmin}
.card b{font-size:4.2vmin;font-weight:800;letter-spacing:-.02em}
.card span{font-size:2.3vmin;color:rgb(var(--ink)/.65)}
.card i{position:absolute;left:3vmin;top:3vmin;width:7vmin;height:7vmin;border-radius:2vmin;background:linear-gradient(150deg,rgb(var(--a)),rgb(var(--a)/.5));box-shadow:0 0 3vmin rgb(var(--a)/.6)}
`,
  body: `<div class="stage"><div class="ring p3" id="ring"></div></div>`,
  script: `
var ring=document.getElementById("ring");
var items=[1,2,3,4,5].map(function(n){return P["card"+n]||""}).filter(Boolean);
var n=Math.max(3,items.length),stepAngle=360/n,R=(30*VM/2)/Math.tan(Math.PI/n)+8*VM;
var cards=items.map(function(v){var c=el("div","glass card p3",ring);var p=pair(v);el("i","",c);var b=el("b","",c);b.textContent=p.label;var s=el("span","",c);s.textContent=p.value;return c});
var period=1.7;
window.setT=function(t){
  var e=at(t,0,1.6);
  var k=Math.floor(Math.max(0,t-.8)/period),f=Math.max(0,t-.8)-k*period;
  var turn=(k+expoOut(f/.9))*stepAngle;
  var base=lerp(-120,0,e)-turn+sway(t,.06)*2;
  ring.style.transform="translateZ("+(-R)+"px) rotateX("+(-6+sway(t,.09,1)*2)+"deg) rotateY("+base+"deg)";
  cards.forEach(function(c,i){
    var a=i*stepAngle,rad=(a+base)*Math.PI/180,front=(Math.cos(rad)+1)/2;
    c.style.transform="rotateY("+a+"deg) translateZ("+R+"px) translateY("+(sway(t,.18,i)*.8*VM)+"px)";
    c.style.opacity=e*lerp(.15,1,front);
    c.style.filter="blur("+((1-front)*.35*VM)+"px)";
  });
};`,
});

SCENES[6].html = page({
  css: `
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5vmin}
.label{position:relative;height:8vmin;width:100%;display:flex;align-items:center;justify-content:center}
.label span{position:absolute;font-size:6vmin;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgb(var(--a));text-shadow:0 0 3vmin rgb(var(--a)/.5);opacity:0;white-space:nowrap}
.num{font-size:30vmin;font-weight:800;letter-spacing:-.05em;line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 0 4vmin rgb(var(--a)/.35),0 1vmin 3vmin rgba(0,0,0,.4);display:flex;align-items:baseline}
.num small{font-size:12vmin;font-weight:700;letter-spacing:-.02em;margin-left:1vmin;color:rgb(var(--ink)/.85)}
.cap{font-size:4vmin;color:rgb(var(--ink)/.6);letter-spacing:.02em;opacity:0}
`,
  body: `<div class="wrap"><div class="label" id="label"></div><div class="num" id="num"><span id="prefix"></span><span id="value"></span><small id="suffix"></small></div><div class="cap" id="cap"></div></div>`,
  script: `
var from=Number(P.from)||0,to=Number(P.to)||0,labels=list(P.labels);
var labelBox=document.getElementById("label"),value=document.getElementById("value"),num=document.getElementById("num"),cap=document.getElementById("cap");
document.getElementById("prefix").textContent=P.prefix||"";document.getElementById("suffix").textContent=P.suffix||"";cap.textContent=P.caption||"";
var spans=labels.map(function(s){var e=el("span","",labelBox);e.textContent=s;return e});
var decimals=Math.max(String(from).split(".")[1]?String(from).split(".")[1].length:0,String(to).split(".")[1]?String(to).split(".")[1].length:0);
var t0=.3,len=2.6,seg=labels.length?len/labels.length:len;
window.setT=function(t){
  var p=at(t,t0,len),v=lerp(from,to,p);
  value.textContent=v.toFixed(decimals);
  var pop=1+.05*(1-at(t,t0+len-.2,.7))*at(t,t0+len-.2,.05);
  num.style.transform="scale("+(lerp(.86,1,at(t,0,1.2))*pop*(1+.006*sway(t,.2)))+") translateY("+(sway(t,.14)*.4*VM)+"px)";
  num.style.opacity=at(t,0,.8);
  spans.forEach(function(s,i){
    var start=t0+i*seg-.15,inA=at(t,start,.55),out=i<labels.length-1?at(t,start+seg,.4):0;
    s.style.opacity=inA*(1-out);
    s.style.transform="translateY("+(lerp(60,0,inA)-out*55)+"%)";
    s.style.filter="blur("+((1-inA)*1.2+out*1.2)*VM/2+"px)";
  });
  cap.style.opacity=at(t,.9,1);cap.style.transform="translateY("+(lerp(2,0,at(t,.9,1))*VM)+"px)";
};`,
});

SCENES[7].html = page({
  css: `
.line{position:absolute;inset:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;align-content:center;gap:0 2.4vmin;padding:0 8vw;text-align:center}
.w{font-size:9.5vmin;font-weight:800;letter-spacing:-.03em;line-height:1.25;opacity:0;text-shadow:0 .6vmin 2vmin rgba(0,0,0,.35)}
.pill{display:inline-flex;align-items:center;justify-content:center;width:10vmin;height:10vmin;border-radius:50%;background:linear-gradient(150deg,rgb(var(--a)),rgb(var(--a)/.6));box-shadow:0 0 4vmin rgb(var(--a)/.6),0 1vmin 3vmin rgba(0,0,0,.4);font-size:5vmin;font-weight:800;opacity:0;vertical-align:middle}
`,
  body: `<div class="line" id="line"></div>`,
  script: `
var line=document.getElementById("line"),ws=String(P.text||"").split(/\\s+/).filter(Boolean),after=Math.round(Number(P.iconAfter)||0);
var units=[];
ws.forEach(function(w,i){var e=el("span","w",line);e.textContent=w;units.push(e);if(after>0&&i===after-1&&P.icon){var p=el("span","pill",line);p.textContent=String(P.icon).slice(0,2);units.push(p)}});
var n=units.length,outAt=D-1.2;
window.setT=function(t){
  units.forEach(function(u,i){
    var a=at(t,.2+i*.14,.9),o=at(t,outAt+(n-1-i)*.05,.6);
    var pill=u.classList.contains("pill");
    u.style.opacity=a*(1-o);
    u.style.transform="translateY("+(lerp(60,0,a)-o*45)+"%) scale("+(pill?lerp(.3,1,a):1)+") translateY("+(sway(t,.16,i)*.25*VM)+"px)";
    u.style.filter="blur("+((1-a)*1.5+o)*VM/2+"px)";
  });
};`,
});

SCENES[8].html = page({
  device: true,
  css: `
.bg{position:absolute;inset:0;background:radial-gradient(110% 80% at 50% 110%,rgb(var(--a)/.25),transparent 60%),rgb(var(--bg))}
.brand{position:absolute;left:50%;top:50%;white-space:nowrap;font-weight:900;letter-spacing:-.04em;line-height:1;color:rgb(var(--ink));opacity:0;filter:blur(1.4vmin)}
.halo{position:absolute;left:50%;top:60%;width:110vmin;height:60vmin;margin:-30vmin 0 0 -55vmin;border-radius:50%;background:radial-gradient(ellipse,rgb(var(--a)/.35),transparent 60%);filter:blur(5vmin)}
`,
  body: `<div class="bg"></div><div class="halo" id="halo"></div><div class="brand" id="brand"></div><div class="stage"><div class="p3" id="dev"></div></div><div class="grain"></div><div class="vignette"></div>`,
  script: `
var brand=document.getElementById("brand"),halo=document.getElementById("halo");brand.textContent=P.brand||"";
var len=Math.max(3,String(P.brand||"").length);brand.style.fontSize=Math.min(44*VM,1.55*W/len)+"px";
var d=device(document.getElementById("dev"),P.kind,P.screen);
d.fit(.72);
window.setT=function(t){
  var e=at(t,0,1.6),f=at(t,.5,1.8);
  brand.style.opacity=e*.42;
  brand.style.transform="translate(-50%,-50%) scale("+(lerp(.9,1,e)*(1+.03*sway(t,.05)))+") translateX("+(sway(t,.04,1)*3*VM)+"px)";
  halo.style.transform="scale("+(1+.06*sway(t,.07))+")";
  d.el.style.opacity=f;
  d.el.style.transform="translate3d(0,"+(lerp(22,4,f)*VM+sway(t,.13,2)*.6*VM)+"px,0) rotateX("+(lerp(14,5,f)+sway(t,.09,1))+"deg) rotateY("+(lerp(-18,-8,f)+sway(t,.11)*1.5)+"deg) scale("+lerp(.92,1,f)+")";
  d.shine.style.backgroundPosition=(100-clamp((t-1)/3,0,1)*100)+"% 0";
  if(d.seek)return d.seek(t);
};`,
});

SCENES[9].html = page({
  css: `
.orbit{position:absolute;left:50%;top:50%;width:0;height:0}
.ring{position:absolute;left:-32vmin;top:-32vmin;width:64vmin;height:64vmin;border-radius:50%;background:conic-gradient(from 0deg,rgb(var(--a)) 0%,rgb(var(--a)/.05) 55%,rgb(var(--a)/.6) 100%);-webkit-mask:radial-gradient(circle,transparent 48%,#000 49%,#000 51%,transparent 52.5%);mask:radial-gradient(circle,transparent 48%,#000 49%,#000 51%,transparent 52.5%);filter:drop-shadow(0 0 2.5vmin rgb(var(--a)/.8));opacity:0}
.ring2{position:absolute;left:-32vmin;top:-32vmin;width:64vmin;height:64vmin;border-radius:50%;border:.25vmin solid rgb(var(--a)/.25);opacity:0}
.pill{position:absolute;width:9vmin;height:9vmin;margin:-4.5vmin 0 0 -4.5vmin;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:3.6vmin;font-weight:800;opacity:0}
.pill.hot{background:linear-gradient(150deg,rgb(var(--a)),rgb(var(--a)/.55));border-color:transparent;box-shadow:0 0 4vmin rgb(var(--a)/.6)}
.title{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;white-space:nowrap}
.title b{display:block;font-size:7.5vmin;font-weight:800;letter-spacing:-.03em;text-shadow:0 0 3vmin rgb(var(--a)/.45);opacity:0}
.title span{display:block;margin-top:1vmin;font-size:2.8vmin;letter-spacing:.2em;text-transform:uppercase;color:rgb(var(--a));opacity:0}
`,
  body: `<div class="stage"><div class="orbit p3" id="orbit"><div class="ring2" id="ring2"></div><div class="ring" id="ring"></div></div><div class="title"><b id="t1"></b><span id="t2"></span></div></div>`,
  script: `
var orbit=document.getElementById("orbit"),ring=document.getElementById("ring"),ring2=document.getElementById("ring2");
document.getElementById("t1").textContent=P.title||"";document.getElementById("t2").textContent=P.subtitle||"";
var items=list(P.items),R=32*VM,tilt=58;
var pills=items.map(function(s,i){var p=el("div","glass pill p3",orbit);p.textContent=s.slice(0,2);if(i===0)p.classList.add("hot");return p});
var t1=document.getElementById("t1"),t2=document.getElementById("t2");
window.setT=function(t){
  var e=at(t,0,1.6);
  var tx=tilt+sway(t,.08)*4,ty=sway(t,.06,1)*6;
  orbit.style.transform="rotateX("+tx+"deg) rotateZ("+ty+"deg) scale("+lerp(.7,1,e)+")";
  ring.style.opacity=e;ring.style.transform="rotate("+(t*40)+"deg)";
  ring2.style.opacity=e*.8;ring2.style.transform="scale("+(1.12+.02*sway(t,.1))+")";
  pills.forEach(function(p,i){
    var a=(i/pills.length)*Math.PI*2+t*.35,q=at(t,.6+i*.15,1);
    var x=Math.cos(a)*R,y=Math.sin(a)*R;
    p.style.opacity=q;
    p.style.transform="translate3d("+x+"px,"+y+"px,"+(lerp(-10,3,q)*VM)+"px) rotateZ("+(-ty)+"deg) rotateX("+(-tx)+"deg) scale("+lerp(.4,1,q)+")";
  });
  var a1=at(t,.4,1),a2=at(t,.8,1);
  t1.style.opacity=a1;t1.style.transform="translateY("+(lerp(3,0,a1)*VM+sway(t,.12)*.3*VM)+"px)";
  t2.style.opacity=a2;t2.style.transform="translateY("+(lerp(2,0,a2)*VM)+"px)";
};`,
});

SCENES[10].html = page({
  css: `
.panel{position:absolute;left:50%;top:50%;width:64vmin;height:72vmin;margin:-36vmin 0 0 -32vmin;padding:3vmin;overflow:hidden}
.panel .head{display:flex;align-items:center;gap:1.6vmin;padding-bottom:2vmin;border-bottom:1px solid rgba(255,255,255,.1)}
.panel .head i{width:4vmin;height:4vmin;border-radius:50%;background:linear-gradient(150deg,rgb(var(--a)),rgb(var(--a)/.5));box-shadow:0 0 2vmin rgb(var(--a)/.6)}
.panel .head b{font-size:2.6vmin}
.panel .head span{margin-left:auto;width:1.4vmin;height:1.4vmin;border-radius:50%;background:#3ddc84;box-shadow:0 0 1.5vmin #3ddc84}
.thread{position:absolute;left:3vmin;right:3vmin;bottom:3vmin;top:12vmin;overflow:hidden}
.msg{position:absolute;bottom:0;max-width:78%;padding:2vmin 2.6vmin;border-radius:2.6vmin;font-size:2.9vmin;line-height:1.35;opacity:0;box-shadow:0 1.5vmin 4vmin rgba(0,0,0,.35)}
.msg.me{right:0;background:linear-gradient(150deg,rgb(var(--a)),rgb(var(--a)/.7));border-bottom-right-radius:.8vmin;box-shadow:0 1.5vmin 4vmin rgba(0,0,0,.35),0 0 3vmin rgb(var(--a)/.4);transform-origin:100% 100%}
.msg.bot{left:0;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);border-bottom-left-radius:.8vmin;transform-origin:0 100%}
.typing{position:absolute;left:0;bottom:0;padding:2vmin 2.4vmin;border-radius:2.6vmin;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);display:flex;gap:.9vmin;opacity:0;transform-origin:0 100%}
.typing.me{left:auto;right:0;background:rgb(var(--a)/.85);transform-origin:100% 100%}
.typing i{width:1.3vmin;height:1.3vmin;border-radius:50%;background:rgb(var(--ink)/.8)}
`,
  body: `<div class="stage"><div class="glass panel p3" id="panel"><div class="head"><i></i><b>Assistant</b><span></span></div><div class="thread" id="thread"></div></div></div>`,
  script: `
var panel=document.getElementById("panel"),thread=document.getElementById("thread");
var msgs=[1,2,3,4].map(function(n){return P["m"+n]||""}).filter(Boolean);
var gap=1.6*VM,items=[];
msgs.forEach(function(m,i){
  var me=i%2===0,t0=.3+i*1.55;
  var ty=el("div","typing"+(me?" me":""),thread);ty.innerHTML="<i></i><i></i><i></i>";
  var b=el("div","msg "+(me?"me":"bot"),thread);b.textContent=m;
  items.push({el:ty,typing:true,t0:t0,t1:t0+.95,h:0});
  items.push({el:b,typing:false,t0:t0+.95,h:0});
});
items.forEach(function(k){k.h=k.el.offsetHeight});
function presence(k,t){return k.typing?at(t,k.t0,.35)*(1-at(t,k.t1,.3)):at(t,k.t0,.6)}
window.setT=function(t){
  var e=at(t,0,1.4);
  panel.style.opacity=e;
  panel.style.transform="rotateY("+(-10+sway(t,.09)*2)+"deg) rotateX("+(4+sway(t,.07,1)*1.5)+"deg) translateY("+(lerp(6,0,e)*VM+sway(t,.12,2)*.5*VM)+"px) scale("+lerp(.94,1,e)+")";
  var offset=0;
  for(var i=items.length-1;i>=0;i--){
    var k=items[i],p=presence(k,t);
    k.el.style.opacity=p;
    k.el.style.transform="translateY("+(-offset+lerp(1.5,0,p)*VM)+"px) scale("+lerp(.6,1,p)+")";
    if(k.typing){var dots=k.el.children;for(var j=0;j<3;j++)dots[j].style.transform="translateY("+(Math.sin(t*9+j*1.1)*.35*VM)+"px)";}
    offset+=(k.h+gap)*p;
  }
};`,
});

SCENES[11].html = page({
  css: `
.group{position:absolute;left:50%;top:50%;width:76vmin;margin-left:-38vmin;display:flex;gap:1.6vmin;align-items:center}
.field{flex:1;height:9vmin;border-radius:2.2vmin;background:rgba(255,255,255,.08);border:.25vmin solid rgba(255,255,255,.16);display:flex;align-items:center;padding:0 2.6vmin;gap:1.6vmin;font-size:3.2vmin;position:relative;box-shadow:0 2vmin 6vmin rgba(0,0,0,.4)}
.field .lens{width:2.6vmin;height:2.6vmin;border:.4vmin solid rgb(var(--ink)/.6);border-radius:50%;position:relative;flex:none}
.field .lens:after{content:"";position:absolute;left:1.9vmin;top:1.9vmin;width:1.2vmin;height:.4vmin;background:rgb(var(--ink)/.6);transform:rotate(45deg);transform-origin:0 0}
.field .ph{color:rgb(var(--ink)/.4);position:absolute;left:6.8vmin}
.field .q{white-space:pre}
.field .caret{width:.3vmin;height:3.6vmin;background:rgb(var(--a));box-shadow:0 0 1vmin rgb(var(--a));margin-left:.2vmin}
.btn{height:9vmin;padding:0 3.4vmin;border-radius:2.2vmin;background:linear-gradient(150deg,rgb(var(--a)),rgb(var(--a)/.7));display:flex;align-items:center;font-size:3vmin;font-weight:700;box-shadow:0 1.5vmin 4vmin rgba(0,0,0,.4),0 0 3vmin rgb(var(--a)/.4);white-space:nowrap}
.sel{position:absolute;inset:-1.6vmin;border:.25vmin dashed rgb(var(--a));border-radius:3vmin;opacity:0;pointer-events:none}
.sel i{position:absolute;width:1.8vmin;height:1.8vmin;margin:-.9vmin 0 0 -.9vmin;background:#fff;border:.3vmin solid rgb(var(--a));border-radius:.3vmin;box-shadow:0 0 1.2vmin rgb(var(--a)/.8)}
.cursor{position:absolute;left:0;top:0;width:4.4vmin;height:4.4vmin;opacity:0;filter:drop-shadow(0 .4vmin .8vmin rgba(0,0,0,.5))}
.ripple{position:absolute;width:6vmin;height:6vmin;margin:-3vmin 0 0 -3vmin;border-radius:50%;border:.4vmin solid rgb(var(--a));box-shadow:0 0 2vmin rgb(var(--a)/.7);opacity:0}
`,
  body: `<div class="stage"><div class="group p3" id="group"><div class="field" id="field"><span class="lens"></span><span class="ph" id="ph"></span><span class="q" id="q"></span><span class="caret" id="caret"></span><div class="sel" id="sel"><i style="left:0;top:0"></i><i style="left:100%;top:0"></i><i style="left:0;top:100%"></i><i style="left:100%;top:100%"></i><i style="left:50%;top:0"></i><i style="left:50%;top:100%"></i><i style="left:0;top:50%"></i><i style="left:100%;top:50%"></i></div></div><div class="btn" id="btn"></div></div><div class="ripple" id="r1"></div><div class="ripple" id="r2"></div><div class="cursor" id="cur">${CURSOR_SVG}</div></div>`,
  script: `
var group=document.getElementById("group"),field=document.getElementById("field"),ph=document.getElementById("ph"),q=document.getElementById("q"),caret=document.getElementById("caret"),btn=document.getElementById("btn"),sel=document.getElementById("sel"),cur=document.getElementById("cur"),r1=document.getElementById("r1"),r2=document.getElementById("r2");
ph.textContent=P.placeholder||"";btn.textContent=P.button||"";var query=String(P.query||"");
var T_ZOOM=.3,T_TYPE=.8,T_TYPED=2.1,T_MOVE=2.2,T_CLICK=3.05,T_SEL=3.5;
function btnCentre(){var b=btn.getBoundingClientRect();return{x:b.left+b.width*.5,y:b.top+b.height*.5}}
window.setT=function(t){
  var e=at(t,0,1),z=at(t,T_ZOOM,1.4);
  group.style.opacity=e;
  group.style.transform="translateY(-50%) scale("+(lerp(.92,1,e)*lerp(1,1.18,z))+") rotateY("+(sway(t,.09)*2)+"deg) translateY("+(sway(t,.13,1)*.3*VM)+"px)";
  var focus=at(t,T_ZOOM+.2,.6);
  field.style.borderColor="rgb(var(--a)/"+(.16+focus*.8)+")";
  field.style.boxShadow="0 2vmin 6vmin rgba(0,0,0,.4),0 0 "+(focus*3)+"vmin rgb(var(--a)/"+(focus*.5)+")";
  var n=Math.floor(query.length*clamp((t-T_TYPE)/(T_TYPED-T_TYPE),0,1));
  q.textContent=query.slice(0,n);ph.style.opacity=n>0?0:1-focus*.4;
  caret.style.opacity=focus*((t>T_TYPE&&t<T_TYPED)||Math.floor(t*2.2)%2===0?1:0);
  var m=at(t,T_MOVE,T_CLICK-T_MOVE-.1),c=btnCentre();
  var sx=W*.72,sy=H*.86,x=lerp(sx,c.x,m)+Math.sin(m*Math.PI)*-6*VM,y=lerp(sy,c.y,m);
  var press=at(t,T_CLICK,.08)*(1-at(t,T_CLICK+.08,.3));
  cur.style.opacity=at(t,T_MOVE-.2,.4);
  cur.style.transform="translate("+x+"px,"+y+"px) scale("+(1-.18*press)+")";
  btn.style.transform="scale("+(1-.06*press)+")";
  btn.style.filter="brightness("+(1+.25*at(t,T_CLICK,.1)*(1-at(t,T_CLICK+.2,.6)))+")";
  [r1,r2].forEach(function(r,i){var p=at(t,T_CLICK+i*.067,.55);r.style.opacity=(1-p)*(t>=T_CLICK+i*.067?1:0);r.style.transform="translate("+x+"px,"+y+"px) scale("+lerp(.3,2.6,p)+")";});
  var s=at(t,T_SEL,.7);
  sel.style.opacity=s;sel.style.transform="scale("+lerp(1.06,1,s)+")";
  var hs=sel.children;for(var i=0;i<hs.length;i++){var hp=at(t,T_SEL+.05*i,.4);hs[i].style.transform="scale("+hp+")";}
};`,
});

SCENES[12].html = page({
  css: `
.cursor{position:absolute;left:0;top:0;width:4.4vmin;height:4.4vmin;filter:drop-shadow(0 .4vmin .9vmin rgba(0,0,0,.55));transform-origin:12% 8%}
.press{position:absolute;width:5vmin;height:5vmin;margin:-2.5vmin 0 0 -2.5vmin;border-radius:50%;background:rgb(var(--a)/.35);opacity:0}
.ripple{position:absolute;width:6vmin;height:6vmin;margin:-3vmin 0 0 -3vmin;border-radius:50%;border:.45vmin solid rgb(var(--a));box-shadow:0 0 2vmin rgb(var(--a)/.7),inset 0 0 1.5vmin rgb(var(--a)/.4);opacity:0}
`,
  body: `<div class="press" id="press"></div><div class="ripple" id="r1"></div><div class="ripple" id="r2"></div><div class="cursor" id="cur">${CURSOR_SVG}</div>`,
  script: `
var cur=document.getElementById("cur"),press=document.getElementById("press"),r1=document.getElementById("r1"),r2=document.getElementById("r2");
var fx=Number(P.fromX)*W,fy=Number(P.fromY)*H,tx=Number(P.toX)*W,ty=Number(P.toY)*H,T=Math.max(.3,Number(P.clickAt)||1.2),size=clamp(Number(P.size)||1,.3,3);
var dx=tx-fx,dy=ty-fy,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
window.setT=function(t){
  var m=at(t,0,Math.max(.2,T-.15)),arc=Math.sin(m*Math.PI)*len*.08;
  var x=lerp(fx,tx,m)+nx*arc,y=lerp(fy,ty,m)+ny*arc;
  var p=at(t,T,.07)*(1-at(t,T+.07,.3));
  cur.style.transform="translate("+(x-.12*4.4*VM*size)+"px,"+(y-.08*4.4*VM*size)+"px) scale("+(size*(1-.18*p))+")";
  press.style.opacity=p;press.style.transform="translate("+tx+"px,"+ty+"px) scale("+(.6+.6*p)+")";
  [r1,r2].forEach(function(r,i){var q=at(t,T+i*.067,.55);r.style.opacity=(1-q)*(t>=T+i*.067?1:0);r.style.transform="translate("+tx+"px,"+ty+"px) scale("+lerp(.3,2.8,q)+")";});
};`,
});

/** Ids of the built-in scenes. */
export const SCENE_IDS = SCENES.map((s) => s.id);

export const isSceneId = (id: string) => SCENES.some((s) => s.id === id);

/**
 * A built-in scene fitted to a format: the same page, boxed to that frame
 * (every scene lays itself out from its viewport, in vmin/vw/vh).
 */
export function sceneFor(
  id: string,
  aspect: SceneAspect | string = "16:9",
): Composition | null {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) return null;
  const box =
    SCENE_BOXES[(aspect in SCENE_BOXES ? aspect : "16:9") as SceneAspect];
  return { ...scene, box };
}
