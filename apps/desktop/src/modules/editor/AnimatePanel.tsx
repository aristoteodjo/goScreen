import {
  ANIM_PROPS,
  ANIMATION_PRESETS,
  type AnimProp,
  applyPreset,
  baseValue,
  clearAnimation,
  EASE_CURVES,
  type Ease,
  type Keyframe,
  type Overlay,
  propsAt,
  setKey,
  type TextAnimator,
  valueAt,
} from "@goscreen/render-engine";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  DiamondIcon,
  StopWatchIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type PointerEvent, useRef, useState } from "react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { Section, SliderRow } from "./PanelKit";
import { player } from "./session";
import { usePlayback } from "./store";

type SetOverlay = (patch: Partial<Overlay>, key?: string) => void;

const PROP_LABEL: Record<AnimProp, string> = {
  x: "Position X",
  y: "Position Y",
  scale: "Scale",
  rotation: "Rotation",
  opacity: "Opacity",
  blur: "Blur",
};

const show = (p: AnimProp, v: number) =>
  p === "rotation"
    ? `${Math.round(v)}°`
    : p === "scale"
      ? `${Math.round(v * 100)}%`
      : p === "blur"
        ? `${(v * 100).toFixed(1)}%`
        : `${Math.round(v * 100)}%`;

const NAMED: Exclude<Ease, { bezier: unknown }>[] = [
  "linear",
  "hold",
  "in",
  "out",
  "in-out",
  "back",
  "elastic",
  "spring",
];

export function AnimatePanel({
  overlay,
  set,
}: {
  overlay: Overlay;
  set: SetOverlay;
}) {
  const replace = (next: Overlay) => set(next);
  const isText = overlay.kind === "text";
  const presets = ANIMATION_PRESETS.filter(
    (p) => p.group === "motion" || isText,
  );
  const animated =
    Object.keys(overlay.keyframes ?? {}).length > 0 ||
    (overlay.kind === "text" && !!overlay.animator);

  return (
    <>
      <Section
        title="Animation presets"
        hint="One click; every preset stays editable below."
        aside={
          animated ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={() => replace(clearAnimation(overlay))}
            >
              Clear
            </Button>
          ) : null
        }
      >
        <div className="grid grid-cols-2 gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.description}
              onClick={() => replace(applyPreset(overlay, p.id))}
              className="rounded-md border px-2 py-1.5 text-left text-[11px] hover:border-white/30 hover:bg-white/5"
            >
              <span className="block font-medium">{p.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {p.group === "text" ? "Text" : "Motion"}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {overlay.kind === "text" ? (
        <AnimatorSection
          animator={overlay.animator ?? null}
          onChange={(animator) =>
            set(
              animator
                ? { animator, enter: "none" }
                : { animator: null, enter: "fade" },
              "animator",
            )
          }
        />
      ) : null}

      <KeyframesSection overlay={overlay} set={set} />
    </>
  );
}

function EaseSelect({
  value,
  onChange,
}: {
  value: Ease;
  onChange: (e: Ease) => void;
}) {
  const current = typeof value === "object" ? "custom" : value;
  return (
    <Select
      value={current}
      onValueChange={(v) => {
        if (v === "custom") {
          const from =
            typeof value === "string" && value in EASE_CURVES
              ? EASE_CURVES[value as keyof typeof EASE_CURVES]
              : ([0.42, 0, 0.58, 1] as [number, number, number, number]);
          onChange({ bezier: [...from] as [number, number, number, number] });
        } else onChange(v as Ease);
      }}
    >
      <SelectTrigger className="h-7 text-[11px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NAMED.map((e) => (
          <SelectItem key={e} value={e}>
            {e === "in"
              ? "Ease in"
              : e === "out"
                ? "Ease out"
                : e === "in-out"
                  ? "Ease in-out"
                  : e[0].toUpperCase() + e.slice(1)}
          </SelectItem>
        ))}
        <SelectItem value="custom">Custom curve…</SelectItem>
      </SelectContent>
    </Select>
  );
}

const DEFAULT_ANIMATOR: TextAnimator = {
  unit: "word",
  order: "forward",
  stagger: 0.07,
  duration: 0.5,
  ease: "out",
  from: { opacity: 0, dx: 0, dy: 0.45, scale: 1, rotation: 0, blur: 0 },
  exit: false,
};

