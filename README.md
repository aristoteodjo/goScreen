<div align="center">

# goScreen

**Any device + any web or Android experience → a polished product video.**

goScreen is a desktop device studio. Open a website or a running Android app inside realistic device
frames, record yourself using it, then turn the take into a product video with smart zooms, touch
indicators, webcam, voice-over, music and titles, all without leaving the app.

[Download](#download) · [Features](#features) · [Quick start](#quick-start) · [Architecture](#architecture) · [Roadmap](#roadmap)

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Release](https://github.com/aristoteodjo/goScreen/actions/workflows/release.yml/badge.svg)](https://github.com/aristoteodjo/goScreen/actions/workflows/release.yml)

</div>

---

## Download

Prebuilt installers for **macOS** (Apple Silicon and Intel, `.dmg`), **Windows** (`.msi` / `.exe`) and
**Linux** (`.AppImage`, `.deb`, `.rpm`) are attached to each [GitHub release](https://github.com/aristoteodjo/goScreen/releases).
goScreen is free and open source (MIT); it needs no account and no server.

FFmpeg must be installed (`brew install ffmpeg`, `winget install ffmpeg`, `apt install ffmpeg`). The builds are
not signed yet: on macOS, right-click the app and choose **Open** the first time.

## Why goScreen

Product videos usually take three tools: a browser resized to look like a phone, a screen recorder, and a
video editor where you rebuild zooms and taps by hand. goScreen merges them:

- **The device frame is not baked into the video.** Only the screen ("glass") of each device is captured.
  The frame is redrawn by the editor, so you can change the model, color, size, rotation or position *after*
  recording.
- **Interactions are data, not pixels.** Taps, scrolls and navigations are logged next to the MP4, so touch
  rings, zooms and cursor stay editable.
- **Edits are non-destructive.** The source video is never modified; every effect lives in a sidecar
  `*.edit.json` with undo/redo.

## Features

### Studio
- **20 device profiles**: recent iPhones, iPads, Pixels, Galaxy phones and tablets, MacBooks, iMac,
  Windows laptop, external monitor, generic Android, each in several colors.
- **Infinite canvas** to compare devices side by side, plus a **Scene** view for the final composition
  (aspect ratio, background, shadow, rotation, perspective).
- **Live web pages in the device**: any public or local URL runs in a real, interactive page with the right
  user agent and touch support.
- **Synced devices**: navigation and scroll are mirrored across devices that share the project URL.
- **Android**: detect emulators and physical devices over ADB, stream the live screen into a device frame,
  tap, swipe and send keys from the studio.
- **Command palette**, context menus and keyboard shortcuts throughout.

### Recording
- Capture a **single device** at full resolution, the **canvas** or the **scene**.
- **Webcam and microphone** as separate tracks, with a live, draggable webcam bubble.
- **Automatic voice cleanup**: denoise, compression and loudness normalisation to -16 LUFS; the raw take is
  kept next to it.
- **Pause / resume** without restarting the capture, so audio never drifts.
- **Record devices separately**: one take, one video per device.
- **Site tour**: give a URL and goScreen visits every page (sitemap or internal links) with smooth scrolling,
  in one take.
- On macOS 15+, ScreenCaptureKit records **the goScreen window only**: notifications and other windows never
  reach the video.

### Editor
- Timeline with **split, trim, speed, mute and reordering** (ripple editing) and full-frame slides.
- **Auto-zooms** proposed from your interactions, all editable.
- **Touch rings** and synthesized tap sounds, placed in screen coordinates so they follow the device layer.
- **Overlays**: text, images, video and shapes with enter/exit animations; music tracks on separate lanes.
- **Webcam** as a corner overlay (size, shape, mirror) or split screen.
- **Blur and pixelate boxes** to hide sensitive data.
- Right-click the preview to edit what you clicked.
- **Export** to H.264 MP4 (x264, CRF 15, BT.709) with the full audio mix.

### In progress
- **Automatic product videos**: from a URL and a campaign brief (goal, audience, tone, offer, CTA, channels),
  goScreen reads the site's brand and sections and proposes 8 ready-to-edit cuts (launch, demo, vertical ad,
  explainer…). The site reader and campaign model are already in the repo; see
  [`GOSCREEN.md`](GOSCREEN.md#plan--vidéos-produit-automatiques-pilotées-par-la-campagne).

## Quick start

### Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22 | |
| pnpm | 10.x | the only supported package manager |
| Rust | stable | for the Tauri desktop app ([Tauri prerequisites](https://tauri.app/start/prerequisites/)) |
| FFmpeg | recent | looked up in `PATH`, `/opt/homebrew/bin`, `/usr/local/bin` |
| Android SDK platform-tools | optional | for Android sources (`adb`) |

### Install

```bash
git clone https://github.com/aristoteodjo/goScreen.git
cd goScreen
pnpm install
```

### Desktop studio

```bash
pnpm dev:desktop        # Vite on :1430 + Tauri window
```

On macOS, grant **Screen Recording** permission to the app that launched goScreen (your terminal in
development). If recording fails after a few seconds, goScreen tells you which app needs the permission and
opens the right System Settings panel.

Recordings are saved to `~/Movies/goScreen/`, screenshots to `~/Pictures/goScreen/`.

### Checks

```bash
pnpm check-types
pnpm test
pnpm lint
cd apps/desktop/src-tauri && cargo test
```

## Platform support

| | macOS 15+ | macOS 13–14 | Windows | Linux |
|---|---|---|---|---|
| Studio, canvas, editor | ✅ | ✅ | ✅ | ✅ |
| Recording | ScreenCaptureKit, window only | FFmpeg (main display) | FFmpeg `gdigrab` | FFmpeg `x11grab` |
| Android via ADB | ✅ | ✅ | ✅ | ✅ |

macOS is the primary development platform; Windows and Linux capture paths are less tested.

## Architecture

A pnpm monorepo. Business logic lives in pure, tested functions; Tauri commands and React components stay
thin (*functional core, imperative shell*).

```
apps/
  desktop/            Tauri 2 + Vite + React 19 + TanStack Router/Query + shadcn/ui
    src-tauri/        Rust: preview proxy, native capture, FFmpeg, ADB, export, site reader
packages/
  device-registry/    Device definitions (JSON, validated by zod) and device packs
  device-engine/      Pure geometry, orientation, safe areas, layout, styles
  content-source/     DeviceContentSource contract: where a frame's pixels come from
  android-source/     Android device model, ADB provider, gestures, profile matching
  render-engine/      Editor core: edit state, camera/zoom, touches, timeline, composeFrame
  campaign/           Campaign brief model and video proposals
```

Key design choices:

- **Web pages run in iframes behind a local proxy.** A native WebView can't be rotated, put in perspective
  or composed in the DOM; an iframe can. The Rust proxy (`127.0.0.1`, one port per origin) strips framing
  headers, rewrites cookies and redirects, and injects a small bridge that reports pointers, scrolls and
  navigations. Cross-origin API calls are relayed without cookies, and public sites can never reach
  localhost or private IP ranges (DNS rebinding included).
- **One renderer for preview and export.** `composeFrame` (pure) + a Canvas2D `drawFrame` render both, so
  what you see is what you export.
- **Devices are data.** Nothing is hard-coded: everything goes through `createRegistry([...packs])`, and a
  later pack overrides an existing id.
- **Local servers are locked down**: random 128-bit token URLs, CORS limited to the studio origin.

The full architecture document (in French) is [`GOSCREEN.md`](GOSCREEN.md). Read it before making changes.

### Adding a device

Drop a JSON file in `packages/device-registry/src/devices/<brand>/` following the zod schema in
[`schema.ts`](packages/device-registry/src/schema.ts) (viewport and DPR, bezel and radii, colors, safe area,
cutout, status bar, user agent, `tier`), import it in `builtin.ts`, and run `pnpm test`. Set `verified: true`
only once the dimensions have been checked against the manufacturer's specs.

## Roadmap

1. Automatic product videos driven by a campaign brief (site reader → recipes → 8 proposals).
2. Editor: cursor for web sources, motion blur, transitions between clips, crop, faster export.
3. Android: live drag, device audio, synchronized interactions across devices.
4. Versioned `project.json` with migrations.
5. Local HTML files, browser chrome (Safari / Chrome Android), custom status bar.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Before you open a PR:

- read [`GOSCREEN.md`](GOSCREEN.md) and follow its rules (pure logic in packages, no hard-coded devices);
- don't hand-edit generated shadcn components in `components/ui/`;
- make sure `pnpm check-types`, `pnpm test`, `pnpm lint` and `cargo test` pass.

## Security

The preview proxy is the most sensitive part of goScreen: it loads untrusted sites on `127.0.0.1`. If you
find a way for a previewed page to reach the local network, escape the iframe sandbox, or read another
origin's data, please report it privately to **oaristote@gmail.com** rather than opening a public issue.

## License

[MIT](LICENSE) © 2026 Aristote O.

Device names (iPhone, iPad, MacBook, iMac, Pixel, Galaxy…) are trademarks of their respective owners and are
used only to describe the device frames. goScreen is not affiliated with Apple, Google or Samsung.

---

<div align="center">Made by <a href="https://github.com/aristoteodjo">Aristote O.</a></div>
