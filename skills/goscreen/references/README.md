# Reference montages: the quality bar

Four `.edit.json` files built by hand with goScreen's real vocabulary. They
are what a montage should look like when it passes `rules.md`; the evals in
`packages/skill-evals` score them green. Open the one that matches the
request, read how it is timed and layered, and match it. Do not copy its
words: every text is a placeholder for a product that does not exist.

| Request | File | Format, length | What it shows |
|---|---|---|---|
| Product ad for reels, stories, TikTok | `ad-9x16.edit.json` | 9:16, 22 s | Hook card (3 words, one accent), three 6 s scenes on the premium screen, a highlight on the clicked button, one zoom ≤ 1.15 per scene, a muted proof note, call to action card |
| Launch film for the web or YouTube | `launch-16x9.edit.json` | 16:9, 47 s | Hook, six 7 s scenes with kicker + title in the left column, device on the right, push/blur transitions, waves backdrop, a figure in two captions, call to action |
| Proof clip for feeds | `proof-1x1.edit.json` | 1:1, 19 s | Three figures as scene titles on a quiet flat look with the framed device, a source note per figure, blur transitions, call to action |
| Product ad in the dynamic look (SaaS motion: Zelios, AfterRender) | `dynamic-16x9.edit.json` | 16:9, 20 s | Wordmark and hook on a beam (`glow-stage`), the product as a 3D object (`device-3d` on a frame of the take), three shots of the take at 1.25× between scenes (`floating-cards`, `chat-typing`, `kinetic-counter`), one caption, `push` on every boundary, a music bed and 14 sound effects, call to action card. Scene layers are composition layers waiting for their render; `dynamic-analysis.md` is the shot-by-shot reading of the references |

## Opening a reference on a take

A montage needs a source video: the clips refer to source seconds of a
recording. To see a reference as it is meant, record (or reuse) a take of at
least:

- `ad-9x16`: 18 s of a phone screen (`device` = any phone, 9:16 capture),
  three actions at about 2 s, 8 s and 14 s;
- `launch-16x9`: 42 s of a laptop or desktop screen, one action every 7 s;
- `proof-1x1`: 15 s of any screen, one action per 5 s.
- `dynamic-16x9`: 8 s of a laptop screen, one action at about 1 s and 5 s.

Then write the file next to the take as `<stem>.edit.json` (or send it with
`edit.save`) and `app.show` the editor. `layers` is `null` on purpose: the
app places the recorded device by the film's layout when it knows the source
size, so the reference opens on any capture. Zooms are in source seconds:
move them to the take's real taps (`edit.get` gives `taps`; `edit.setFilm`
with `zoom` rebuilds them on the scenes' taps).

## What is not in the files

- Blocks (`stat-counter`, `cta-button`, `wordmark`…) are rendered per
  montage into its assets folder, so a static file cannot carry them. Add
  them with `edit.addBlock` after opening: the ad wants a `stat-counter` on
  its third scene and a `cta-button` on the outro; the proof clip a counter
  per figure.
- Sound: a voice-over is recorded in the editor, music comes from the person
  (`edit.addMedia`). Once there, `edit.cleanSilences` then
  `edit.alignToVoice`.

## The dynamic reference: what waits for the app

`dynamic-16x9.edit.json` is written for the "If available" vocabulary of
`editing.md`, with safe fallbacks already in place:

- Its five scene layers are `video` overlays with `source.composition`
  (`glow-stage`, `device-3d`, `floating-cards`, `chat-typing`,
  `kinetic-counter`) and a placeholder asset `composition:<id>` whose file
  is `<id>.pending`: after `edit.save`, call `edit.renderScenes` to render
  them all, or place them with `edit.addComposition` (same id, props, start
  and full-frame box).
  Without those compositions, `edit.addBlock` stands in: `wordmark`,
  `cards-row`, `chat-bubbles`, `stat-counter`.
- Transitions are `push` 0.5 s; replace them with `zoomThrough` when
  `help.formats` lists it. The backdrop is `circles` on `#070a10`; `beam`
  when available.
- The sounds are the files `sound.music` (`music-pulse-1-20s`) and
  `edit.addSfx` (`sfx-tick`, `sfx-pop`, `sfx-thud`) write: run them, or
  `edit.soundDesign { density: "full" }`, so the entries have their files.
  `film.settings.sound` is `"full"`: remove it if the film schema of the app
  does not know the field yet (`edit.setFilm` would fall back to defaults).

## Checking a reference

`node packages/skill-evals/run.mjs --score-only <file>` scores any
`.edit.json` with the mechanical rules (`dynamic: true` adds the dynamic look's lines:
`dyn-still`, `dyn-scenes`, `dyn-3d`, `dyn-cuts`, `dyn-music`, `dyn-sfx`);
`pnpm -r test` parses the four files
with `parseEditState` (`packages/render-engine/src/references.test.ts`) and
scores them (`packages/skill-evals/score.test.mjs`).
