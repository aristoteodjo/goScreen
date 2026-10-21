# Quality rules

You are designing a video, not a web page. In every scene, decide what the
viewer must notice first and build the frame around that one thing. Every
beat is an action, never a still: a screen being used, a number counting, a
word landing, a card sliding in. Nothing is pasted, nothing waits.

All sizes below are for goScreen's units: positions and sizes are fractions
of the frame (`x`, `y` = centre; `width`, `height`; text `style.size` = line
height as a fraction of the output height). Pixel figures are for 1080p.

## Formats and safe zones

| Format | Pixels | Keep clear | Title `size` ≥ | Secondary `size` ≥ |
|---|---|---|---|---|
| 9:16 (reels, stories, TikTok) | 1080 × 1920 | top 0.115 (220 px), bottom 0.22 (420 px), right 0.13 (140 px), sides 0.075 | 0.044 (84 px) | 0.023 (44 px) |
| 16:9 (web, YouTube) | 1920 × 1080 | sides 0.042 (80 px), top and bottom 0.093 (100 px) | 0.078 | 0.041 |
| 1:1 (feeds) | 1080 × 1080 | 0.075 all round | 0.078 | 0.041 |
| 4:5 (feeds) | 1080 × 1350 | 0.075 sides, 0.1 top and bottom | 0.062 | 0.033 |

- 30 fps. Labels 38 to 42 px, subtitles about 84 px in 9:16.
- The film's own layout already respects this (`look: "showcase"`: title at
  `y` 0.14 in 9:16, device under it, kicker above). Texts you add by hand
  must too: check `y` against the zones, not only `x`.
- One format per montage; `export.variants` re-lays out the film for the
  others. A hand-placed layer is not re-laid out: keep it inside the smallest
  common safe area, or add it per format.

## Opening

- Frame 1 already shows the promise: the hook text or the product in use.
  No empty intro, no logo alone, no brand card as the first frame. A brand
  mark comes after the hook (`wordmark`, `logo-reveal`), or at the end.
- Something changes in the first second (the card's `words` animation, a text
  entrance, a zoom starting), and something moves every 2 to 4 s after that.
- The on-screen hook: at most 6 words, one `*accented*` word, and never the
  same words as the spoken hook. The hook gets the most work of the whole
  film: two or three beats (problem, turn, promise), several layers, an
  impact on each key word (text animator, a shape, a zoom).

## Text

- At most 5 or 6 words per line on screen. One accent word per phrase
  (`*stars*`: lighter gradient of the accent, heavier, flashed and swept on
  entry). Figures are accented for you in scene titles (`starNumbers`).
- Captions follow the film (`caption-N` ids, `edit.setFilm` restyles them);
  added texts use `font` = the film's, `weight` 700 to 900, `color` = the
  film's ink, `accent` = the film's accent.
- Subtitles: 1 to 3 words at a time, on the beat of the voice.
- No redundant element: a caption that repeats the voice word for word, a
  second title saying the same thing, a logo next to the brand name.

## Motion

- Never linear. Entrances use `out` or `{ "bezier": [0.16, 1, 0.3, 1] }`
  (fast start, long settle); `spring` is for entrances only, and the spring
  must not overshoot visibly on UI. Use `hold` to park a value.
- Entrance = a rise of 0.01 to 0.05 of the frame (20 to 90 px) plus a fade,
  0.35 to 0.6 s. Exit shorter and cleaner (0.2 to 0.3 s, `fade` or `none`),
  never a spring, never a bounce.
- A movement never stops dead: let a zoom keep pushing (the camera drifts 4 %
  by itself), let a layer keep a slow `slow-zoom`-style drift, stagger
  elements by 1 or 2 frames (0.03 to 0.07 s).
- Beats are sequential, "hero then place": one thing enters, settles, then
  the next. No crossfade of two elements in the same place. Cuts land on the
  attack of the next phrase.
- Camera (`zooms`): scale 1 to 1.15 at most, about one zoom every 4 s, the
  focus on what is clicked or read. A cut is better than a bigger zoom.
- Clicks: `touch.style: "ripple"` with `spotlight` 0.4 to 0.6 on the premium
  look; `"ring"` on the framed look. Cursor hidden unless the cursor is the
  story.
- Transitions between clips: `push` (momentum) or `blur` (soft at the cut),
  0.3 to 0.5 s; `fade` 0.35 s only into and out of cards.

## Look

- Dark films use dark greys, never pure black (`#0b0f14`, `#121a24`, never
  `#000000`). One family of desaturated hues from the accent, one accent
  colour at any moment, no gradients on text or buttons, no neon.
- `backdrop: "circles" | "blob" | "waves"` (`background.kind: "mesh"`) for a
  moving background; `grain` ≤ 0.08, `vignette` ≤ 0.35. `"flat"` for a quiet
  proof clip.
