// Writes a goScreen project per film in ~/Movies/goScreen: the screen alone (device capture), its touches,
// and an edit with title slides, one clip and one caption per scene, zooms on taps, and a Galaxy S25 frame.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { screenVideo } = require('./compose');

const DIR = path.join(os.homedir(), 'Movies', 'goScreen');
const ff = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

function project(film) {
  const stem = `oeufdor-${film.slug}`;
  const tmp = path.join(__dirname, 'out', film.slug, 'gs');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const instanceId = `oeufdor-${film.slug}-glass`;
  const pieces = [], pointers = [], clips = [], overlays = [], zooms = [];
  let src = 0, timeline = 0;
  const slide = (c, idSuffix) => {
    clips.push({ id: `${stem}-${idSuffix}`, kind: 'slide', transition: { kind: 'fade', duration: 0.35 }, duration: c.duration,
      background: { kind: 'color', value: '#f7f7f2' }, title: c.title.replace(/<[^>]+>/g, ''), subtitle: c.sub || '',
      color: '#16241c', font: 'Bricolage Grotesque Variable', animation: 'words' });
    timeline += c.duration;
  };
  slide(film.intro, 'intro');
  film.scenes.forEach((sc, i) => {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'rec', sc.rec, 'meta.json')));
    const m = sc.from !== undefined ? { in: sc.from, out: sc.to, caption: sc.caption } : meta.scenes.find(s => s.id === (sc.src || sc.id));
    const from = m.in + (sc.trimIn || 0), to = m.out - (sc.trimOut || 0), len = to - from;
    const piece = path.join(tmp, `${String(i).padStart(2, '0')}.mp4`);
    ff(['-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', screenVideo(sc.rec), '-c:v', 'libx264', '-crf', '15', '-r', '30', '-pix_fmt', 'yuv420p', piece]);
    pieces.push(piece);
    meta.pointers.filter(pt => pt.t >= from && pt.t <= to).forEach(pt =>
      pointers.push({ t: src + pt.t - from, kind: pt.kind, x: pt.x, y: pt.y, u: pt.x, v: pt.y, instanceId, source: 'web' }));
    clips.push({ id: `${stem}-${sc.id}`, kind: 'recording', in: src, out: src + len, speed: sc.speed || 1, muted: true, cameraHidden: true,
      transition: i === 0 ? { kind: 'fade', duration: 0.35 } : null });
    const dur = len / (sc.speed || 1);
    overlays.push({ id: `${stem}-cap-${sc.id}`, kind: 'text', lane: 0, start: timeline, duration: dur, x: 0.5, y: 0.085, width: 0.88, height: 0.11,
      rotation: 0, opacity: 1, enter: 'words', exit: 'fade', motion: 0.35, text: sc.caption.replace(/ ([?:!;])/g, '\u00a0$1'),
      style: { font: 'Bricolage Grotesque Variable', size: 0.042, weight: 800, color: '#16241c', align: 'center', background: null } });
    // A gentle zoom on each burst of taps (source time), like goScreen's own auto-zoom.
    const downs = meta.pointers.filter(pt => pt.kind === 'down' && pt.t >= from && pt.t <= to);
    if (downs.length && !sc.noZoom) {
      const first = downs[0], last = downs.at(-1);
      zooms.push({ id: `${stem}-zoom-${sc.id}`, start: Math.max(src, src + first.t - from - 0.6), end: Math.min(src + len, src + last.t - from + 1.4),
        scale: 1.35, focus: { x: 0.5, y: Math.min(0.8, Math.max(0.2, first.y)) } });
    }
    src += len; timeline += dur;
  });
  slide(film.outro, 'outro');
  const list = path.join(tmp, 'pieces.txt');
  fs.writeFileSync(list, pieces.map(p => `file '${p}'`).join('\n'));
  fs.mkdirSync(DIR, { recursive: true });
  const video = path.join(DIR, `${stem}.mp4`);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', video]);
  const interactions = {
    version: 3, mode: 'device', capture: { width: 1080, height: 2340 },
    layers: [{ instanceId, deviceId: 'galaxy-s25', colorId: 'navy', orientation: 'portrait', screen: { width: 360, height: 780 }, source: 'web', rotation: 0,
      rects: [{ t: 0, x: 0, y: 0, width: 1, height: 1 }] }],
    pointers, media: { camera: null, mic: null, offsetMs: 0 }, pauses: [], camera: null, chapters: [],
  };
  fs.writeFileSync(path.join(DIR, `${stem}.interactions.json`), JSON.stringify(interactions, null, 1));
  const edit = {
    version: 2, aspect: '9:16', background: { kind: 'color', value: '#f7f7f2' }, padding: 0.14, radius: 18, shadow: 0.5,
    clips, overlays, audio: [], assets: [], zooms,
    // Touch rings are already in the picture (recorded on the page).
    touch: { style: 'none', color: '#ffffff', size: 44 }, cursor: { visible: false, size: 28 }, sound: { clicks: false, volume: 0.6 },
    layers: [{ instanceId, deviceId: 'galaxy-s25', colorId: 'navy', frame: true, x: 0.5, y: 0.56, scale: 1, rotation: 0, hidden: false }],
    camera: { visible: false, layout: 'overlay', corner: 8, size: 0.22, shape: 'rounded', mirror: true },
    mic: { volume: 1 }, tracks: { hidden: [], muted: [], micMuted: false },
  };
  fs.writeFileSync(path.join(DIR, `${stem}.edit.json`), JSON.stringify(edit, null, 1));
  return { video, stem };
}

module.exports = { project };
