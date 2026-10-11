import {
  type Animation,
  type AudioClip,
  DEFAULT_TRANSITION,
  type EditBackground,
  type MainClip,
  type Overlay,
  type RecordingClip,
  type SlideClip,
  SPEEDS,
  type TextOverlay,
  TRANSITION_KINDS,
  type TransitionKind,
} from "@goscreen/render-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { editActions } from "./actions";
import { Section, SliderRow, useChange } from "./PanelKit";
import { bgCss, GRADIENTS } from "./Panels";
import { useEdit, usePlayback } from "./store";
import { SHAPES } from "./TimelineToolbar";

const ANIMATIONS: { id: Animation; label: string; text?: boolean }[] = [
  { id: "none", label: "None" },
  { id: "fade", label: "Fade" },
  { id: "slide-up", label: "Slide up" },
  { id: "slide-left", label: "Slide left" },
  { id: "pop", label: "Pop" },
  { id: "spring", label: "Spring" },
  { id: "wipe", label: "Wipe" },
  { id: "typewriter", label: "Typewriter", text: true },
  { id: "words", label: "Word by word", text: true },
];

const FONTS = [
  "Inter",
  "Georgia",
  "Menlo",
  "Helvetica Neue",
  "Avenir Next",
  "Futura",
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (v: number) => `${v.toFixed(1)}s`;

function Empty({ what }: { what: string }) {
  return (
    <Section title={what} hint="Select it on the timeline to edit it here." />
  );
}

function DeleteButton({ label }: { label: string }) {
  return (
    <Button
      variant="ghost"
      className="mt-2 text-destructive hover:text-destructive"
      onClick={() => editActions.deleteSelection()}
    >
      {label}
    </Button>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between text-xs text-muted-foreground">
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
      />
    </label>
  );
}

function AnimationSelect({
  value,
  text,
  onChange,
}: {
  value: Animation;
  text: boolean;
  onChange: (a: Animation) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Animation)}>
      <SelectTrigger className="h-8 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ANIMATIONS.filter((a) => text || !a.text).map((a) => (
          <SelectItem key={a.id} value={a.id} className="text-xs">
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// --- Main track clips ---------------------------------------------------

export function ClipPanel() {
  const selection = usePlayback((s) => s.selection);
  const clip = useEdit((s) =>
    selection?.kind === "clip"
      ? s.edit.clips.find((c) => c.id === selection.id)
      : undefined,
  );
  if (!clip) return <Empty what="Clip" />;
  return (
    <>
      {clip.kind === "recording" ? (
        <RecordingClipPanel clip={clip} />
      ) : (
        <SlidePanel clip={clip} />
      )}
      <TransitionSection clip={clip} />
    </>
  );
}

/** How the clip comes in over the previous one. The first clip has none. */
function TransitionSection({ clip }: { clip: MainClip }) {
  const first = useEdit((s) => s.edit.clips[0]?.id === clip.id);
  if (first)
    return (
      <Section
        title="Transition in"
        hint="The first clip starts the video: no transition."
      />
    );
  const t = clip.transition;
  return (
    <Section
      title="Transition in"
      hint="Plays over the start of this clip, from the last frame of the one before."
    >
      <Select
        value={t?.kind ?? "none"}
        onValueChange={(v) =>
          editActions.setTransition(
            clip.id,
            v === "none"
              ? null
              : {
                  kind: v as TransitionKind,
                  duration: t?.duration ?? DEFAULT_TRANSITION.duration,
                },
          )
        }
      >
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none" className="text-xs">
            Cut (none)
          </SelectItem>
          {TRANSITION_KINDS.map((k) => (
            <SelectItem key={k.id} value={k.id} className="text-xs">
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {t ? (
        <SliderRow
          value={t.duration}
          min={0.1}
          max={3}
          step={0.05}
          format={secs}
          onChange={(duration) =>
            editActions.setTransition(clip.id, { ...t, duration })
          }
        />
      ) : null}
    </Section>
  );
}

function useClipPatch(id: string) {
  const change = useChange();
  return <C extends MainClip>(patch: Partial<C>, key?: string) =>
    change(
      (ed) => ({
        ...ed,
        clips: ed.clips.map((c) =>
          c.id === id ? ({ ...c, ...patch } as MainClip) : c,
        ),
      }),
      key,
    );
}

function RecordingClipPanel({ clip }: { clip: RecordingClip }) {
  const set = useClipPatch(clip.id);
  return (
    <>
      <Section
        title="Recording clip"
        hint={`Source ${secs(clip.in)} → ${secs(clip.out)}. Drag its edges on the timeline to trim.`}
      />
      <Section title="Speed">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(clip.speed)}
          onValueChange={(v) =>
            v && editActions.setClipSpeed(clip.id, Number(v))
          }
          className="grid w-full grid-cols-7"
        >
          {SPEEDS.map((s) => (
            <ToggleGroupItem key={s} value={String(s)} className="text-[11px]">
              {s}×
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>
      <Section
        title="Mute"
        hint="Silences the microphone during this clip."
        aside={
          <Switch
            checked={clip.muted}
            onCheckedChange={(muted) => set({ muted })}
          />
        }
      />
      <Section
        title="Hide camera"
        hint="Keeps the webcam off screen during this clip."
        aside={
          <Switch
            checked={clip.cameraHidden}
            onCheckedChange={(cameraHidden) => set({ cameraHidden })}
          />
        }
      />
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={editActions.splitAtPlayhead}
        >
          Split
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => editActions.duplicate()}
        >
          Duplicate
        </Button>
      </div>
      <DeleteButton label="Delete clip" />
    </>
  );
}

function SlidePanel({ clip }: { clip: SlideClip }) {
  const set = useClipPatch(clip.id);
  const current = JSON.stringify(clip.background);
  return (
    <>
      <Section title="Slide">
        <Input
          value={clip.title}
          placeholder="Title"
          onChange={(e) =>
            set<SlideClip>({ title: e.target.value }, `slide-title-${clip.id}`)
          }
        />
        <Input
          value={clip.subtitle}
          placeholder="Subtitle"
          onChange={(e) =>
            set<SlideClip>({ subtitle: e.target.value }, `slide-sub-${clip.id}`)
          }
        />
      </Section>
      <Section title="Duration">
        <SliderRow
          value={clip.duration}
          min={0.5}
          max={15}
          step={0.1}
          format={secs}
          onChange={(duration) =>
            set<SlideClip>({ duration }, "slide-duration")
          }
        />
      </Section>
      <Section title="Animation">
        <AnimationSelect
          value={clip.animation}
          text
          onChange={(animation) => set<SlideClip>({ animation })}
        />
      </Section>
      <Section title="Text">
        <FontSelect
          value={clip.font}
          onChange={(font) => set<SlideClip>({ font })}
        />
        <ColorRow
          label="Color"
          value={clip.color}
          onChange={(color) => set<SlideClip>({ color }, "slide-color")}
        />
      </Section>
      <Section title="Background">
        <div className="grid grid-cols-6 gap-2">
          {GRADIENTS.map((bg: EditBackground) => (
            <button
              key={JSON.stringify(bg)}
              type="button"
              aria-label="Background preset"
              onClick={() => set<SlideClip>({ background: bg })}
              className={cn(
                "aspect-square rounded-md border border-white/10",
                JSON.stringify(bg) === current &&
                  "ring-2 ring-violet-400 ring-offset-2 ring-offset-card",
              )}
              style={{ background: bgCss(bg) }}
            />
          ))}
        </div>
      </Section>
      <DeleteButton label="Delete slide" />
    </>
  );
}

function FontSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (font: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FONTS.map((f) => (
          <SelectItem
            key={f}
            value={f}
            className="text-xs"
            style={{ fontFamily: f }}
          >
            {f}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// --- Overlays -----------------------------------------------------------

export function OverlayPanel() {
  const selection = usePlayback((s) => s.selection);
  const overlay = useEdit((s) =>
    selection?.kind === "overlay"
      ? s.edit.overlays.find((o) => o.id === selection.id)
      : undefined,
  );
  const change = useChange();
  if (!overlay) return <Empty what="Overlay" />;
  const set = (patch: Partial<Overlay>, key?: string) =>
    change(
      (ed) => ({
        ...ed,
        overlays: ed.overlays.map((o) =>
          o.id === overlay.id ? ({ ...o, ...patch } as Overlay) : o,
        ),
      }),
      key,
    );
  const isText = overlay.kind === "text";

  return (
    <>
      {overlay.kind === "text" ? (
        <TextSection overlay={overlay} set={set} />
      ) : null}
      {overlay.kind === "shape" ? (
        <Section title="Shape">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={overlay.shape}
            onValueChange={(v) => v && set({ shape: v } as Partial<Overlay>)}
            className="grid w-full grid-cols-4"
          >
            {SHAPES.map((s) => (
              <ToggleGroupItem key={s.id} value={s.id} className="text-[11px]">
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ColorRow
            label="Color"
            value={overlay.color}
            onChange={(color) =>
              set({ color } as Partial<Overlay>, "shape-color")
            }
          />
          <SliderRow
            value={overlay.stroke}
            min={0.002}
            max={0.02}
            step={0.001}
            format={(v) => `${Math.round(v * 1000)}`}
            onChange={(stroke) =>
              set({ stroke } as Partial<Overlay>, "shape-stroke")
            }
          />
        </Section>
      ) : null}
      {overlay.kind === "blur" ? (
        <Section
          title="Hide"
          hint="Drag the box over what must not be seen. Everything under it is hidden."
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={overlay.mode}
            onValueChange={(v) => v && set({ mode: v } as Partial<Overlay>)}
            className="grid w-full grid-cols-2"
          >
            <ToggleGroupItem value="blur" className="text-[11px]">
              Blur
            </ToggleGroupItem>
            <ToggleGroupItem value="pixelate" className="text-[11px]">
              Pixelate
            </ToggleGroupItem>
          </ToggleGroup>
          <SliderRow
            value={overlay.strength}
            min={0.004}
            max={0.06}
            step={0.001}
            format={(v) => `${Math.round(v * 1000)}`}
            onChange={(strength) =>
              set({ strength } as Partial<Overlay>, "blur-strength")
            }
          />
          <SliderRow
            value={overlay.radius}
            min={0}
            max={0.1}
            step={0.005}
            format={pct}
            onChange={(radius) =>
              set({ radius } as Partial<Overlay>, "blur-radius")
            }
          />
        </Section>
      ) : null}
      {overlay.kind === "image" || overlay.kind === "video" ? (
        <Section title="Corners">
          <SliderRow
            value={overlay.radius}
            min={0}
            max={0.1}
            step={0.005}
            format={pct}
            onChange={(radius) =>
              set({ radius } as Partial<Overlay>, "media-radius")
            }
          />
        </Section>
      ) : null}
      {overlay.kind === "video" ? (
        <Section title="Volume">
          <SliderRow
            value={overlay.volume}
            min={0}
            max={2}
            step={0.01}
            format={pct}
            onChange={(volume) =>
              set({ volume } as Partial<Overlay>, "media-volume")
            }
          />
        </Section>
      ) : null}

      <Section title="Enter">
        <AnimationSelect
          value={overlay.enter}
          text={isText}
          onChange={(enter) => set({ enter })}
        />
      </Section>
      <Section title="Exit">
        <AnimationSelect
          value={overlay.exit}
          text={isText}
          onChange={(exit) => set({ exit })}
        />
      </Section>
      <Section
        title="Motion length"
        hint="How long the enter and exit animations take."
      >
        <SliderRow
          value={overlay.motion}
          min={0.1}
          max={2}
          step={0.05}
          format={secs}
          onChange={(motion) => set({ motion }, "motion")}
        />
      </Section>
      <Section title="Opacity">
        <SliderRow
          value={overlay.opacity}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(opacity) => set({ opacity }, "opacity")}
        />
      </Section>
      <Section title="Rotation">
        <SliderRow
          value={overlay.rotation}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(rotation) => set({ rotation }, "rotation")}
          onReset={() => set({ rotation: 0 })}
        />
      </Section>
      <DeleteButton label="Delete overlay" />
    </>
  );
}

function TextSection({
  overlay,
  set,
}: {
  overlay: TextOverlay;
  set: (patch: Partial<Overlay>, key?: string) => void;
}) {
  const style = (patch: Partial<TextOverlay["style"]>, key?: string) =>
    set({ style: { ...overlay.style, ...patch } } as Partial<Overlay>, key);
  return (
    <>
      <Section title="Text">
        <Textarea
          value={overlay.text}
          rows={3}
          onChange={(e) =>
            set(
              { text: e.target.value } as Partial<Overlay>,
              `text-${overlay.id}`,
            )
          }
        />
        <FontSelect
          value={overlay.style.font}
          onChange={(font) => style({ font })}
        />
      </Section>
      <Section title="Size">
        <SliderRow
          value={overlay.style.size}
          min={0.02}
          max={0.2}
          step={0.002}
          format={(v) => `${Math.round(v * 1000) / 10}`}
          onChange={(size) => style({ size }, "text-size")}
        />
      </Section>
      <Section title="Style">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(overlay.style.weight)}
          onValueChange={(v) => v && style({ weight: Number(v) })}
          className="grid w-full grid-cols-3"
        >
          <ToggleGroupItem value="400" className="text-[11px]">
            Regular
          </ToggleGroupItem>
          <ToggleGroupItem value="600" className="text-[11px]">
            Semibold
          </ToggleGroupItem>
          <ToggleGroupItem value="700" className="text-[11px]">
            Bold
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={overlay.style.align}
          onValueChange={(v) =>
            v && style({ align: v as TextOverlay["style"]["align"] })
          }
          className="grid w-full grid-cols-3"
        >
          <ToggleGroupItem value="left" className="text-[11px]">
            Left
          </ToggleGroupItem>
          <ToggleGroupItem value="center" className="text-[11px]">
            Center
          </ToggleGroupItem>
          <ToggleGroupItem value="right" className="text-[11px]">
            Right
          </ToggleGroupItem>
        </ToggleGroup>
        <ColorRow
          label="Color"
          value={overlay.style.color}
          onChange={(color) => style({ color }, "text-color")}
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          Background
          <span className="flex items-center gap-2">
            {overlay.style.background ? (
              <input
                type="color"
                value={overlay.style.background}
                onChange={(e) =>
                  style({ background: e.target.value }, "text-bg")
                }
                className="h-7 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
              />
            ) : null}
            <Switch
              checked={overlay.style.background !== null}
              onCheckedChange={(on) =>
                style({ background: on ? "#000000" : null })
              }
            />
          </span>
        </div>
      </Section>
    </>
  );
}

// --- Music --------------------------------------------------------------

export function MusicPanel() {
  const selection = usePlayback((s) => s.selection);
  const clip = useEdit((s) =>
    selection?.kind === "audio"
      ? s.edit.audio.find((a) => a.id === selection.id)
      : undefined,
  );
  const name = useEdit(
    (s) => s.edit.assets.find((a) => a.id === clip?.asset)?.name,
  );
  const change = useChange();
  if (!clip) return <Empty what="Music" />;
  const set = (patch: Partial<AudioClip>, key?: string) =>
    change(
      (ed) => ({
        ...ed,
        audio: ed.audio.map((a) => (a.id === clip.id ? { ...a, ...patch } : a)),
      }),
      key,
    );
  const half = Math.max(0, clip.duration / 2);

  return (
    <>
      <Section
        title={name ?? "Music"}
        hint={`Starts at ${secs(clip.start)}, plays ${secs(clip.duration)}.`}
      />
      <Section title="Volume">
        <SliderRow
          value={clip.volume}
          min={0}
          max={2}
          step={0.01}
          format={pct}
          onChange={(volume) => set({ volume }, "music-volume")}
        />
      </Section>
      <Section title="Fade in">
        <SliderRow
          value={Math.min(clip.fadeIn, half)}
          min={0}
          max={Math.min(5, half)}
          step={0.1}
          format={secs}
          onChange={(fadeIn) => set({ fadeIn }, "fade-in")}
        />
      </Section>
      <Section title="Fade out">
        <SliderRow
          value={Math.min(clip.fadeOut, half)}
          min={0}
          max={Math.min(5, half)}
          step={0.1}
          format={secs}
          onChange={(fadeOut) => set({ fadeOut }, "fade-out")}
        />
      </Section>
      <DeleteButton label="Delete music" />
    </>
  );
}
