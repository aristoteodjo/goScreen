import type { DeviceDefinition } from "@goscreen/device-registry";
import {
  type CameraEdit,
  type LayerEdit,
  outputSize,
  stageArea,
} from "@goscreen/render-engine";
import { ArrowLeft01Icon, SmartPhone01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { registry } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { initialLayers } from "./devices";
import { Section, SliderRow, useChange } from "./PanelKit";
import { useSession } from "./session";
import { useEdit, usePlayback } from "./store";

/** Re-runs the side-by-side layout, keeping each device's look. */
function useRearrange() {
  const change = useChange();
  return () => {
    const { layers, source, cameraUrl } = useSession.getState();
    if (!source) return;
    change((ed) => {
      const area = stageArea(
        outputSize(ed.aspect, source),
        ed.camera,
        cameraUrl !== null,
      );
      return { ...ed, layers: initialLayers(layers, area, ed.layers ?? []) };
    });
  };
}

export function DevicesPanel() {
  const layers = useEdit((s) => s.edit.layers);
  const selected = usePlayback((s) => s.selectedLayer);
  const selectLayer = usePlayback((s) => s.selectLayer);
  const rearrange = useRearrange();
  const layer = layers?.find((l) => l.instanceId === selected);

  if (!layers || layers.length === 0) {
    return (
      <Section
        title="Devices"
        hint="This recording was captured flat, before layers existed. Record again to restyle devices after capture."
      />
    );
  }

  if (!layer) {
    return (
      <>
        <Section
          title="Devices"
          hint="Each device is its own layer: change the model, color or frame without re-recording."
        >
          <div className="flex flex-col gap-1.5">
            {layers.map((l) => (
              <button
                key={l.instanceId}
                type="button"
                onClick={() => selectLayer(l.instanceId)}
                className="flex items-center gap-2.5 rounded-lg border bg-background/40 px-3 py-2 text-left text-[13px] hover:bg-white/5"
              >
                <HugeiconsIcon
                  icon={SmartPhone01Icon}
                  size={16}
                  strokeWidth={1.75}
                  className="text-muted-foreground"
                />
                <span className="flex-1 truncate">
                  {registry.get(l.deviceId)?.name ?? l.deviceId}
                </span>
                <span className="text-[11px] text-muted-foreground">Edit</span>
              </button>
            ))}
          </div>
        </Section>
        <Section
          title="Layout"
          hint="Drag devices in the preview, or reset them side by side."
        >
          <Button variant="secondary" size="sm" onClick={rearrange}>
            Arrange side by side
          </Button>
        </Section>
      </>
    );
  }

  return <LayerEditor layer={layer} onBack={() => selectLayer(null)} />;
}

function LayerEditor({
  layer,
  onBack,
}: {
  layer: LayerEdit;
  onBack: () => void;
}) {
  const change = useChange();
  const device = registry.get(layer.deviceId);
  const set = (patch: Partial<LayerEdit>, key?: string) =>
    change(
      (ed) => ({
        ...ed,
        layers:
          ed.layers?.map((l) =>
            l.instanceId === layer.instanceId ? { ...l, ...patch } : l,
          ) ?? null,
      }),
      key,
    );

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="-mt-1 mb-2 flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
        All devices
      </button>
      <Section
        title="Model"
        hint="The recorded screen stays the same; only the hardware around it changes."
      >
        <Combobox<DeviceDefinition>
          items={registry.list()}
          value={device ?? null}
          onValueChange={(d) => {
            if (!d) return;
            set({ deviceId: d.id, colorId: d.frame.colors[0].id });
          }}
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
                  <span className="text-[11px] text-muted-foreground">
                    {d.brand}
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Section>
      {device ? (
        <Section title="Finish">
          <Select
            value={layer.colorId}
            onValueChange={(colorId) => set({ colorId })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {device.frame.colors.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span
                    className="size-3 rounded-full border border-white/20"
                    style={{ background: c.body }}
                  />
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      ) : null}
      <Section
        title="Device frame"
        hint="Off shows the bare screen."
        aside={
          <Switch
            checked={layer.frame}
            onCheckedChange={(frame) => set({ frame })}
          />
        }
      />
      <Section title="Size">
        <SliderRow
          value={layer.scale}
          min={0.15}
          max={1.4}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(scale) => set({ scale }, `scale-${layer.instanceId}`)}
        />
      </Section>
      <Section title="Rotation">
        <SliderRow
          value={layer.rotation}
          min={-45}
          max={45}
          step={1}
          format={(v) => `${v}°`}
          onChange={(rotation) =>
            set({ rotation }, `rotation-${layer.instanceId}`)
          }
          onReset={() => set({ rotation: 0 })}
        />
      </Section>
    </>
  );
}

const CORNERS = [0, 1, 2, 3, 5, 6, 7, 8];

export function CameraPanel() {
  const camera = useEdit((s) => s.edit.camera);
  const change = useChange();
  const set = (patch: Partial<CameraEdit>, key?: string) =>
    change((ed) => ({ ...ed, camera: { ...ed.camera, ...patch } }), key);

  return (
    <>
      <Section
        title="Show camera"
        hint="Recorded apart from the screen: place, resize or hide it any time."
        aside={
          <Switch
            checked={camera.visible}
            onCheckedChange={(visible) => set({ visible })}
          />
        }
      />
      <div className={cn(!camera.visible && "pointer-events-none opacity-40")}>
        <Section title="Layout">
          <div className="grid grid-cols-2 gap-2">
            {(["overlay", "split"] as const).map((layout) => (
              <button
                key={layout}
                type="button"
                onClick={() => set({ layout })}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-2 text-[11px] text-muted-foreground",
                  camera.layout === layout &&
                    "border-violet-400 text-foreground",
                )}
              >
                <span className="relative block h-12 w-full rounded bg-white/90">
                  {layout === "overlay" ? (
                    <span className="absolute right-1 bottom-1 size-4 rounded bg-neutral-700" />
                  ) : (
                    <span className="absolute inset-y-0 right-0 w-1/3 rounded-r bg-neutral-700" />
                  )}
                </span>
                {layout === "overlay" ? "Camera overlay" : "Split screen"}
              </button>
            ))}
          </div>
        </Section>
        {camera.layout === "overlay" ? (
          <>
            <Section title="Position">
              <div className="grid grid-cols-3 gap-y-3 rounded-lg bg-background/40 p-3">
                {Array.from({ length: 9 }, (_, i) =>
                  CORNERS.includes(i) ? (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed 3x3 grid
                      key={i}
                      type="button"
                      aria-label={`Position ${i + 1}`}
                      onClick={() => set({ corner: i })}
                      className="flex h-6 items-center justify-center"
                    >
                      <span
                        className={cn(
                          "size-2 rounded-full bg-muted-foreground/60",
                          camera.corner === i &&
                            "size-3.5 bg-violet-400 ring-4 ring-violet-400/25",
                        )}
                      />
                    </button>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed 3x3 grid
                    <span key={i} />
                  ),
                )}
              </div>
            </Section>
            <Section title="Size">
              <SliderRow
                value={camera.size}
                min={0.1}
                max={0.5}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(size) => set({ size }, "camera-size")}
                onReset={() => set({ size: 0.22 })}
              />
            </Section>
          </>
        ) : null}
        <Section title="Shape">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={camera.shape}
            onValueChange={(v) => v && set({ shape: v as CameraEdit["shape"] })}
            className="w-full"
          >
            <ToggleGroupItem value="rounded" className="flex-1">
              Rounded
            </ToggleGroupItem>
            <ToggleGroupItem value="circle" className="flex-1">
              Circle
            </ToggleGroupItem>
            <ToggleGroupItem value="square" className="flex-1">
              Square
            </ToggleGroupItem>
          </ToggleGroup>
        </Section>
        <Section
          title="Mirror"
          aside={
            <Switch
              checked={camera.mirror}
              onCheckedChange={(mirror) => set({ mirror })}
            />
          }
        />
      </div>
    </>
  );
}
