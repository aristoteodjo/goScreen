import {
  buildAutoZooms,
  type EditBackground,
  type EditState,
  type MeshStyle,
  meshPreset,
  MIC_ASSET,
  type TouchStyle,
} from "@goscreen/render-engine";
import {
  AiMagicIcon,
  Delete02Icon,
  Film01Icon,
  PaintBoardIcon,
  SmartPhone01Icon,
  Target01Icon,
  TouchInteraction01Icon,
  VolumeHighIcon,
  WebcamIcon,
  ZoomInAreaIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { editActions } from "./actions";
import { FilmPanel } from "./FilmPanel";
import { PanelFrame } from "./PanelFrame";
import { CameraPanel, DevicesPanel } from "./LayerPanels";
import { Section, SliderRow, useChange } from "./PanelKit";
import { ProposalsPanel } from "./ProposalsPanel";
import { ClipPanel, MusicPanel, OverlayPanel } from "./SelectionPanels";
import { useSession } from "./session";
import { type Panel, useEdit, usePlayback } from "./store";

const PANELS: { id: Panel; label: string; icon: typeof PaintBoardIcon }[] = [
  { id: "film", label: "Film", icon: Film01Icon },
  { id: "proposals", label: "Proposals", icon: AiMagicIcon },
  { id: "devices", label: "Devices", icon: SmartPhone01Icon },
  { id: "background", label: "Background", icon: PaintBoardIcon },
  { id: "touch", label: "Cursor & clicks", icon: TouchInteraction01Icon },
  { id: "zoom", label: "Zoom", icon: ZoomInAreaIcon },
  { id: "camera", label: "Camera", icon: WebcamIcon },
  { id: "audio", label: "Audio", icon: VolumeHighIcon },
];

type Tab = "controls" | "film" | "look" | "audio" | "proposals";

const LOOK: { id: Panel; label: string; icon: typeof PaintBoardIcon }[] =
  PANELS.filter((p) =>
    ["background", "touch", "zoom", "camera", "devices"].includes(p.id),
  );

const tabOf = (panel: Panel): Tab =>
  panel === "clip" || panel === "overlay" || panel === "music"
    ? "controls"
    : panel === "film" || panel === "audio" || panel === "proposals"
      ? panel
      : "look";

/** Look panels this recording has something for. */
function useLook() {
  const layered = useSession((s) => s.layers.length > 0);
  const hasCamera = useSession((s) => s.cameraUrl !== null);
  return LOOK.filter(
    (p) => (p.id !== "devices" || layered) && (p.id !== "camera" || hasCamera),
  );
}

/**
 * The right-hand panel, After Effects / Premiere style: Effect Controls of
 * the selection, the film's settings, its look, its sound, the assistant.
 */
export function Inspector() {
  const panel = usePlayback((s) => s.panel);
  const selection = usePlayback((s) => s.selection);
  const setPanel = usePlayback((s) => s.setPanel);
  const look = useLook();
  const tab = tabOf(panel);
  const tabs: { id: Tab; label: string }[] = [
    { id: "controls", label: "Effect Controls" },
    { id: "film", label: "Film" },
    { id: "look", label: "Look" },
    { id: "audio", label: "Audio" },
    { id: "proposals", label: "Assistant" },
  ];
  const open = (t: Tab) => {
    if (t === "controls")
      setPanel(
        selection?.kind === "overlay"
          ? "overlay"
          : selection?.kind === "audio"
            ? "music"
            : "clip",
      );
    else if (t === "look")
      setPanel(look.some((l) => l.id === panel) ? panel : "background");
    else setPanel(t);
  };

  return (
    <PanelFrame ai="inspector" tabs={tabs} active={tab} onTab={open}>
      <div className="absolute inset-0 flex flex-col">
        {tab === "look" ? (
          <nav className="flex shrink-0 flex-wrap gap-1 px-3 pb-2">
            {look.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setPanel(l.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  panel === l.id && "bg-white/10 text-foreground",
                )}
              >
                <HugeiconsIcon icon={l.icon} size={13} strokeWidth={1.75} />
                {l.label}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-6">
          {tab === "controls" && !selection ? (
            <p className="pt-6 text-center text-[12px] text-muted-foreground">
              Select a clip, a layer or a sound on the timeline to see its
              controls.
            </p>
          ) : null}
          {tab === "controls" && selection?.kind === "clip" ? (
            <ClipPanel />
          ) : null}
          {tab === "controls" && selection?.kind === "overlay" ? (
            <OverlayPanel />
          ) : null}
          {tab === "controls" && selection?.kind === "audio" ? (
            <MusicPanel />
          ) : null}
          {panel === "film" ? <FilmPanel /> : null}
          {panel === "proposals" ? <ProposalsPanel /> : null}
          {panel === "devices" ? <DevicesPanel /> : null}
          {panel === "camera" ? <CameraPanel /> : null}
          {panel === "background" ? <BackgroundPanel /> : null}
          {panel === "touch" ? <TouchPanel /> : null}
          {panel === "zoom" ? <ZoomPanel /> : null}
          {panel === "audio" ? <AudioPanel /> : null}
        </div>
      </div>
    </PanelFrame>
  );
}

export const GRADIENTS: EditBackground[] = [
  { kind: "gradient", from: "#1e2a78", to: "#ff6f91", angle: 160 },
  { kind: "gradient", from: "#0f1020", to: "#5b5fc7", angle: 135 },
  { kind: "gradient", from: "#ff7a45", to: "#7a1fd6", angle: 135 },
  { kind: "gradient", from: "#0b3d91", to: "#38bdf8", angle: 150 },
  { kind: "gradient", from: "#134e4a", to: "#a7f3d0", angle: 120 },
  { kind: "gradient", from: "#f59e0b", to: "#ef4444", angle: 140 },
  { kind: "gradient", from: "#fbcfe8", to: "#a78bfa", angle: 160 },
  { kind: "gradient", from: "#111827", to: "#4b5563", angle: 180 },
  { kind: "color", value: "#f2efe9" },
  { kind: "color", value: "#ffffff" },
  { kind: "color", value: "#1b1c20" },
  { kind: "color", value: "#000000" },
];

export const bgCss = (bg: EditBackground) =>
  bg.kind === "gradient"
    ? `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`
    : bg.kind === "color"
      ? bg.value
      : bg.kind === "mesh"
        ? `radial-gradient(circle at 35% 40%, ${bg.colors[3] ?? bg.colors[0]}, ${bg.colors[0]} 45%, ${bg.base} 100%)`
        : "transparent";

// The course's cinematic backgrounds: one hue family, desaturated, moving.
const MESHES: { style: MeshStyle; accent: string; mode: "dark" | "light" }[] = [
  { style: "circles", accent: "#3b5bdb", mode: "dark" },
  { style: "blob", accent: "#2f9e44", mode: "dark" },
  { style: "waves", accent: "#e8590c", mode: "dark" },
  { style: "circles", accent: "#7048e8", mode: "light" },
];
const MESH_STYLES: { id: MeshStyle; label: string }[] = [
  { id: "circles", label: "Circles" },
  { id: "blob", label: "Blob" },
  { id: "waves", label: "Waves" },
];

/** Style, pace, grain and vignette of an animated background. */
function MeshControls({
  bg,
  onChange,
}: {
  bg: Extract<EditBackground, { kind: "mesh" }>;
  onChange: (bg: EditBackground, key?: string) => void;
}) {
  const row = (
    label: string,
    value: number,
    max: number,
    step: number,
    key: "speed" | "grain" | "vignette" | "blur",
    format: (v: number) => string,
  ) => (
    <div className="grid grid-cols-[64px_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <SliderRow
        value={value}
        min={0}
        max={max}
        step={step}
        format={format}
        onChange={(v) => onChange({ ...bg, [key]: v }, `mesh.${key}`)}
      />
    </div>
  );
  return (
    <div className="flex flex-col gap-2 pt-1">
      <ToggleGroup
        type="single"
        value={bg.style}
        onValueChange={(v) =>
          v && onChange({ ...meshPreset(v as MeshStyle, bg.colors[3] ?? bg.colors[0]), base: bg.base, colors: bg.colors })
        }
        className="w-full"
      >
        {MESH_STYLES.map((s) => (
          <ToggleGroupItem key={s.id} value={s.id} className="flex-1 text-[11px]">
            {s.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {row("Motion", bg.speed, 3, 0.1, "speed", (v) => `${v.toFixed(1)}×`)}
      {row("Softness", bg.blur, 0.3, 0.01, "blur", (v) => `${Math.round(v * 100)}`)}
      {row("Grain", bg.grain, 0.2, 0.01, "grain", (v) => `${Math.round(v * 100)}%`)}
      {row("Vignette", bg.vignette, 1, 0.05, "vignette", (v) => `${Math.round(v * 100)}%`)}
    </div>
  );
}

function BackgroundPanel() {
  const edit = useEdit((s) => s.edit);
  // Devices carry their own frame; padding and corners are for flat videos.
  const layered =
    useSession((s) => s.layers.length > 0) && edit.layers !== null;
  const change = useChange();
  const set = (patch: Partial<EditState>, key?: string) =>
    change((ed) => ({ ...ed, ...patch }), key);
  const current = JSON.stringify(edit.background);
  const framed = edit.background.kind !== "none";

  return (
    <>
      <Section
        title="Background"
        aside={
          <Switch
            checked={framed}
            onCheckedChange={(on) =>
              set({ background: on ? GRADIENTS[0] : { kind: "none" } })
            }
          />
        }
      >
        <div
          className={cn(
            "grid grid-cols-6 gap-2",
            !framed && "pointer-events-none opacity-40",
          )}
        >
          {GRADIENTS.map((bg) => (
            <button
              key={JSON.stringify(bg)}
              type="button"
              aria-label="Background preset"
              onClick={() => set({ background: bg })}
              className={cn(
                "aspect-square rounded-md border border-white/10",
                JSON.stringify(bg) === current &&
                  "ring-2 ring-violet-400 ring-offset-2 ring-offset-card",
              )}
              style={{ background: bgCss(bg) }}
            />
          ))}
          {MESHES.map((m) => {
            const bg = meshPreset(m.style, m.accent, m.mode);
            return (
              <button
                key={`${m.style}-${m.accent}`}
                type="button"
                aria-label={`Animated ${m.style} background`}
                title={`Animated: ${m.style}`}
                onClick={() => set({ background: bg })}
                className={cn(
                  "relative aspect-square rounded-md border border-white/10",
                  JSON.stringify(bg) === current &&
                    "ring-2 ring-violet-400 ring-offset-2 ring-offset-card",
                )}
                style={{ background: bgCss(bg) }}
              >
                <span className="absolute right-0.5 bottom-0.5 rounded bg-black/50 px-1 text-[9px] text-white/80">
                  ▶
                </span>
              </button>
            );
          })}
        </div>
        {edit.background.kind === "mesh" ? (
          <MeshControls
            bg={edit.background}
            onChange={(background, key) => set({ background }, key)}
          />
        ) : null}
        {framed ? (
          <label className="flex items-center justify-between text-xs text-muted-foreground">
            Custom color
            <input
              type="color"
              value={
                edit.background.kind === "color"
                  ? edit.background.value
                  : "#1b1c20"
              }
              onChange={(e) =>
                set(
                  { background: { kind: "color", value: e.target.value } },
                  "bg-color",
                )
              }
              className="h-7 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
            />
          </label>
        ) : null}
      </Section>
      {layered ? null : (
        <>
          <Section title="Padding">
            <SliderRow
              value={edit.padding}
              min={0}
              max={0.3}
              step={0.005}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(padding) => set({ padding }, "padding")}
              onReset={() => set({ padding: 0.08 })}
            />
          </Section>
          <Section title="Rounded corners">
            <SliderRow
              value={edit.radius}
              min={0}
              max={60}
              step={1}
              format={(v) => `${v}px`}
              onChange={(radius) => set({ radius }, "radius")}
              onReset={() => set({ radius: 18 })}
            />
          </Section>
        </>
      )}
      <Section title="Shadow">
        <SliderRow
          value={edit.shadow}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(shadow) => set({ shadow }, "shadow")}
          onReset={() => set({ shadow: 0.6 })}
        />
      </Section>
    </>
  );
}

const TOUCH_STYLES: { id: TouchStyle; label: string }[] = [
  { id: "ripple", label: "Ripple" },
  { id: "ring", label: "Ring" },
  { id: "solid", label: "Solid" },
  { id: "none", label: "Hidden" },
];

const TOUCH_COLORS = [
  "#ffffff",
  "#000000",
  "#8b5cf6",
  "#22d3ee",
  "#a3e635",
  "#f97316",
];

function TouchPanel() {
  const touch = useEdit((s) => s.edit.touch);
  const cursor = useEdit((s) => s.edit.cursor);
  const taps = useSessionTaps();
  const change = useChange();
  const set = (patch: Partial<EditState["touch"]>, key?: string) =>
    change((ed) => ({ ...ed, touch: { ...ed.touch, ...patch } }), key);
  const setCursor = (patch: Partial<EditState["cursor"]>, key?: string) =>
    change((ed) => ({ ...ed, cursor: { ...ed.cursor, ...patch } }), key);

  return (
    <>
      <Section
        title="Cursor"
        hint="Drawn from the recorded mouse moves, smoothed; it shrinks on each click."
      >
        <div className="flex items-center justify-between text-sm">
          <span>Show the cursor</span>
          <Switch
            checked={cursor.visible}
            onCheckedChange={(visible) => setCursor({ visible })}
          />
        </div>
        {cursor.visible ? (
          <SliderRow
            value={cursor.size}
            min={12}
            max={96}
            step={1}
            format={(v) => `${v}px`}
            onChange={(size) => setCursor({ size }, "cursor-size")}
            onReset={() => setCursor({ size: 28 })}
          />
        ) : null}
      </Section>
      <Section
        title="Click indicators"
        hint={
          taps > 0
            ? `${taps} click${taps > 1 ? "s" : ""} recorded. Rings are drawn at render time, never burned into the source.`
            : "No click recorded in this video."
        }
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={touch.style}
          onValueChange={(v) => v && set({ style: v as TouchStyle })}
          className="w-full"
        >
          {TOUCH_STYLES.map((s) => (
            <ToggleGroupItem key={s.id} value={s.id} className="flex-1">
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>
      <Section title="Color">
        <div className="flex gap-2">
          {TOUCH_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => set({ color: c })}
              className={cn(
                "size-7 rounded-full border border-white/20",
                touch.color === c &&
                  "ring-2 ring-violet-400 ring-offset-2 ring-offset-card",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </Section>
      <Section title="Size">
        <SliderRow
          value={touch.size}
          min={16}
          max={120}
          step={1}
          format={(v) => `${v}px`}
          onChange={(size) => set({ size }, "touch-size")}
          onReset={() => set({ size: 44 })}
        />
      </Section>
    </>
  );
}

function ZoomPanel() {
  const selected = usePlayback((s) => s.selectedZoom);
  const selectZoom = usePlayback((s) => s.selectZoom);
  const zoom = useEdit((s) => s.edit.zooms.find((z) => z.id === selected));
  const count = useEdit((s) => s.edit.zooms.length);
  const change = useChange();

  if (!zoom) {
    return (
      <Section
        title="Zoom"
        hint={
          count === 0
            ? "Click the zoom track under the clip to add a zoom, or let your clicks drive them."
            : "Select a zoom on the timeline to edit it."
        }
      >
        <AutoZoomButton />
      </Section>
    );
  }

  const set = (patch: Partial<typeof zoom>, key?: string) =>
    change(
      (ed) => ({
        ...ed,
        zooms: ed.zooms.map((z) => (z.id === zoom.id ? { ...z, ...patch } : z)),
      }),
      key,
    );

  return (
    <>
      <Section title="Zoom level">
        <SliderRow
          value={zoom.scale}
          min={1.1}
          max={4}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(scale) => set({ scale }, `zoom-scale-${zoom.id}`)}
          onReset={() => set({ scale: 2 })}
        />
      </Section>
      <Section
        title="Focus"
        hint={
          zoom.focus
            ? "Pinned. Click the preview to move it."
            : "Follows the taps inside this zoom. Click the preview to pin a point."
        }
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={zoom.focus ? "manual" : "auto"}
          onValueChange={(v) =>
            v &&
            set({
              focus: v === "auto" ? null : (zoom.focus ?? { x: 0.5, y: 0.5 }),
            })
          }
          className="w-full"
        >
          <ToggleGroupItem value="auto" className="flex-1">
            Auto
          </ToggleGroupItem>
          <ToggleGroupItem value="manual" className="flex-1 gap-1.5">
            <HugeiconsIcon icon={Target01Icon} size={14} strokeWidth={1.75} />
            Manual
          </ToggleGroupItem>
        </ToggleGroup>
      </Section>
      <Section
        title="Timing"
        hint={`${zoom.start.toFixed(2)}s → ${zoom.end.toFixed(2)}s. Drag the segment or its edges.`}
      >
        <Button
          variant="ghost"
          size="sm"
          className="justify-start gap-2 text-destructive"
          onClick={() => {
            change((ed) => ({
              ...ed,
              zooms: ed.zooms.filter((z) => z.id !== zoom.id),
            }));
            selectZoom(null);
          }}
        >
          <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.75} />
          Delete zoom
        </Button>
      </Section>
    </>
  );
}

function AudioPanel() {
  const sound = useEdit((s) => s.edit.sound);
  const taps = useSessionTaps();
  const change = useChange();
  const set = (patch: Partial<EditState["sound"]>, key?: string) =>
    change((ed) => ({ ...ed, sound: { ...ed.sound, ...patch } }), key);

  return (
    <>
      <Section
        title="Tap sounds"
        hint={`A soft click on each tap (${taps}). Mixed at export; the source stays silent.`}
        aside={
          <Switch
            checked={sound.clicks}
            onCheckedChange={(clicks) => set({ clicks })}
          />
        }
      />
      <Section title="Volume">
        <SliderRow
          value={sound.volume}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(volume) => set({ volume }, "volume")}
        />
      </Section>
      <MicSection />
    </>
  );
}

function MicSection() {
  const hasMic = useSession((s) => s.micUrl !== null);
  const volume = useEdit((s) => s.edit.mic.volume);
  const change = useChange();
  if (!hasMic)
    return (
      <Section
        title="Microphone"
        hint="No microphone was recorded. Pick one in the capture bar."
      />
    );
  return (
    <Section
      title="Microphone"
      hint="Your voice, recorded as its own track."
      aside={<VoiceToggle />}
    >
      <SliderRow
        value={volume}
        min={0}
        max={2}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) =>
          change((ed) => ({ ...ed, mic: { volume: v } }), "mic-volume")
        }
        onReset={() => change((ed) => ({ ...ed, mic: { volume: 1 } }))}
      />
    </Section>
  );
}

/** Replaces every zoom with one per burst of clicks; undo restores them. */
function AutoZoomButton() {
  const taps = useSessionTaps();
  const change = useChange();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={taps === 0}
      onClick={() => {
        const { pointers } = useSession.getState();
        const zooms = buildAutoZooms(pointers, usePlayback.getState().duration);
        change((ed) => ({ ...ed, zooms }));
        usePlayback.getState().selectZoom(null);
      }}
    >
      {taps === 0 ? "No click to follow" : "Auto zoom on clicks"}
    </Button>
  );
}

function useSessionTaps() {
  return useSession((s) => s.pointers.filter((p) => p.kind === "down").length);
}

function VoiceToggle() {
  const detached = useEdit((s) =>
    s.edit.audio.some((a) => a.asset === MIC_ASSET),
  );
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-[11px]"
      onClick={() =>
        detached ? editActions.reattachAudio() : editActions.detachAudio()
      }
    >
      {detached ? "Reattach" : "Detach"}
    </Button>
  );
}
