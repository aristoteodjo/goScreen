import {
  type EditBackground,
  type EditState,
  MIC_ASSET,
  type TouchStyle,
} from "@goscreen/render-engine";
import {
  AiMagicIcon,
  Delete02Icon,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { editActions } from "./actions";
import { CameraPanel, DevicesPanel } from "./LayerPanels";
import { Section, SliderRow, useChange } from "./PanelKit";
import { ProposalsPanel } from "./ProposalsPanel";
import { ClipPanel, MusicPanel, OverlayPanel } from "./SelectionPanels";
import { useSession } from "./session";
import { type Panel, useEdit, usePlayback } from "./store";

const PANELS: { id: Panel; label: string; icon: typeof PaintBoardIcon }[] = [
  { id: "proposals", label: "Proposals", icon: AiMagicIcon },
  { id: "devices", label: "Devices", icon: SmartPhone01Icon },
  { id: "background", label: "Background", icon: PaintBoardIcon },
  { id: "touch", label: "Touch indicators", icon: TouchInteraction01Icon },
  { id: "zoom", label: "Zoom", icon: ZoomInAreaIcon },
  { id: "camera", label: "Camera", icon: WebcamIcon },
  { id: "audio", label: "Audio", icon: VolumeHighIcon },
];

/** Panels this recording has something for. */
function usePanels() {
  const layered = useSession((s) => s.layers.length > 0);
  const hasCamera = useSession((s) => s.cameraUrl !== null);
  return PANELS.filter(
    (p) => (p.id !== "devices" || layered) && (p.id !== "camera" || hasCamera),
  );
}

export function PanelRail() {
  const panel = usePlayback((s) => s.panel);
  const setPanel = usePlayback((s) => s.setPanel);
  const panels = usePanels();
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 pt-2">
      {panels.map((p) => (
        <Tooltip key={p.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={p.label}
              onClick={() => setPanel(p.id)}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
                panel === p.id && "text-violet-300",
              )}
            >
              <HugeiconsIcon icon={p.icon} size={18} strokeWidth={1.75} />
              {panel === p.id ? (
                <span className="absolute right-0.5 size-1 rounded-full bg-violet-400" />
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{p.label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

export function PanelContent() {
  const panel = usePlayback((s) => s.panel);
  return (
    <aside className="flex min-w-0 flex-1 flex-col overflow-y-auto rounded-xl border bg-card/60 p-5">
      {panel === "proposals" ? <ProposalsPanel /> : null}
      {panel === "devices" ? <DevicesPanel /> : null}
      {panel === "camera" ? <CameraPanel /> : null}
      {panel === "background" ? <BackgroundPanel /> : null}
      {panel === "touch" ? <TouchPanel /> : null}
      {panel === "zoom" ? <ZoomPanel /> : null}
      {panel === "audio" ? <AudioPanel /> : null}
      {panel === "clip" ? <ClipPanel /> : null}
      {panel === "overlay" ? <OverlayPanel /> : null}
      {panel === "music" ? <MusicPanel /> : null}
    </aside>
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
      : "transparent";

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
        </div>
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
  const taps = useSessionTaps();
  const change = useChange();
  const set = (patch: Partial<EditState["touch"]>, key?: string) =>
    change((ed) => ({ ...ed, touch: { ...ed.touch, ...patch } }), key);

  return (
    <>
      <Section
        title="Touch indicators"
        hint={
          taps > 0
            ? `${taps} tap${taps > 1 ? "s" : ""} recorded. Rings are drawn at render time, never burned into the source.`
            : "No tap recorded in this video."
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
            ? "Click the zoom track under the clip to add a zoom. Auto zooms follow the taps."
            : "Select a zoom on the timeline to edit it."
        }
      />
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
