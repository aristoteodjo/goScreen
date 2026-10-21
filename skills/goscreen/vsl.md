# Filming a site: projects, VSL flows, scenarios

A VSL is a flow played by a headless browser emulated as a device; the take
is a video whose scenes are its chapters, each with a caption. `help.formats`
gives the exact JSON schemas of flows and steps: read it once.

## The model

- **Project**: a folder for one product or client (`projects.*`). The studio
  only ever sees ids, never paths; videos are returned as absolute paths by
  `projects.videos`.
- **VSL**: a flow in a project (`vsl.*`):
  - `start`: `url`, `device.id` (`devices.list`), `locale`, `film` (see
    `editing.md`), `vars` (values asked to the person: phone numbers, names;
    `secret: true` for anything that must not be kept), `mask` (regexes of
    text hidden before it is drawn: test banners, codes).
  - `nodes`: `scene` (filmed; its `caption` is the scene title), `offcamera`
    (played, cut out: logins, waiting), `session` (another account with its
    own cookies, `session: "seller"`).
  - `edges`: `{ id, source, target }`; `source` may be `"start"`.
  - Every path from start to a last node is a **journey**; a branch is a
    variant. Recording several journeys plays them back to back in one take,
    each after the first in fresh sessions.
- **Steps** of a node: `goto`, `tap` (`repeat`), `type` (`text`, `clear`; no
  target = keyboard), `press`, `check`, `scroll` (`by` px or `to` a target),
  `wait` (`ms`), `waitFor`, `waitUrl` (regex), `remember` (`name`, from a
  target's text or the URL; `match` keeps the first group).
- **Targets**: exactly one of `css`, `text`, `role` (+ `name`), `label`,
  `placeholder`, `testId`; refine with `hasText`, `nth` (-1 = last), `frame`
  (CSS of an iframe, e.g. payment widgets). **Use the targets `site.inspect`
  returns**: they were checked against the live page. Scroll to a section
  (`to` a heading) rather than to a navigation link of the same name.
- `{{name}}` in a text or URL is a value from `start.vars` (filled with
  `vsl.setValues` or in the app) or set by a `remember` step. `{{code}}`
  types the last code shown in a masked block.

## Writing the flow

1. `site.inspect` the start URL, then each page the journey reaches (inspect
   a node: `project`, `vsl`, `node` gives the page after the journey up to
   it).
2. `projects.create` (or reuse one), `vsl.create` with the start URL and
   device, then `vsl.save` the full flow:
   - one scene per idea, in the order of `script.md`; a caption of 3 to 6
     words saying the benefit, one accent word, in the site's language;
   - 2 to 6 steps per scene; `wait` 800 to 2500 ms where a viewer needs to
     read or see a result appear; off-camera nodes for logins and loading;
   - a scene shows an action with a result on screen (results appear, a cart
     fills, a confirmation): a scene that only scrolls a still page is a
     pasted screenshot, cut it or give it an action.
3. `app.show` the flow so the person sees it.

Example of a scene node:

```json
{
  "id": "search",
  "kind": "scene",
  "caption": "Find a producer in 2 taps",
  "steps": [
    { "do": "tap", "target": { "role": "button", "name": "Search" } },
    { "do": "type", "target": { "placeholder": "City" }, "text": "Calavi" },
    { "do": "waitFor", "target": { "text": "producers near" } },
    { "do": "wait", "ms": 1200 }
  ]
}
```

## Checking and recording

- `tasks.simulate` (one task per journey), then `tasks.wait` each. A failure
  names the step and the node: inspect that node and fix the target or add
  a wait. Repeat until every journey passes. Simulations act on the real
  site: say so first and confirm.
- `tasks.record` the chosen journeys (`journeys: [0, 2]`), `tasks.wait`. The
  result is a video with its montage (`video` in the task), already built
  by the film: cards, one clip and caption per scene, zooms on taps.
- `tasks.list`, `tasks.cancel` for the queue. One scenario runs at a time.

## Then the montage

- `edit.get` the video, run the stills check (`workflow.md`, `rules.md`),
  then polish with `editing.md`: `edit.setFilm` for the film as a whole
  (`zoom` ≤ 1.15, `screen`, `backdrop`, cards), `edit.rebuild` to start the
  montage again from the scenes with other film settings.
- Keep 4 to 10 s per scene; slow a short scene rather than stretching a
  still; `speed` up to 1.5× on a long scroll, never more.
- Live recording in the app (`Record actions on the site`) and the person's
  hand-made steps are theirs: read them, keep them.
