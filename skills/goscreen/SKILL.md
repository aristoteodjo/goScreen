---
name: goscreen
description: Make product videos with goScreen through its MCP tools (`goscreen_*`) or CLI: ads and launch films of a site or web app, VSLs filmed on a real site, proof clips, explainers with a voice, and any montage work (text, blocks, animation, film look, export). Use when the user asks for a product video, a demo, a walkthrough, a promo, a VSL, or wants to drive goScreen.
---

# goScreen

goScreen films a real site in an emulated device, then builds a montage
(cards, scene titles, zooms, clicks, blocks, animated layers, film look) that
plays live in the app and exports to MP4. You drive it with the same commands
as the buttons; the person watches and can undo any montage change (⌘Z).

goScreen must be open. If a tool says it is not running, ask the person to
open it. Tool names: `goscreen_<family>_<command>` over MCP (`edit.setFilm`
becomes `edit_setFilm`), `goscreen edit.setFilm '{...}'` on the CLI. Read
`control.catalog` when unsure of an input.

## Route

Load only what the task needs, in this order:

| Task | Read |
|---|---|
| Any job, before the first command | `workflow.md` (inspect, agree, make, check with stills, polish, export on request) |
| Anything that will be seen: montage, text, blocks, cards, look | `rules.md` (quality bar, formats, safe zones, bans, the checklist to run on every stills sheet) |
| Writing or judging what is said or shown (hook, captions, voice-over, length) | `script.md` |
| Filming a site: project, VSL flow, scenes, steps, targets, simulate, record | `vsl.md` |
| Changing a montage: `edit.*`, blocks, animation, film, inspirations, media | `editing.md` |
| Starting a montage from scratch, or checking the bar | `references/README.md`, then the matching `.edit.json` |

Two rules apply everywhere:

- **Preview first, render on request.** Look with `edit.frame` (and
  `edit.stills` if available); run `export.video` only when the person asks.
- **Never overwrite the person's work.** `edit.get` right before any
  `edit.save`; change only what you were asked to; small steps they can
  follow.

## If available

Commands developed alongside this skill. Use them when `control.catalog`
lists them; never depend on them: for talking-head takes,
`edit.transcribe`, `edit.pickTakes`, `edit.tightCut`, `edit.syncMap`,
`edit.faceZooms`, `edit.captions`, `edit.qc` (`rules.md`, "Talking-head
takes"; `workflow.md`, "Revisions and QC"). Without them, `edit.cleanSilences` plus `edit.alignToVoice` are the cut.
