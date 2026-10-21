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
