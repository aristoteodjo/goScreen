# Dynamic look: three references, shot by shot

Read on 2026-10-21 from contact sheets (one frame every 0.5 s), FFmpeg scene
detection (`select='gt(scene,0.15)'` for soft changes, `0.3` for hard cuts)
and RMS onsets (50 ms windows, a rise of 5 dB over the two previous windows).
All three are "SaaS motion" ads: a product shown as a 3D object, never as a
flat screen recording, on a dark field lit by the brand colour.

| Reference | Format, length | Hard cuts | Soft changes | Sound onsets | Music |
|---|---|---|---|---|---|
| NeuraFlow (Zelios, `aSte18D2_YE`) | 16:9, 20.1 s | 0 | 2 (7.07, 9.13) | 12 above the bed (an earlier spectral-flux count gave 661 transients) | continuous electronic bed, swells at 4, 7, 10.7, 13.2, 16.5 |
| Doks.AI (Zelios, `jX4dLxiso6A`) | 16:9, 20.2 s | 1 (1.2) | 6 (3.3, 4.57, 7.4, 9.07, 11.53) | 39 (about 2 per second) | rhythmic bed, one hit per element |
| AfterRender (`OEnUyhHkHx4`) | 9:16, 17.0 s | 0 | 1 (8.9) | 28 (1.6 per second) | bed plus a tick on every count and move |

What they share: no still frame longer than 2 s; the camera travels through
one element to reach the next instead of cutting; every element is a 3D
object with a glow; one sound per movement; one brand hue on near-black.

## NeuraFlow (16:9, 20 s)

| Time | On screen | Movement | Sound |
|---|---|---|---|
| 0.0–1.0 | Wordmark "✦ NeuraFlow" centred, a light beam from the top edge, a glow ring behind | Wordmark fades up and scales 0.96→1; the beam breathes | music starts, soft hit at 0.1 |
| 1.0–4.0 | Title "Smart Control / Customized Dashboards" at the top; a dashboard mockup (chat "Hello, Mark / How can I help you today?") rises from below in perspective (tilt about 12°) | Mockup pans in from the bottom and settles; two cards pop out of it to the right and left (0.5 s apart), a progress ring fills; the title stays | hit at 0.75 (mockup lands), 0.95 (first card) |
| 4.0–7.0 | Giant blurred "NeuraFlow" behind the dashboard, dashboard seen from the side | Camera flies forward and around: the mockup turns, bars of a chart grow one by one, a donut chart draws | swell at 4.05 |
| 7.07–9.1 | Ring "New Updates" with icon pills in orbit | The camera dives through the dashboard into the ring (soft change, no cut); pills orbit continuously | hit at 7.1 |
| 9.13–11.5 | Prompt field "How NeuraFlow AI ca…" then a chat: user bubble, typing dots, AI answer card that grows | The field slides in, text types, the answer card expands in 0.4 s | hits at 10.7, 11.15 |
| 11.5–14.0 | Three glass cards in 3D, lit from above | Cards rise one by one (stagger 0.3 s), fan out, then turn as a carousel | hit at 13.2 |
| 14.0–15.5 | The carousel becomes the star of the logo; a magenta flare | Cards collapse into the star, the star spins and flashes | swell at 16.5 (the three hits 16.5–17.25 land the logo) |
| 15.5–20.1 | "✦ NeuraFlow / Discover NeuraFlow today" on the beam | Logo settles, the beam keeps breathing, subtitle fades in | bed fades |

Longest stretch without visible change: about 1.5 s (the closing logo, where
the beam still moves). Zero hard cuts.

## Doks.AI (16:9, 20 s)

