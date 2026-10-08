import {
  type DeviceInstance,
  type RenderMode,
  SHADOW_PRESETS,
  type ShadowPresetId,
} from "@goscreen/device-engine";
import type { DeviceDefinition } from "@goscreen/device-registry";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { registry } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { BACKGROUND_PRESETS, backgroundToCss } from "../store/backgrounds";
import { useEditor } from "../store/editor";
import { useProject } from "../store/project";

export function Inspector() {
  const selectedId = useEditor((s) => s.selectedId);
  const instance = useProject((s) => s.devices.find((d) => d.id === selectedId));

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-sidebar">
      <div data-tauri-drag-region className="flex h-12 shrink-0 items-center border-b px-4">
        <h2 className="text-[13px] font-semibold">{instance ? "Device" : "Scene"}</h2>
      </div>
      {instance ? <DeviceSection instance={instance} /> : null}
      <BackgroundSection />
    </aside>
  );
}

function Row({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        {value ? <span className="font-mono text-[11px] text-foreground/80 tabular-nums">{value}</span> : null}
      </div>
      {children}
    </div>
  );
}

const RENDER_MODES: { id: RenderMode; label: string }[] = [
  { id: "flat", label: "Flat" },
  { id: "floating", label: "Floating" },
  { id: "perspective", label: "Perspective" },
];

function shadowPresetOf(instance: DeviceInstance): ShadowPresetId | "custom" {
  const match = (Object.keys(SHADOW_PRESETS) as ShadowPresetId[]).find(
    (id) => JSON.stringify(SHADOW_PRESETS[id]) === JSON.stringify(instance.shadow),
  );
  return match ?? "custom";
}

function DeviceSection({ instance }: { instance: DeviceInstance }) {
  const update = useProject((s) => s.updateDevice);
  const remove = useProject((s) => s.removeDevice);
  const device = registry.get(instance.deviceId);
  if (!device) return null;
  const set = (patch: Partial<DeviceInstance>) => update(instance.id, patch);

  return (
    <div className="flex flex-col gap-5 p-4">
      <Row label="Model">
        <Combobox<DeviceDefinition>
          items={registry.list()}
          value={device}
          onValueChange={(d) => d && set({ deviceId: d.id })}
          itemToStringLabel={(d) => d.name}
          isItemEqualToValue={(a, b) => a.id === b.id}
        >
          <ComboboxInput placeholder="Search devices" className="h-8 w-full" />
          <ComboboxContent>
            <ComboboxEmpty>No device found.</ComboboxEmpty>
            <ComboboxList>
              {(d: DeviceDefinition) => (
                <ComboboxItem key={d.id} value={d}>
                  <span className="flex-1">{d.name}</span>
                  <span className="text-[11px] text-muted-foreground">{d.brand}</span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Row>

      <Row label="Finish">
        <Select value={instance.colorId} onValueChange={(colorId) => set({ colorId })}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {device.frame.colors.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="size-3 rounded-full border border-white/20" style={{ background: c.body }} />
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <Row label="Orientation">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={instance.orientation}
          onValueChange={(v) => v && set({ orientation: v as DeviceInstance["orientation"] })}
          className="w-full"
        >
          <ToggleGroupItem value="portrait" className="flex-1">Portrait</ToggleGroupItem>
          <ToggleGroupItem value="landscape" className="flex-1">Landscape</ToggleGroupItem>
        </ToggleGroup>
      </Row>

      <Separator />

      <Row label="Scale" value={`${instance.scale.toFixed(2)}x`}>
        <Slider min={0.2} max={2} step={0.01} value={[instance.scale]} onValueChange={([scale]) => set({ scale })} />
      </Row>
      <Row label="Rotation" value={`${instance.rotation}°`}>
        <Slider min={-45} max={45} step={1} value={[instance.rotation]} onValueChange={([rotation]) => set({ rotation })} />
      </Row>

      <Separator />

      <Row label="Render">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={instance.renderMode}
          onValueChange={(v) => v && set({ renderMode: v as RenderMode })}
          className="w-full"
        >
          {RENDER_MODES.map((m) => (
            <ToggleGroupItem key={m.id} value={m.id} className="flex-1">
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>
      {instance.renderMode === "perspective" ? (
        <Row label="Tilt" value={`${instance.tilt}°`}>
          <Slider min={-35} max={35} step={1} value={[instance.tilt]} onValueChange={([tilt]) => set({ tilt })} />
        </Row>
      ) : null}
      {instance.renderMode !== "flat" ? (
        <Row label="Shadow">
          <Select
            value={shadowPresetOf(instance)}
            onValueChange={(id) => id !== "custom" && set({ shadow: SHADOW_PRESETS[id as ShadowPresetId] })}
          >
            <SelectTrigger size="sm" className="w-full capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(SHADOW_PRESETS).map((id) => (
                <SelectItem key={id} value={id} className="capitalize">
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      ) : null}

      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(instance.id)}>
        Remove device
      </Button>
      <Separator />
    </div>
  );
}

function BackgroundSection() {
  const background = useProject((s) => s.background);
  const setBackground = useProject((s) => s.setBackground);
  const current = JSON.stringify(background);

  return (
    <div className="flex flex-col gap-3 p-4">
      <span className="text-xs text-muted-foreground">Background</span>
      <div className="grid grid-cols-4 gap-2">
        {BACKGROUND_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.name}
            onClick={() => setBackground(p.value)}
            className={cn(
              "aspect-square rounded-md border border-white/10 transition-shadow",
              JSON.stringify(p.value) === current && "ring-2 ring-signal ring-offset-2 ring-offset-sidebar",
            )}
            style={{ background: backgroundToCss(p.value) }}
          />
        ))}
      </div>
    </div>
  );
}
