# Editing a montage

Every command takes `video`: the absolute path of a take (`projects.videos`),
or of a montage made without one (`edit.new`, a `.edit.json`). If the video
is open in the editor, the person sees each change at once and can undo it;
otherwise the `.edit.json` next to the video is written.

## A montage without a recording

`edit.new` `{ "project": "acme", "name": "Launch teaser", "aspect": "9:16",
"duration": 20, "background": "#0f1115" }` starts from a blank frame: one
card of `duration` seconds, no screen recording. It returns `video`, the
`.edit.json` path every other command takes (`edit.addText`, `edit.addBlock`,
`edit.addComposition`, `edit.addMedia`, `edit.animate`, `edit.setFilm`,
`edit.stills`, `edit.preview`, `export.video`, `edit.versions`). The editor
opens on it.

- The main track holds `slide` cards only: a `recording` clip is refused
  (`rejected` says so). There are no zooms, device layers or taps; `edit.get`
  returns `recording: false`.
- The montage ends with its last card or its last layer or sound, whichever
  is later: a text placed at 18 s for 6 s on a 20 s card makes a 24 s video.
- `edit.rebuild`, `edit.alignToVoice`, `edit.propose` and the mic in
  `edit.cleanSilences` need a take and say so. Build the film with cards
  (`edit.save` with `slide` clips), texts, blocks, compositions and media.

## Reading

```json
{ "video": "/Users/me/Movies/goScreen/Projects/acme/take.mp4" }
```

`edit.get` → `{ edit, scenes, taps }`. In `edit`: `clips` (the main track:
`recording` clips with `in`/`out` in source seconds and `speed`, or `slide`
cards with `duration`), `overlays` (text, image, video, shape, blur; `start`
and `duration` in timeline seconds, `lane` ≥ 0), `audio`, `assets`, `zooms`
(source seconds, `scale`, `focus`), `touch`, `cursor`, `background`,
`screen`, `film` (`settings`, `locale`). Timeline time = clips played back to
back; zooms and taps follow the clips.

## The film as a whole: `edit.setFilm`

Pass only the fields to change; the rest stays. Only what came from the
scenes is rewritten (`intro`, `outro`, `scene-N`, `caption-N`, `kicker-N`);
hand-made layers stay.

```json
{
  "video": "…/take.mp4",
  "film": {
    "aspect": "9:16",
    "screen": "premium",
    "backdrop": "circles",
    "zoom": 1.15,
    "background": "#121a24",
    "ink": "#f3f6fa",
    "accent": "#4cc2ff",
    "font": "Inter",
    "captions": "top",
    "label": "Buyer",
    "brand": "Acme",
    "intro": { "title": "Stop *chasing* invoices", "subtitle": "", "duration": 1.6 },
    "outro": { "eyebrow": "acme.app", "title": "Start *free* today", "subtitle": "No card needed", "duration": 2.4 }
  }
}
```

- `look`: `showcase` (device under a kicker and title, accent disc, brand
  cards) or `plain` (one centred caption). `captions`: `top`, `bottom`,
  `none` (kept, transparent).
- A video that is not a film yet becomes one: its first and last cards become
  intro and outro, texts starting with a clip become scene titles.
- `edit.rebuild` builds the montage again from the take's scenes with a full
  `film` (same fields) and `locale`.
- `export.variants` with `formats: ["9:16", "16:9", "1:1", "4:5"]` lays the
  film out per format and exports each, without touching the open montage.

## Text: `edit.addText`, `edit.animate`

```json
{
  "video": "…/take.mp4",
  "text": "*3 days* faster",
  "start": 8.2,
  "duration": 3,
  "x": 0.5,
  "y": 0.14,
  "width": 0.86,
  "size": 0.05,
  "color": "#f3f6fa",
  "weight": 800,
  "preset": "words-up"
}
```

Returns `{ overlay: "ai-text-…" }`. Then `edit.animate` with that id:

- `preset`: text animators `words-up`, `blur-in`, `lines-slide`, `typewriter`,
  `center-out`, `flicker`, `words-spring` (entrances only); motion
  `drop-in`, `zoom-in`, `spin-in`, `slow-zoom`, `float`, `blur-reveal`.
  `pulse`, `shake` and `letters-pop` overshoot: not on UI (`rules.md`).
  `animation.presets` lists them with descriptions.