| Time | On screen | Movement | Sound |
|---|---|---|---|
| 0.0–1.2 | "Doks.ai / AI chatbot" over a tablet in perspective; green arc glow | Tablet rises; title words land one after another | hits at 0.1, 0.25, 0.55, 0.9 |
| 1.2 (cut)–3.3 | Search pill "Search docs with AI… Ask AI"; three stacked chat cards "Doks AI Bot / AI Support Assistant"; a 3D star logo in shards | The pill zooms in; cards slide up into a stack (stagger 0.15 s); shards float | hits at 2.3, 2.6, 2.95 |
| 3.3–4.6 | Close on the "Ask AI" button, then a glowing green block (the input) | Camera pushes through the button; the block pulses once as it lands | hits at 3.35, 4.0, 4.4 |
| 4.6–7.4 | Chat: "How can I implement Doks.ai in Next.js?", typing dots, answer "Steps to implement…" with numbered lines | Question slides in, dots animate, the answer types in and the card grows | hits at 4.65 to 7.1, one per line |
| 7.4–9.1 | "Inline Style" and "Message Style": phone mockups tilted left and right, three phones at the end | Phones slide in from the sides and lean; labels appear above them | hits at 7.5, 7.75, 8.0, 8.5, 8.8 |
| 9.07–11.5 | "Connect any source / Easily bring your data" and a grid of integration icons (GitHub, Notion, Supabase, Zendesk, XML, WordPress…) | Icons pop in one by one, then the camera flies through the grid (icons pass by in 3D) | hits at 9.15 to 10.85, one per icon |
| 11.5–14.5 | The 3D star spins; "The future of your business ✦ is here" with the star inline in the sentence | Star spins and shrinks into the line; words appear in place, left to right | hits at 12.65 to 13.95 (one per word group) |
| 14.5–15.5 | "with ✦ Doks.ai" | Words replace in place with a short rise | hit at 14.75, 15.0 |
| 15.5–20.2 | "Doks.ai / Get started" on the arc glow | Logo settles; the arc glow drifts | hits at 15.35–16.85, then bed fades |

Longest stretch without visible change: about 1.8 s (closing logo).

## AfterRender (9:16, 17 s)

| Time | On screen | Movement | Sound |
|---|---|---|---|
| 0.0–1.5 | "New" then "New Year Sale" and a URL pill, on a blue gradient | Words fade up and settle; the pill rises | tick at 0.2, 0.55 |
| 1.5–4.5 | Counter "Not 15 %" → "Off 25 %" → "Not Off 29 %" → "Off 30 %" → "But Off 34 %" → "But Off 39 %" → "40 %" | The number counts up and grows; the small word before it flips with each step | a tick on every step (1.35 to 4.75) |
| 4.5–7.0 | "40 %" huge at the top, a cursor arrow, a "Redeem" button appears under a line | Camera dives down from the counter to the button; the cursor moves in from the left and clicks; the button presses | ticks at 5.35, 6.1, 6.35, 6.75 |
| 7.0–9.0 | The cursor on a blue field, then a selection frame with handles appears around nothing yet | The cursor drags; a selection box draws itself | ticks at 7.45, 8.3, 8.95 |
| 9.0–13.5 | A glass card "AfterRender / Our Services" with a numbered list 1–6 inside the selection handles | Lines type in one by one; the cursor drags a handle and the card scales; the card then slides left | tick per line (9.7 to 12.6), 13.25 |
| 13.5–17.0 | A dark phone mockup with profile rows (follower counts) and arrows between before/after rows | Rows fade in top to bottom; the phone drifts; the last rows land as the music ends | ticks at 13.9, 14.8, 15.45, 16.15 |

Longest stretch without visible change: about 1.5 s. Zero hard cuts: every
change is the camera moving (dive, slide) or an element replacing another in
place.

## Patterns to reuse

1. **Continuous movement.** Something is always travelling: the camera, a
   card, a counter, a cursor. The viewer is carried to the next element.
2. **No dry cut.** The camera goes *through* an element (a button, a grid, a
   dashboard) to reach the next one (`zoomThrough`), or the next element
   replaces the previous in place (morph). The only cut in 57 s is Doks.AI
   at 1.2 s, and it lands on the first beat of the music.
3. **The product is an object.** Mockups are tilted, lit, and have depth;
   cards come *out* of the screen; phones lean; icon grids are flown through.
   A flat screen recording never appears.
4. **Kinetic typography.** Counters (15 % → 40 %), a sentence with an icon
   inline, the brand name giant and blurred behind the product, words that
   replace each other in place.
5. **Mimed interaction.** A cursor that moves and clicks, a prompt that types,
   a chat that answers, selection handles that drag: the product is shown
   being used, even when nothing is recorded.
6. **One hue.** Near-black field (`#05070c` to `#0b1220`), one brand colour as
   a beam, an arc or a ring of light, glow on every edge; white text.
7. **One sound per movement.** Doks.AI and AfterRender place a hit or tick on
   every element entrance (about 2 per second); NeuraFlow leans on swells at
   each section. The bed is rhythmic and the sections change on its beats.
8. **Structure in 20 s.** Wordmark or hook (1–1.5 s) → product in 3D (3 s) →
   two or three features as scenes (chat, cards, grid: 2–3 s each) → a
   figure or a claim in kinetic type (2 s) → wordmark + call to action
   (3–4 s).
