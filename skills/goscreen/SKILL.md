---
name: goscreen
description: Make product videos (VSLs) of a real website with goScreen through its MCP tools. Use when the user asks for a VSL, a product demo video, a walkthrough or a promo video of a site or web app, or wants to drive goScreen (projects, flows, simulations, recordings, montage, export).
---

# Making a VSL with goScreen

goScreen films a real site in an emulated device: a browser plays a scripted
journey, then the montage (title cards, one clip and caption per scene, zooms
on taps, device frame) is built and can be exported to MP4. You drive it with
the `goscreen` MCP tools; the person watches in the app and can take over at
any point (every montage change you make can be undone with ⌘Z).

goScreen must be open. If a tool says it is not running, ask the person to
open it.

## The model

- **Project**: a folder for one product or client (`projects_*`).
- **VSL**: a flow in a project (`vsl_*`):
  - `start`: `url`, `device.id` (`devices_list`), `locale`, `film` (format,
    colours, font, captions top/bottom/none, zoom, `intro`/`outro` cards),
    `vars` (values asked to the person, e.g. phone numbers), `mask` (regexes
    of text hidden before it is drawn, e.g. test codes).
  - `nodes`: `scene` (filmed; its `caption` is shown on the video),
    `offcamera` (played, cut out: logins, waiting), `session` (another
    account with its own cookies, `session: "seller"`).
  - `edges`: `{ id, source, target }`; `source` may be `"start"`.
  - Every path from start to a last node is a **journey**; a branch is a
    variant. Recording several journeys plays them back to back, each in
    fresh sessions.
- **Steps** of a node: `goto`, `tap` (`repeat`), `type` (`text`, `clear`; no
  target = keyboard), `press`, `check`, `scroll` (`by` px or `to` a target),
  `wait` (`ms`), `waitFor`, `waitUrl` (regex), `remember` (`name`, from a
  target's text or the URL, `match` keeps the first group). Read
  `help_formats` once for the exact schemas.
- **Targets**: exactly one of `css`, `text`, `role` (+ `name`), `label`,
  `placeholder`, `testId`; refine with `hasText`, `nth` (-1 = last), `frame`
  (CSS of an iframe, e.g. payment widgets). **Use the targets `site_inspect`
  returns**: they were checked against the live page.
- `{{name}}` in a text or URL is a value: declared in `start.vars` (the
  person fills it with `vsl_setValues` or in the app), or set by a
  `remember` step. `{{code}}` types the last code shown in a masked block.

## Workflow

1. **Understand the site.** `site_inspect` the start URL (with
   `screenshot: true` if you can see images). Read headings, text and
   elements. For pages deep in a journey, inspect a VSL node instead
   (`project`, `vsl`, `node`): you get the page as it is after the journey
   up to that node.
2. **Agree on the story with the person** before acting on a real site:
   audience, journeys (buyer, seller...), length (30 to 90 s), format (9:16
   for phones and social, 16:9 for web), test accounts and values. Offer
   choices; do not decide alone what they care about.
3. **Create**: `projects_create` (or reuse one), `vsl_create` with the start
   URL and device, then `vsl_save` the full flow: one scene per idea, a short
   caption (3 to 7 words, the benefit, in the site's language), 2 to 6 steps
   per scene, waits so a viewer can read (800 to 2500 ms), off-camera nodes
   for logins and loading.
4. **Check**: `app_show` the flow so the person sees it, `tasks_simulate`,
   then `tasks_wait` each task. A failure names the step and the node: inspect
   that node (`site_inspect` with `node`) and fix the target or add a wait.
   Repeat until every journey passes. Simulations act on the real site (real
   orders on a test environment): say so first.
5. **Record**: `tasks_record` (the chosen journeys), `tasks_wait`. The result
   is a video with its montage.
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
   Change the film as a whole with `edit_setFilm` (format, colours, font,
   captions, zoom, cards): the person's own edits stay. The default look,
   `showcase`, is the VSL layout: the device framed at 75 % of the height
   under a numbered kicker (`label`: "Buyer" gives "BUYER · 2/11") and the
   scene title, an accent disc behind it, brand cards (`brand`, card
   `eyebrow`, `*words between stars*` in the accent colour). `edit_setFilm`
   also turns any video into a film (its cards and the texts starting each
   clip are kept).
   Media the person gives you (logo, product shot, music, a voice-over
   recorded elsewhere): `edit_addMedia` with the file's absolute path. The
   person records their own voice-over in the editor (mic button on any
   audio track): suggest it, do not wait for it. Once a voice is there,
   `edit_cleanSilences` cuts its pauses (mode "strip") or only the wait at
   both ends ("trim"); pieces keep their time, so the voice stays in sync.
7. **Export**: `export_video` (1080, 30 fps by default) when the person
   agrees, or `export_variants` for several formats at once (9:16 for
   stories, 16:9 for web, 1:1 and 4:5 for feeds). The goScreen window must
   be visible while exporting; if an export "does not move", ask the person
   to bring it to the front.

## Good VSLs

- Hook in the first 3 seconds (intro card or the strongest screen), one
  benefit per scene, end on the call to action (outro card).
- Show real data moving: search results, a cart filling, a confirmation.
- Keep scenes 4 to 10 s; cut waiting (off camera) rather than speeding it.
- Never show secrets: mask codes and test banners (`mask`), use test accounts.

## Etiquette

- The person may be watching: with **Follow** on (top right of goScreen),
  each command opens its place in a tab and an orange cursor named "AI"
  shows what you change. Work in readable steps (one scene, one block at a
  time) rather than one huge `edit_save`, so they can follow.

- Destructive tools (`projects_delete`, `vsl_delete`, `tasks_simulate`,
  `tasks_record`) act on real data: confirm with the person.
- Prefer showing (`app_show`) over describing; the person can edit anything
  you made, and their edits win.
