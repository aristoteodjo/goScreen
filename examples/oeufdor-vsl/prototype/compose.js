// Builds the finished vertical videos from the recordings: one card per scene (caption + phone frame),
// the screen recording placed in the phone glass, title cards at both ends.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'out');
const CW = 1080, CH = 1920;
// Phone: Galaxy S25 glass 360x780, bezel 11, radius 48 / 38 (goScreen registry), scaled to a 1400 px tall glass.
const GH = 1400, GW = Math.round(GH * 360 / 780), K = GH / 780;
const BEZ = Math.round(11 * K), R_OUT = Math.round(48 * K), R_IN = Math.round(38 * K);
const PX = Math.round((CW - GW) / 2), PY = 430;
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=JetBrains+Mono:wght@500;700&display=swap">';

const rr = (x, y, w, h, r) => `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;

const fr = t => String(t).replace(/ ([?:!;])/g, '\u00a0$1');
function frameHtml({ eyebrow, caption, accent }) {
  caption = fr(caption);
  const hole = rr(PX, PY, GW, GH, R_IN);
  const body = rr(PX - BEZ, PY - BEZ, GW + 2 * BEZ, GH + 2 * BEZ, R_OUT);
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  html,body{margin:0;width:${CW}px;height:${CH}px;background:transparent;overflow:hidden}
  .cap{position:absolute;left:72px;right:72px;top:96px;height:290px;display:flex;flex-direction:column;justify-content:center;gap:18px}
  .eyebrow{font:500 30px "JetBrains Mono",monospace;letter-spacing:.08em;text-transform:uppercase;color:#56635a;display:flex;align-items:center;gap:16px}
  .eyebrow i{display:inline-block;width:22px;height:22px;border-radius:50%;background:${accent}}
  .text{font:800 76px/1.04 "Bricolage Grotesque",sans-serif;color:#16241c;text-wrap:balance;letter-spacing:-.01em}
  </style></head><body>
  <svg width="${CW}" height="${CH}" style="position:absolute;inset:0">
    <path fill-rule="evenodd" fill="#f7f7f2" d="M0,0H${CW}V${CH}H0Z ${hole}"/>
    <defs><clipPath id="out"><path clip-rule="evenodd" d="M0,0H${CW}V${CH}H0Z ${body}"/></clipPath></defs>
    <circle clip-path="url(#out)" cx="${CW - 60}" cy="${PY + 260}" r="330" fill="${accent}" opacity=".16"/>
    <path fill-rule="evenodd" d="${body} ${hole}" fill="#26304a"/>
    <path fill="none" stroke="#4a5576" stroke-width="3" d="${body}"/>
    <rect x="${PX - BEZ - 5}" y="${PY + 260}" width="6" height="120" rx="3" fill="#4a5576"/>
  </svg>
  <div class="cap"><div class="eyebrow"><i></i>${eyebrow}</div><div class="text">${caption}</div></div>
  </body></html>`;
}