- `keyframes` per property, `t` in seconds from the overlay's start, each
  key's `ease` leads to the next: `linear`, `hold`, `in`, `out`, `in-out`,
  `back`, `elastic`, `spring`, or `{ "bezier": [x1, y1, x2, y2] }`.

```json
{
  "video": "…/take.mp4",
  "overlay": "ai-text-k3f",
  "keyframes": {
    "y": [{ "t": 0, "value": 0.17, "ease": { "bezier": [0.16, 1, 0.3, 1] } }, { "t": 0.45, "value": 0.14, "ease": "hold" }],
    "opacity": [{ "t": 0, "value": 0, "ease": "out" }, { "t": 0.35, "value": 1, "ease": "hold" }, { "t": 2.7, "value": 1, "ease": "out" }, { "t": 3, "value": 0, "ease": "hold" }]
  }
}
```

- `animator` (text only): `{ "unit": "word", "order": "forward", "stagger":
  0.06, "duration": 0.5, "ease": "out", "from": { "opacity": 0, "dx": 0,
  "dy": 0.4, "scale": 1, "rotation": 0, "blur": 0 }, "exit": false }`.
- `clear: true` removes keyframes and animator first.
- Styling beyond `edit.addText` (accent word, flash, sweep, glow ≤ 0.12,
  shadow, alignment, background plate, tracking) goes through `edit.save` on
  the overlay's `style`: `{ "accent": "#4cc2ff", "flash": true, "sweep":
  true, "glow": 0.1, "align": "left" }`.

## Blocks: `blocks.list`, `edit.addBlock`, `edit.updateBlock`

Blocks are HTML compositions rendered to a video layer; colours default to
the film's. Ids: `kinetic-title`, `lower-third`, `stat-counter`,
`bar-chart`, `line-chart`, `progress-ring`, `checklist`, `steps`,
`cta-button`, `quote`, `highlight`, `logo-reveal`, `wordmark`, `chips`,
`prompt-input`, `chat-bubbles`, `toast`, `cards-row`. `blocks.list` gives
each block's props, default box and duration.

```json
{
  "video": "…/take.mp4",
  "block": "stat-counter",
  "props": { "value": 2184, "suffix": " trays", "label": "available today" },
  "start": 12.5,
  "duration": 3,
  "x": 0.5,
  "y": 0.5,
  "width": 0.7,
  "height": 0.3
}
```

Returns `{ overlay }`. `edit.updateBlock` with `overlay` and new `props`
renders it again in place. Rendering takes a few seconds per block.
Use: a spoken number → `stat-counter`; a command → `prompt-input`; a tool →
`wordmark`; a developed idea → `bar-chart`, `line-chart`, `checklist`,
`steps`; the end → `cta-button` (`label`, `url`).

## Media and sound

- `edit.addMedia`: `{ "video", "file": "/abs/path/logo.png", "start": 2,
  "duration": 3, "x": 0.5, "y": 0.3, "width": 0.3 }`. An image or video goes
  on a free layer, a sound on a free audio track (`volume`). Returns the
  asset and item ids.
- `edit.cleanSilences`: `{ "video", "mode": "trim" }` cuts the wait at both
  ends of every voice; `"strip"` cuts every pause longer than `minSilence`.
  Pieces keep their time, so the voice stays in sync.
- `edit.alignToVoice`: `{ "video" }` (or `clip`) gives each scene the length
  of its phrase; scene changes land on the attack of each sentence.
- The person records a voice-over in the editor (mic button on an audio
  track): suggest it, do not wait for it.
- `sound.styles` lists the six generated beds (calm, warm, pulse, rise,
  focus, bright) and the effects. `sound.music`: `{ "video", "tone":
  "playful" }` or `{ "video", "style": "rise", "seed": 3, "payoff": 6.5 }`
  renders a bed for the whole montage (synthesised in code: nothing to
  license, the same file for the same inputs) and lays it on a free track at
  `volume` 0.28, ducked under the voice, ending on the last spoken word when
  the take has words. Returns the clip and `offset` (where in the bed the
  film starts, so its full section lands on the payoff).
- `edit.addSfx`: `{ "video", "kind": "pop", "level": "soft", "t": 4.2 }`
  (kinds: tap, pop, thud, tick, riser, whoosh, swish, click, sparkle, impact,
  drop, blip); the answer carries `count` and a `warning` past the film's
  density.
- `edit.soundDesign`: `{ "video", "density": "full", "seed": 1 }` lays a
  synthesised effect on every movement of the montage (entrances, exits,
  pops, zooms, transitions, clicks, counter steps, titles, cards, a riser
  and a drop into the last card); `"sparse"` keeps cards, clicks and the
  payoff; `"none"` removes them. Clips `sfx-auto-*` are replaced on each
  pass; the answer lists the `cues` (`t`, `kind`, `level`, `gain`, `on`,
  `item`). `edit.setFilm { "film": { "sound": "full" } }` does the same and
  keeps the choice in the film.
- `edit.snapToBeats`: `{ "video", "tolerance": 0.25 }` moves cards (their
  end), layers and zooms onto the nearest beat of the laid generated bed;
  returns `tempo`, `beats` and the `moves`. Needs `sound.music` first (the
  bed carries its tempo in `AudioClip.music`).
- A sound's `duck` (default true for anything that is not a voice) lowers it
  by 20 dB while a voice speaks; set `"duck": false` through `edit.save` for
  a sound that must stay (a product's own audio).
- `edit.captions`: `{ "video" }` (or `from`/`to`, `style.accent`) reads
  `<stem>.words.json` (`edit.transcribe` writes it) and replaces the
  captions `caption-word-*`: text overlays with `words` timed from their
  start, drawn word by word. `edit.subtitles`: `{ "video" }` writes
  `<stem>.srt`. Without a transcription both say to run `edit.transcribe`.
- `export.video` returns `loudness` (`integrated` LUFS, `truePeak` dBTP) of
  the master, normalised to -14 / -1 by default; `sound.measure`
  `{ "file" }` measures any file.

## Talking head: `edit.transcribe`, `edit.pickTakes`, `edit.tightCut`, `edit.syncMap`, `edit.faceZooms`, `edit.qc`

The order and the rules are in `workflow.md` ("Talking head"). The shapes:

- `edit.transcribe`: `{ "video", "model": "base" }` (`"small"` for a better
  ear, `"language": "fr"` to skip detection). Returns `{ language, words,
  snapped }`; writes `<stem>.words.json` (`{ text, start, end, p }`, source
  seconds) and `<stem>.envelope.json`.
- `edit.pickTakes`: `{ "video" }` returns `{ applied: false, script, lines,
  stats }` for the person to agree on; `{ "video", "script": ["Hello, this is
  goScreen.", "It films any site."] }` applies: one clip per line in script
  order, `takes.md` next to the take, `stats: { rawSeconds, keptSeconds,
  takesRemoved, restartsRemoved, linesMissing }`. Each line says which take
  was kept and why (last clean take; a stutter, a cut word or a flat voice
  rejects one).
- `edit.tightCut`: `{ "video", "minPause": 0.15 }` returns `{ pausesCut,
  removedSeconds, clips }`.
- `edit.syncMap`: `{ "video", "entries": [ { "word": "zoom", "nth": 2,
  "effect": { "kind": "zoom", "scale": 1.3, "duration": 1.5 } }, { "word":
  "three reasons", "effect": { "kind": "text", "text": "3 reasons" } },
  { "word": "now", "effect": { "kind": "cut" } }, { "word": "boom", "effect":
  { "kind": "sfx", "asset": "<audio asset id>" } }, { "word": "here", "nth":
  -1, "effect": { "kind": "retime", "overlay": "<layer id>" } } ] }`. Returns
  `{ placed, missing, skipped }`; a layer placed this way carries `syncWord`.
- `edit.faceZooms`: `{ "video" }` returns `{ zooms, clips, faces }`.
- `edit.qc`: `{ "video", "loop": false }` returns `{ pass, checks: [{ id,
  label, pass, detail }], stats }` and writes `<stem>.qc.md`. Checks: sync,
  face, safe-zone, mid-word, loop, frozen.

## Inspirations

- `inspiration.sync` once, then `inspiration.search` (`text`, `category`,
  `genres`, `techniques`, `aspect`, `recipe`), `inspiration.brief` (`slug`).
- `inspiration.apply` (`video`, `slug`) sets the film's format, colours and
  font from the prompt and keeps the credit; `inspiration.kit` lists the
  blocks the prompt shows with its copy; `inspiration.addElements` with
  `pick` and `props` by index places them. The kit's copy is about the
  creator's product: rewrite every text and number for the person's product
  first.

## From a site, with no brief

`edit.propose` `{ "video", "list": true }` returns eight proposals (recipe,
format, reasons) read from the site behind the take; `{ "video", "pick": 0,
"objective": "launch", "channels": ["instagram-reel"], "tone": "premium",
"cta": "Start free" }` applies one. Then polish.

## Looking

- `edit.frame` `{ "video", "t": 4.3, "width": 960 }` returns a JPEG of that
  frame drawn by the export renderer. A stills sheet is `edit.frame` at t =
  0.1, each scene start + 0.3 and each scene middle.
- `export.video` `{ "video", "resolution": "1080", "fps": 30 }` only when the
  person asks; `export.cancel` stops it.

## Writing the whole edit: `edit.save`

For changes no command covers (styles, transitions, zooms, touch, cursor,
background, screen look). `edit.get` first, change the object, send it back
whole; it is validated field by field. Useful fields:

- clip `transition`: `{ "kind": "push" | "blur" | "fade" | "dip" |
  "slide-left" | "slide-up" | "zoom" | "wipe", "duration": 0.4 }`.
- `zooms[]`: `{ "id", "start", "end" (source s), "scale": 1.15, "focus": {
  "x": 0.5, "y": 0.4 } }`.
- `touch`: `{ "style": "ripple", "color": accent, "size": 44, "spotlight":
  0.5 }`; `cursor`: `{ "visible": false, "size": 28 }`; `sound`: `{
  "clicks": false, "volume": 0.6 }`.
- `background`: `{ "kind": "color", "value" }`, `{ "kind": "gradient",
  "from", "to", "angle" }` or `{ "kind": "mesh", "style": "circles" | "blob"
  | "waves", "base", "colors": [...], "speed": 1, "blur": 0.32, "grain":
  0.06, "vignette": 0.25 }`, each with optional `decor` discs.
- `screen` (premium look): `{ "plate": 0.035, "outline": 3, "sweep": true,
  "tilt": { "x": 8, "y": -10 }, "drift": 3, "depth": 0.25, "entrance":
  true }`; flat: all zero and false.
- shape overlay: `{ "kind": "shape", "shape": "rect" | "ellipse" | "arrow" |
  "highlight", "color", "stroke": 0.008, ... }`; blur overlay: `{ "kind":
  "blur", "mode": "blur" | "pixelate", "strength": 0.02, "radius": 0.01 }`.

The reference montages in `references/` show these fields assembled.

## If available: the dynamic look

Commands and ids developed alongside this skill. Use them when
`control.catalog` lists them (and `help.formats` the transitions and
backdrops); never depend on them. The reference
`references/dynamic-16x9.edit.json` shows them assembled.

- **Scenes** are compositions embedded in the app, placed with
  `edit.addComposition` by id. Ids and their props: `glow-stage` (`title`,
  `brand`: the hook on the beam), `device-3d` (`screen`: the name of an image
  or video asset of the montage, `tilt`), `floating-cards` (`a`, `b`, `c`:
  three benefits), `cards-stack-3d` (`a`, `b`, `c`), `icon-grid-3d`
  (`labels`), `carousel-3d` (`a`, `b`, `c`), `kinetic-counter` (`from`,
  `to`, `suffix`, `label`), `text-inline-icon` (`before`, `after`),
  `brand-blur` (`brand`), `orbit-updates` (`title`, `subtitle`),
  `chat-typing` (`question`, `answer`), `search-focus` (`placeholder`,
  `query`), `cursor-click` (`label`). Colours default to the film's.

```json
{
  "video": "…/take.mp4",
  "composition": "chat-typing",
  "props": { "question": "How do I connect Notion?", "answer": "Paste the link. Done in *one* click." },
  "start": 6.5,
  "duration": 3
}
```

- **A scene laid out before it is rendered** (what `edit.propose` writes for
  `dynamic-launch` and `dynamic-teaser`): a `video` overlay whose
  `source.composition` names the scene and whose `asset` is
  `"composition:<overlay id>"`, an id that is in no `assets` entry. The app
  renders it when the montage opens (or `edit.addComposition` with the same
  id, props, start and box does it by hand) and replaces `asset` with the
  rendered file. `screen: "recording"` with `screenAt` (source seconds) on
  `device-3d` means "a frame of the take at that time".

```json
{
  "id": "dynamic-launch-scene-1",
  "kind": "video",
  "lane": 1,
  "start": 1.5,
  "duration": 3,
  "x": 0.5, "y": 0.5, "width": 1, "height": 1,
  "rotation": 0, "opacity": 1, "enter": "none", "exit": "none", "motion": 0.4,
  "asset": "composition:dynamic-launch-scene-1",
  "in": 0, "volume": 0, "radius": 0,
  "source": { "composition": "device-3d", "props": { "screen": "recording", "screenAt": 2, "tilt": 12 } }
}
```

- **Pop-out**: a rectangle of the take becomes a floating 3D layer.

```json
{ "video": "…/take.mp4", "t": 9.2, "rect": { "u": 0.55, "v": 0.3, "w": 0.4, "h": 0.22 }, "duration": 2.5, "lift": 0.08 }
```

- **Transition `zoomThrough`** on a clip (`edit.save`): `{ "kind":
  "zoomThrough", "duration": 0.5 }`; the camera goes through the outgoing
  frame into the next. `push` when the catalogue does not list it.
- **Backdrops `beam` and `ring`** (`edit.setFilm { "backdrop": "beam" }` or
  `background: { "kind": "mesh", "style": "beam", ... }`): the brand hue as
  a light from the top edge, or an arc behind the product. `circles`
  otherwise.
- **Energy**: `edit.energize { "video", "every": 2 }` adds the permanent
  camera drift and a pop-out or move in every `every` seconds window that
  has none.
- **Sound design**: `edit.soundDesign { "video", "density": "full" }` (a
  tick or hit on every entrance; `"sparse"` for the four biggest) and
  `film.sound: "full" | "sparse" | "none"` through `edit.setFilm`.
  `edit.snapToBeats { "video" }` moves scene and card starts onto the beats
  of the music bed (`sound.music` first).

## Compositions: HTML pages written by you

6. **Polish**: `edit_get`, then `edit_save` (captions, cards, zooms, speed of
long clips, music already imported by the person), or `edit_rebuild` with
other film settings. `app_show` the editor so the person can review.
Animate text and overlays the After Effects way: `animation_presets` lists
one-click animations (letters, words, lines; drop, zoom, pulse...);
`edit_addText` adds a title with a preset, `edit_animate` applies a preset
or writes keyframes (`{x,y,scale,rotation,opacity,blur}: [{t,value,ease}]`,
eases `linear|hold|in|out|in-out|back|elastic|spring|{bezier}`) or a text
animator. One animated element per scene is plenty.
Motion-design blocks (`blocks_list`): kinetic title, lower third, stat
counter, bar chart, checklist, call to action, steps, quote, highlighted
sentence, logo card. `edit_addBlock` renders one at a time and box you
choose (colours follow the film), `edit_updateBlock` changes its props. A
good VSL opens on a kinetic title or logo card, uses a counter or chart for
proof, and ends on a call to action.
When no block fits, write a **composition**: your own HTML page rendered
frame by frame as a layer (`compositions_list`, `compositions_preview`,
`edit_addComposition`, `edit_updateComposition`, `compositions_save`).
The contract: `{ id, label, box: {width, height} px, duration, transparent,
props: [{name, label, type text|longtext|color|number, default}], html }`.
The page is self-contained (no network: inline fonts and pictures as
`data:` URLs, under 256 KB) and deterministic: props arrive as
`window.__props` and as `{{name}}` in the HTML (escaped); it animates with
CSS/WAAPI, or defines `window.setT(t)` (seconds) and draws that exact
frame; `window.random(seed)` instead of `Math.random`; no timers or
`requestAnimationFrame` (the renderer seeks). `window.__size` and
`window.__duration` are set. Always `compositions_preview` a frame or two
before placing it; same input renders once (cached), so iterating is cheap.
The layer keeps the page with the video: the person can edit its HTML.
Prefer a block for the common elements; a composition for a layout,
a chart or an effect the catalogue does not have.

## Scenes: built-in dynamic compositions

`compositions_list` also lists 13 built-in **scenes** (`from: "scene"`), in
the look of modern SaaS ads: CSS 3D, drawn by `setT(t)` (every frame exact),
expo-out curves, a slow permanent drift, a small glow on everything. Add one
with `edit_addComposition` and its **id** as `composition`; it fills the
frame of the montage's format (16:9, 9:16, 1:1, 4:5), so give no box. Colours
(`accent`, `ink`, `background`) default to the film's; texts are props. A
scene that shows a screen takes `screen` = the file name of a montage asset
(`edit_get` → `assets[].file`, png/jpg/webp/mp4/webm; a composition's own
`.mov` cannot be a screen); without one it draws a mock interface. Preview
with `compositions_preview` before placing. Two are opaque plates
(`glow-stage`, `brand-blur`); the others are transparent, to lay over a
capture or over `glow-stage`.

| id | use it for | main props |
|---|---|---|
| `glow-stage` | the plate under a whole sequence: dark gradient, beam or ring | `variant` beam/ring, `intensity` |
| `device-3d` | the product reveal: window/tablet/phone rises, turns, straightens | `screen`, `kind`, `frame` |
| `floating-cards` | three results that come out of the screen | `screen`, `card1..3` "Label\|Value" or a picture name |
| `cards-stack-3d` | four features deployed one by one | `card1..4` "Title\|Subtitle" |
| `icon-grid-3d` | integrations / capabilities flying into a grid | `items` "A,B,C…", `cols` |
| `carousel-3d` | 3-5 modules turning on a ring | `card1..5` |
| `kinetic-counter` | a number that grows while its label changes | `from`, `to`, `suffix`, `labels` "Not\|Off\|But", `caption` |
| `text-inline-icon` | one sentence, words rising, a pill inline | `text`, `icon`, `iconAfter` |
| `brand-blur` | hero: giant blurred brand name behind a device | `brand`, `screen`, `kind` |
| `orbit-updates` | "what's new": ring, title, orbiting pills | `title`, `subtitle`, `items` |
| `chat-typing` | an assistant conversation in a tilted glass panel | `m1..m4` |
| `search-focus` | a field that zooms, types, is clicked, then selected | `placeholder`, `query`, `button` |
| `cursor-click` | a mimed click over a capture | `fromX/Y`, `toX/Y` (0-1), `clickAt`, `size` |

One example per scene (`video` omitted):

```json
{ "composition": "glow-stage", "start": 0, "duration": 12, "props": { "variant": "beam" } }
{ "composition": "device-3d", "start": 0.5, "props": { "screen": "shot-dashboard.png", "kind": "window" } }
{ "composition": "floating-cards", "start": 6, "props": { "screen": "take-hero.mp4", "card1": "Revenue|+24%", "card2": "Signups|1,284", "card3": "Latency|38 ms" } }
{ "composition": "cards-stack-3d", "start": 12, "props": { "card1": "Plan|Weekly goals", "card2": "Write|Drafts in your voice", "card3": "Review|One click", "card4": "Ship|Everywhere" } }
{ "composition": "icon-grid-3d", "start": 17, "props": { "items": "S,N,G,J,F,L,A,T,H,Z,M,D", "cols": 4 } }
{ "composition": "carousel-3d", "start": 22, "props": { "card1": "Inbox|Zero by noon", "card2": "Calendar|What matters", "card3": "Notes|Searchable", "card4": "Reports|Monday-ready" } }
{ "composition": "kinetic-counter", "start": 30, "props": { "from": 15, "to": 40, "suffix": "%", "labels": "Not|Off|But", "caption": "faster onboarding" } }
{ "composition": "text-inline-icon", "start": 35, "props": { "text": "Ship updates your users notice", "icon": "→", "iconAfter": 2 } }
{ "composition": "brand-blur", "start": 40, "props": { "brand": "ACME", "screen": "shot-home.png" } }
{ "composition": "orbit-updates", "start": 46, "props": { "title": "New Updates", "subtitle": "Version 2.4", "items": "AI,⌘,A,B,C,D" } }
{ "composition": "chat-typing", "start": 54, "props": { "m1": "Summarise last week's calls", "m2": "14 calls, 3 need a follow-up.", "m3": "Draft them", "m4": "Done: three drafts in your outbox." } }
{ "composition": "search-focus", "start": 61, "props": { "placeholder": "Search anything…", "query": "invoices from Q3", "button": "Search" } }
{ "composition": "cursor-click", "start": 8.2, "props": { "fromX": 0.2, "fromY": 0.8, "toX": 0.62, "toY": 0.41, "clickAt": 1.2 } }
```

`edit_updateComposition` with new `props` renders a placed scene again; the
page is kept with the video, so its HTML can be edited like any composition.
