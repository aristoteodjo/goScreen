const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const W = 360, H = 780, DSF = 3;
const UA = 'Mozilla/5.0 (Linux; Android 16; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

// Runs in every page before its scripts: touch rings, and test banners hidden before they are ever painted.
function pageInit() {
  const css = `.vsl-tap{position:fixed;z-index:2147483647;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
  background:rgba(233,161,0,.30);border:3px solid rgba(22,36,28,.75);pointer-events:none;animation:vslTap .65s ease-out forwards}
  @keyframes vslTap{from{transform:scale(.45);opacity:1}to{transform:scale(1.2);opacity:0}}
  .vsl-hidden{visibility:hidden!important}`;
  const RX = /^(Développement|Environnement de test)\s*:/;
  const scan = root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!RX.test(n.textContent.trim()) && !RX.test((n.parentElement?.textContent || '').trim())) continue;
      const el = n.parentElement?.closest('p,div') || n.parentElement;
      if (el && RX.test(el.textContent.trim())) { window.__vslCodes = (window.__vslCodes || []).concat(el.textContent.match(/\d{6}/g) || []); el.classList.add('vsl-hidden'); }
    }
  };
  const boot = () => {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    scan(document.body);
    new MutationObserver(ms => ms.forEach(m => { m.addedNodes.forEach(x => x.nodeType === 1 ? scan(x) : x.parentElement && scan(x.parentElement)); if (m.type === 'characterData' && m.target.parentElement) scan(m.target.parentElement); }))
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
  window.__vslTap = (x, y) => { const d = document.createElement('div'); d.className = 'vsl-tap'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 750); };
}

async function launch() {
  return chromium.launch();
}

async function context(browser, state) {
  const ctx = await browser.newContext({
    ...(state ? { storageState: state } : {}),
    viewport: { width: W, height: H }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true, userAgent: UA,
    locale: 'fr-FR', timezoneId: 'Africa/Porto-Novo', colorScheme: 'light',
  });
  await ctx.addInitScript(pageInit);
  return ctx;
}

// The latest 6-digit code a test banner printed (read before it is hidden).
async function lastCode(page, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const codes = await page.evaluate(() => window.__vslCodes || []);
    if (codes.length) return codes.at(-1);
    await page.waitForTimeout(300);
  }
  throw new Error('no code shown');
}
async function clearCodes(page) { await page.evaluate(() => { window.__vslCodes = []; }); }

class Recorder {
  constructor(page, name) { this.page = page; this.name = name; this.dir = path.join(__dirname, 'rec', name); this.frames = []; this.scenes = []; this.pointers = []; }
  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', f => {
      const file = path.join(this.dir, `f${String(this.frames.length).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      this.frames.push({ file, t: f.metadata.timestamp });
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W * DSF, maxHeight: H * DSF, everyNthFrame: 1 });
    await this.nudge(600);
  }
  now() { return Date.now() / 1000; }
  // Keeps frames coming while the screen is still, so a pause has real frames around it.
  async nudge(ms) {
    const end = Date.now() + ms;
    let flip = false;
    while (Date.now() < end) {
      flip = !flip;
      await this.page.evaluate(f => { document.documentElement.style.setProperty('--vsl-nudge', f ? '1' : '0'); document.documentElement.style.outlineColor = f ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.001)'; }, flip).catch(() => {});
      await this.page.waitForTimeout(100);
    }
  }
  async scene(id, caption) { await this.nudge(150); this.current = { id, caption, from: this.now() }; }
  async end(holdMs = 1200) { await this.nudge(holdMs); this.current.to = this.now(); this.scenes.push(this.current); this.current = null; }
  tapAt(x, y) { const t = this.now(); this.pointers.push({ t, kind: 'down', x, y }, { t: t + 0.08, kind: 'up', x, y }); }
  async stop() {
    await this.nudge(300);
    await this.cdp.send('Page.stopScreencast');
    const t0 = this.frames[0].t;
    const lines = ['ffconcat version 1.0'];
    const stopAt = this.now();
    this.frames.forEach((fr, i) => {
      // A still screen sends no frames: the last one lasts until the recording stops.
      const next = i + 1 < this.frames.length ? this.frames[i + 1].t : Math.max(fr.t + 0.1, stopAt);
      lines.push(`file '${path.basename(fr.file)}'`, `duration ${Math.max(0.001, next - fr.t).toFixed(4)}`);
    });
    lines.push(`file '${path.basename(this.frames.at(-1).file)}'`);
    fs.writeFileSync(path.join(this.dir, 'list.ffconcat'), lines.join('\n'));
    const rel = t => Math.max(0, t - t0);
    const meta = {
      name: this.name, width: W, height: H, dsf: DSF,
      scenes: this.scenes.map(s => ({ id: s.id, caption: s.caption, in: rel(s.from), out: rel(s.to) })),
      pointers: this.pointers.map(p => ({ ...p, t: rel(p.t) })),
    };
    fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify(meta, null, 1));
    return meta;
  }
}

async function tap(rec, locator, { force = false } = {}) {
  await locator.scrollIntoViewIfNeeded();
  await rec.page.waitForTimeout(250);
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    rec.tapAt(x / W, y / H);
    await rec.page.evaluate(([x, y]) => window.__vslTap(x, y), [x, y]);
  }
  await rec.page.waitForTimeout(280);
  await locator.click({ force });
}

async function type(rec, locator, text, delay = 85) {
  await tap(rec, locator);
  await locator.pressSequentially(text, { delay });
}

async function scroll(rec, dy, ms = 1200) {
  const steps = Math.max(1, Math.round(ms / 40));
  for (let i = 0; i < steps; i++) { await rec.page.mouse.wheel(0, dy / steps); await rec.page.waitForTimeout(40); }
}

async function shot(page, name) { await page.screenshot({ path: path.join(__dirname, 'debug', `${name}.png`) }).catch(() => {}); }
fs.mkdirSync(path.join(__dirname, 'debug'), { recursive: true });

module.exports = { launch, context, Recorder, tap, type, scroll, shot, lastCode, clearCodes, W, H, DSF };