function cardHtml({ eyebrow, title, sub, accent }) {
  title = fr(title); sub = sub && fr(sub);
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  html,body{margin:0;width:${CW}px;height:${CH}px;background:#f7f7f2;overflow:hidden;font-family:"Atkinson Hyperlegible",sans-serif;color:#16241c}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 96px;gap:40px}
  .logo{display:flex;align-items:center;gap:22px;font:800 64px "Bricolage Grotesque",sans-serif}
  .logo i{width:46px;height:46px;border-radius:50%;background:#e9a100;box-shadow:0 0 0 14px rgba(233,161,0,.18)}
  .eyebrow{font:500 32px "JetBrains Mono",monospace;letter-spacing:.08em;text-transform:uppercase;color:#56635a}
  h1{margin:0;font:800 104px/1.02 "Bricolage Grotesque",sans-serif;text-wrap:balance}
  h1 em{font-style:normal;color:${accent}}
  p{margin:0;font-size:46px;line-height:1.3;color:#56635a;max-width:20ch}
  .url{font:700 44px "JetBrains Mono",monospace;color:#16241c;border-top:4px solid ${accent};padding-top:28px;align-self:flex-start}
  .blob{position:absolute;right:-180px;bottom:-160px;width:720px;height:720px;border-radius:50%;background:${accent};opacity:.16}
  </style></head><body><div class="blob"></div><div class="wrap">
  <div class="logo"><i></i>OEUF D'OR</div>
  ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}
  <h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}
  </div></body></html>`;
}

function ff(args) { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }); }

// One clean 30 fps screen video per recording, from the screencast frames and their real timestamps.
function screenVideo(name) {
  const dir = path.join(__dirname, 'rec', name);
  const out = path.join(dir, 'screen.mp4');
  if (fs.existsSync(out)) return out;
  // Rebuild a constant 30 fps sequence from the frames' real timestamps (cumulated from list.ffconcat).
  const lines = fs.readFileSync(path.join(dir, 'list.ffconcat'), 'utf8').split('\n');
  const frames = [];
  let t = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^file '(.+)'$/);
    const d = lines[i + 1] && lines[i + 1].match(/^duration (.+)$/);
    if (m && d) { frames.push({ file: m[1], t }); t += Number(d[1]); }
  }
  const seq = path.join(dir, 'seq');
  fs.rmSync(seq, { recursive: true, force: true });
  fs.mkdirSync(seq);
  const total = Math.ceil(t * 30);
  let j = 0;
  for (let k = 0; k < total; k++) {
    const at = k / 30;
    while (j + 1 < frames.length && frames[j + 1].t <= at) j++;
    fs.symlinkSync(path.join(dir, frames[j].file), path.join(seq, `${String(k).padStart(6, '0')}.jpg`));
  }
  ff(['-framerate', '30', '-i', path.join(seq, '%06d.jpg'), '-vf', 'scale=1080:2340:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', out]);
  return out;
}

async function build(film) {
  fs.mkdirSync(OUT, { recursive: true });
  const work = path.join(OUT, film.slug);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: CW, height: CH } });
  const render = async (html, file, transparent) => {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file, omitBackground: transparent });
  };
  const parts = [];
  const card = async (c, i) => {
    const png = path.join(work, `card${i}.png`);
    await render(cardHtml({ ...c, accent: film.accent }), png, false);
    const mp4 = path.join(work, `part${String(parts.length).padStart(2, '0')}.mp4`);
    ff(['-loop', '1', '-framerate', '30', '-t', String(c.duration), '-i', png, '-vf', `fade=t=in:st=0:d=0.35,fade=t=out:st=${c.duration - 0.35}:d=0.35,format=yuv420p`, '-c:v', 'libx264', '-crf', '16', '-r', '30', mp4]);
    parts.push(mp4);
  };
  await card(film.intro, 0);
  const total = film.scenes.length;
  for (const [i, sc] of film.scenes.entries()) {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'rec', sc.rec, 'meta.json')));
    const m = sc.from !== undefined ? { in: sc.from, out: sc.to, caption: sc.caption } : meta.scenes.find(s => s.id === (sc.src || sc.id));
    if (!m) throw new Error(`scene ${sc.id} missing in ${sc.rec}`);
    const png = path.join(work, `frame-${sc.id}.png`);
    await render(frameHtml({ eyebrow: `${film.label} · ${i + 1}/${total}`, caption: sc.caption || m.caption, accent: film.accent }), png, true);
    const src = screenVideo(sc.rec);
    const from = m.in + (sc.trimIn || 0), to = m.out - (sc.trimOut || 0);
    const speed = sc.speed || 1;
    const dur = (to - from) / speed;
    const mp4 = path.join(work, `part${String(parts.length).padStart(2, '0')}.mp4`);
    ff(['-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', src, '-loop', '1', '-framerate', '30', '-i', png,
      '-filter_complex', `color=c=0xf7f7f2:s=${CW}x${CH}:r=30:d=${dur.toFixed(3)}[base];[0:v]setpts=(PTS-STARTPTS)/${speed},scale=${GW}:${GH}:flags=lanczos,setsar=1[s];[base][s]overlay=${PX}:${PY}:shortest=1[a];[a][1:v]overlay=0:0:shortest=1,fade=t=in:st=0:d=0.2,format=yuv420p[v]`,
      '-map', '[v]', '-t', dur.toFixed(3), '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-r', '30', mp4]);
    parts.push(mp4);
  }
  await card(film.outro, 1);
  await browser.close();
  const list = path.join(work, 'parts.txt');
  fs.writeFileSync(list, parts.map(p => `file '${p}'`).join('\n'));
  const final = path.join(OUT, `${film.slug}.mp4`);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', final]);
  return final;
}

module.exports = { build, frameHtml, cardHtml, screenVideo, CW, CH, GW, GH, PX, PY };