- `screen: "premium"` for a product spot (frameless glass, outline, lean,
  pan-in, depth of field); `"framed"` when the device itself matters
  (phone-first product, several devices).
- Glow stays tiny: `style.glow` ≤ 0.12 (the film's default). The further an
  element is from the subject, the blurrier it may be (`blur` keyframes,
  `depth`).
- Real logos only: a logo the person gives you (`edit.addMedia`) or a
  `wordmark`/`logo-reveal` block with their brand name. Never an emoji or a
  drawn stand-in for a named tool.

## Proof and content

- A spoken number is a counter on screen (`stat-counter`); a command is a
  typed input (`prompt-input`); a named tool is its real logo; a developed
  idea is a chart or list that stays and grows (`bar-chart`, `line-chart`,
  `checklist`, `steps`) rather than a new card per point.
- Show real data moving on the recorded screen: results appearing, a cart
  filling, a confirmation. Cut waiting (off-camera nodes) rather than
  speeding it up beyond 1.5×.
- Never show secrets: `mask` codes and test banners, use test accounts.

## Sound

- Targets for the mix the person hears: -14 LUFS integrated, peaks ≤ -1 dBTP.
  Voice leads; music under it at `volume` 0.15 to 0.3 with `fadeOut` 1 to 2 s.
- 2 to 4 sound effects per film besides the music. Tap sounds
  (`sound.clicks`) count: off in a short ad, or at `volume` ≤ 0.4 under a
  voice.
- Clean a voice before cutting to it: `edit.cleanSilences` (`trim`, then
  `strip` if it drags), then `edit.alignToVoice`.

## Talking-head takes

A person speaking to the camera (a webcam take, `<stem>.camera.mp4`, or a
video the person gives you) is cut on its words. The dedicated commands
(`edit.transcribe`, `edit.pickTakes`, `edit.tightCut`, `edit.syncMap`,
`edit.faceZooms`, `edit.captions`, `edit.qc`) are planned: use them when
`control.catalog` lists them; until then, `edit.cleanSilences`,
`edit.alignToVoice`, `edit.save` on clips and zooms, and `edit.addText` do
the same work by hand.

- Transcribe first. Every cut, caption and effect is placed on a word, never
  on a guess.
- Speech-to-text runs up to 1/3 s early: snap every cut to the waveform
  onset (the silence ranges `edit.cleanSilences` measures), not to the
  transcript's time.
- The last complete take of a line wins, unless it stumbles, clips a word or
  is flatter than an earlier one. Write why in `takes.md` next to the video.
- Tight cut: pauses longer than 0.15 s go, 2-frame handles on each side,
  never a cut mid-word, a micro-fade on every cut.
- Sync map before any graphic: one line per spoken word that gets an effect,
  one effect per line, placed within 2 frames of the word.
- Something changes every 2 to 4 s (cut, zoom or graphic). Never two effects
  on one beat: two things starting within 0.2 s of each other is one too
  many.
- Zooms centre on the eyes; alternate 100 % and 120 % on every jump cut
  (115 % at most at 1080p). The zoom is the cut's cover, not a decoration.
- Captions: 2 to 4 words at a time, per-word timing, the active word in the
  accent colour, never over the face (bottom safe zone, or beside the face
  in 16:9).
- Loop when the film is announced as one: the last frame matches frame 0
  (same card or same shot, same layers).

## Banned

Pulse, bounce, elastic, overshoot (`elastic`, `back` eases; the `pulse`,
`shake`, `letters-pop` presets on UI), glow beyond 0.12, neon, text
gradients, confetti, emoji, stand-in logos, whoosh and click sounds on
entrances, crossfades in place, holds longer than 4 s, zooms above 1.15,
pure black, an opening logo, an empty first second, more than one accent
colour at a time, more than 6 words on a line, a caption that repeats the
voice, a still screenshot pasted as a scene.

## Quality bar: run on every stills sheet

Make the sheet (`edit.frame` at t = 0.1, at each scene start + 0.3 and each
scene middle; `edit.stills` if available) and answer each line. One "no" is a
fix to make before showing the person, and before any export.

1. Frame 1 shows the promise (hook or product in use); no logo, no blank.
2. The hook reads in ≤ 6 words with exactly one accent word.
3. Every line on screen is ≤ 6 words and inside the safe zone of the format.
4. Every scene has one obvious subject; nothing competes with it.
5. Something moves in every 4 s window (overlay enters or leaves, zoom, cut,
   counter, keyframes).
6. No linear ease, no overshoot, no exit springs in the keyframes
   (`edit.get` to read them).
7. Zooms ≤ 1.15, about one per 4 s, focused on what is read or clicked.
8. One accent colour per scene; dark greys, not black; glow ≤ 0.12.
9. Every spoken number has a counter; every named tool its real logo.
10. The call to action is on the last frames, short, and readable for ≥ 2 s.
11. Length is in the format's range (`script.md`) and no scene is a still.
12. Nothing the person placed was moved or rewritten without asking.