function AnimatorSection({
  animator,
  onChange,
}: {
  animator: TextAnimator | null;
  onChange: (a: TextAnimator | null) => void;
}) {
  if (!animator)
    return (
      <Section
        title="Text animator"
        hint="Letters, words or lines come in one after another."
      >
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => onChange(DEFAULT_ANIMATOR)}
        >
          Add a text animator
        </Button>
      </Section>
    );
  const a = animator;
  const set = (patch: Partial<TextAnimator>) => onChange({ ...a, ...patch });
  const from = (patch: Partial<TextAnimator["from"]>) =>
    set({ from: { ...a.from, ...patch } });
  return (
    <Section
      title="Text animator"
      aside={
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={() => onChange(null)}
        >
          Remove
        </Button>
      }
    >
      <ToggleGroup
        type="single"
        value={a.unit}
        onValueChange={(v) => v && set({ unit: v as TextAnimator["unit"] })}
        className="w-full"
      >
        <ToggleGroupItem value="char" className="flex-1 text-[11px]">
          Letters
        </ToggleGroupItem>
        <ToggleGroupItem value="word" className="flex-1 text-[11px]">
          Words
        </ToggleGroupItem>
        <ToggleGroupItem value="line" className="flex-1 text-[11px]">
          Lines
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={a.order}
          onValueChange={(v) => set({ order: v as TextAnimator["order"] })}
        >
          <SelectTrigger className="h-7 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="forward">First to last</SelectItem>
            <SelectItem value="reverse">Last to first</SelectItem>
            <SelectItem value="center">From the centre</SelectItem>
            <SelectItem value="random">Random</SelectItem>
          </SelectContent>
        </Select>
        <EaseSelect value={a.ease} onChange={(ease) => set({ ease })} />
      </div>
      <Labeled label="Delay between units">
        <SliderRow
          value={a.stagger}
          min={0}
          max={0.4}
          step={0.005}
          format={(v) => `${v.toFixed(3)} s`}
          onChange={(stagger) => set({ stagger })}
        />
      </Labeled>
      <Labeled label="Each unit takes">
        <SliderRow
          value={a.duration}
          min={0}
          max={2}
          step={0.01}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(duration) => set({ duration })}
        />
      </Labeled>
      <span className="text-[11px] font-medium text-muted-foreground">
        Starts from
      </span>
      <Labeled label="Opacity">
        <SliderRow
          value={a.from.opacity}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(opacity) => from({ opacity })}
        />
      </Labeled>
      <Labeled label="Offset X (in text sizes)">
        <SliderRow
          value={a.from.dx}
          min={-3}
          max={3}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(dx) => from({ dx })}
        />
      </Labeled>
      <Labeled label="Offset Y (in text sizes)">
        <SliderRow
          value={a.from.dy}
          min={-3}
          max={3}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(dy) => from({ dy })}
        />
      </Labeled>
      <Labeled label="Scale">
        <SliderRow
          value={a.from.scale}
          min={0}
          max={3}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(scale) => from({ scale })}
        />
      </Labeled>
      <Labeled label="Rotation">
        <SliderRow
          value={a.from.rotation}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(rotation) => from({ rotation })}
        />
      </Labeled>
      <Labeled label="Blur">
        <SliderRow
          value={a.from.blur}
          min={0}
          max={0.05}
          step={0.001}
          format={(v) => `${(v * 100).toFixed(1)}%`}
          onChange={(blur) => from({ blur })}
        />
      </Labeled>
      <div className="flex items-center justify-between text-[11px]">
        <label htmlFor="animator-exit">Leave the same way at the end</label>
        <Switch
          id="animator-exit"
          checked={a.exit}
          onCheckedChange={(exit) => set({ exit })}
        />
      </div>
    </Section>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function KeyframesSection({
  overlay,
  set,
}: {
  overlay: Overlay;
  set: SetOverlay;
}) {
  const time = usePlayback((s) => s.time);
  const [prop, setProp] = useState<AnimProp | null>(null);
  const local = Math.max(0, Math.min(overlay.duration, time - overlay.start));
  const inside =
    time >= overlay.start && time <= overlay.start + overlay.duration;
  const now = propsAt(overlay, time);
  const tracks = overlay.keyframes ?? {};

  const setTrack = (p: AnimProp, keys: Keyframe[] | undefined) => {
    const next = { ...tracks };
    if (keys && keys.length > 0) next[p] = keys;
    else delete next[p];
    set({ keyframes: next }, `keys-${p}`);
  };
  const addKey = (p: AnimProp) => setTrack(p, setKey(tracks[p], local, now[p]));
  const jump = (p: AnimProp, dir: 1 | -1) => {
    const keys = (tracks[p] ?? []).map((k) => k.t).sort((a, b) => a - b);
    const target =
      dir > 0
        ? keys.find((t) => t > local + 1e-3)
        : [...keys].reverse().find((t) => t < local - 1e-3);
    if (target !== undefined) player.seek(overlay.start + target);
  };

  return (
    <Section
      title="Keyframes"
      hint={
        inside
          ? "◆ records the value at the playhead. Move the playhead, change the value, record again."
          : "Move the playhead onto this overlay to record keys."
      }
    >
      <div className="flex flex-col gap-1">
        {ANIM_PROPS.map((p) => {
          const keys = tracks[p] ?? [];
          const on = keys.length > 0;
          const here = keys.some((k) => Math.abs(k.t - local) < 1 / 60);
          return (
            <div
              key={p}
              className={cn(
                "flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px]",
                prop === p && "bg-white/5",
              )}
            >
              <button
                type="button"
                title={
                  on
                    ? "Remove every key of this property"
                    : "Animate this property"
                }
                onClick={() =>
                  on ? setTrack(p, undefined) : inside && addKey(p)
                }
                className={cn(
                  "flex size-6 items-center justify-center rounded",
                  on
                    ? "text-amber-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={StopWatchIcon} size={13} />
              </button>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => setProp(prop === p ? null : p)}
              >
                {PROP_LABEL[p]}
                {on ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {keys.length}
                  </span>
                ) : null}
              </button>
              <span className="w-12 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                {show(p, now[p])}
              </span>
              {on ? (
                <>
                  <IconBtn
                    label="Previous key"
                    icon={ArrowLeft01Icon}
                    onClick={() => jump(p, -1)}
                  />
                  <IconBtn
                    label={here ? "Update the key here" : "Add a key here"}
                    icon={DiamondIcon}
                    active={here}
                    disabled={!inside}
                    onClick={() => addKey(p)}
                  />
                  <IconBtn
                    label="Next key"
                    icon={ArrowRight01Icon}
                    onClick={() => jump(p, 1)}
                  />
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {prop ? (
        <TrackEditor
          prop={prop}
          overlay={overlay}
          keys={tracks[prop] ?? []}
          local={local}
          onChange={(keys) => setTrack(prop, keys)}
        />
      ) : null}
    </Section>
  );
}

function IconBtn({
  label,
  icon,
  onClick,
  active,
  disabled,
}: {
  label: string;
  icon: typeof DiamondIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-6 items-center justify-center rounded hover:bg-white/10 disabled:opacity-40",
        active ? "text-amber-400" : "text-muted-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={12} />
    </button>
  );
}

const GW = 290;
const GH = 130;

/** Value graph of one property: keys to drag, the curve between them. */
function TrackEditor({
  prop,
  overlay,
  keys,
  local,
  onChange,
}: {
  prop: AnimProp;
  overlay: Overlay;
  keys: Keyframe[];
  local: number;
  onChange: (keys: Keyframe[]) => void;
}) {
  const [picked, setPicked] = useState(0);
  const drag = useRef<{ i: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const duration = Math.max(0.1, overlay.duration);
  const values = keys.length
    ? keys.map((k) => k.value)
    : [baseValue(overlay, prop)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.25;
  const [vMin, vMax] = [lo - pad, hi + pad];
  const xOf = (t: number) => (t / duration) * GW;
  const yOf = (v: number) => GH - ((v - vMin) / (vMax - vMin)) * GH;
  const samples = Array.from({ length: 121 }, (_, i) => {
    const t = (i / 120) * duration;
    return `${xOf(t).toFixed(1)},${yOf(valueAt(keys, t) ?? baseValue(overlay, prop)).toFixed(1)}`;
  });
  const key = keys[Math.min(picked, keys.length - 1)];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const t = Math.max(
      0,
      Math.min(duration, ((e.clientX - r.left) / r.width) * duration),
    );
    const v = vMax - ((e.clientY - r.top) / r.height) * (vMax - vMin);
    onChange(
      keys.map((k, i) =>
        i === drag.current?.i
          ? { ...k, t: Math.round(t * 100) / 100, value: v }
          : k,
      ),
    );
  };

  const patchKey = (patch: Partial<Keyframe>) =>
    onChange(keys.map((k, i) => (i === picked ? { ...k, ...patch } : k)));

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      <span className="text-[11px] font-medium">
        {PROP_LABEL[prop]} over time
      </span>
      <svg
        ref={svg}
        viewBox={`0 0 ${GW} ${GH}`}
        className="h-[130px] w-full touch-none rounded bg-black/30"
        role="img"
        aria-label={`${PROP_LABEL[prop]} graph`}
        onPointerMove={onMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
      >
        <line
          x1={xOf(local)}
          x2={xOf(local)}
          y1={0}
          y2={GH}
          stroke="rgba(244,63,94,0.7)"
          strokeWidth={1}
        />
        <polyline
          points={samples.join(" ")}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={1.5}
        />
        {keys.map((k, i) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: keys keep their order
            key={i}
            x={xOf(k.t) - 5}
            y={yOf(k.value) - 5}
            width={10}
            height={10}
            transform={`rotate(45 ${xOf(k.t)} ${yOf(k.value)})`}
            fill={i === picked ? "#fbbf24" : "#18181b"}
            stroke="#fbbf24"
            strokeWidth={1.5}
            className="cursor-grab"
            onPointerDown={(e) => {
              e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
              setPicked(i);
              drag.current = { i };
            }}
          />
        ))}
      </svg>
      {key ? (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
            <Input
              aria-label="Key time (s)"
              type="number"
              step={0.05}
              value={key.t}
              onChange={(e) =>
                patchKey({ t: Math.max(0, Number(e.target.value) || 0) })
              }
              className="h-7 text-[11px]"
            />
            <Input
              aria-label="Key value"
              type="number"
              step={prop === "rotation" ? 1 : 0.01}
              value={Number(key.value.toFixed(4))}
              onChange={(e) => patchKey({ value: Number(e.target.value) || 0 })}
              className="h-7 text-[11px]"
            />
            <IconBtn
              label="Delete this key"
              icon={Delete02Icon}
              onClick={() => {
                onChange(keys.filter((_, i) => i !== picked));
                setPicked(0);
              }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            Key {Math.min(picked, keys.length - 1) + 1} of {keys.length}: time
            (s) and value. Curve to the next key:
          </span>
          <EaseSelect
            value={key.ease}
            onChange={(ease) => patchKey({ ease })}
          />
          {typeof key.ease === "object" ? (
            <BezierEditor
              value={key.ease.bezier}
              onChange={(bezier) => patchKey({ ease: { bezier } })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const BS = 120;

/** The speed of one key's curve, with its two Bézier handles. */
function BezierEditor({
  value,
  onChange,
}: {
  value: [number, number, number, number];
  onChange: (v: [number, number, number, number]) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef<0 | 1 | null>(null);
  const [x1, y1, x2, y2] = value;
  // y spans -0.5..1.5 so overshooting curves stay on screen.
  const px = (x: number) => x * BS;
  const py = (y: number) => BS - ((y + 0.5) / 2) * BS;
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging.current === null || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(
      -0.5,
      Math.min(1.5, (1 - (e.clientY - r.top) / r.height) * 2 - 0.5),
    );
    const round = (n: number) => Math.round(n * 100) / 100;
    onChange(
      dragging.current === 0
        ? [round(x), round(y), x2, y2]
        : [x1, y1, round(x), round(y)],
    );
  };
  return (
    <div className="flex items-center gap-3">
      <svg
        ref={ref}
        viewBox={`0 0 ${BS} ${BS}`}
        className="size-[120px] shrink-0 touch-none rounded bg-black/30"
        role="img"
        aria-label="Curve handles"
        onPointerMove={move}
        onPointerUp={() => {
          dragging.current = null;
        }}
      >
        <path
          d={`M ${px(0)} ${py(0)} C ${px(x1)} ${py(y1)} ${px(x2)} ${py(y2)} ${px(1)} ${py(1)}`}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={2}
        />
        <line x1={px(0)} y1={py(0)} x2={px(x1)} y2={py(y1)} stroke="#a1a1aa" />
        <line x1={px(1)} y1={py(1)} x2={px(x2)} y2={py(y2)} stroke="#a1a1aa" />
        {[
          [x1, y1],
          [x2, y2],
        ].map(([x, y], i) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: two fixed handles
            key={i}
            cx={px(x)}
            cy={py(y)}
            r={5}
            fill="#fbbf24"
            className="cursor-grab"
            onPointerDown={(e) => {
              e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
              dragging.current = i as 0 | 1;
            }}
          />
        ))}
      </svg>
      <span className="font-mono text-[10px] text-muted-foreground">
        cubic-bezier(
        <br />
        {value.join(", ")})
      </span>
    </div>
  );
}
