import type { ReactElement } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { registry } from "@/lib/registry";
import { useBlocksDialog } from "./BlocksDialog";
import { editActions, TEXT_PRESETS } from "./actions";
import { useEdit, usePlayback } from "./store";

/** What sits under a right-click on the preview. `at` is a fraction of the output. */
export type PreviewTarget =
  | { kind: "overlay"; id: string }
  | { kind: "layer"; id: string; at: { x: number; y: number } }
  | { kind: "empty"; at: { x: number; y: number } };

/**
 * Right-click on the preview: quick edits on what was clicked, without
 * going through the inspector.
 */
export function PreviewMenu({
  target,
  children,
}: {
  target: PreviewTarget | null;
  children: ReactElement;
}) {
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open || !target) return;
        if (target.kind === "overlay")
          usePlayback.getState().select({ kind: "overlay", id: target.id });
        if (target.kind === "layer")
          usePlayback.getState().selectLayer(target.id);
      }}
    >
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-56">
        {target?.kind === "overlay" ? <OverlayItems id={target.id} /> : null}
        {target?.kind === "layer" ? (
          <>
            <ContextMenuItem onClick={() => editActions.zoomHere(target.at)}>
              Zoom here
            </ContextMenuItem>
            <ContextMenuSeparator />
            <LayerItems id={target.id} />
          </>
        ) : null}
        {target?.kind === "empty" || !target ? (
          <EmptyItems at={target?.kind === "empty" ? target.at : undefined} />
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function OverlayItems({ id }: { id: string }) {
  const overlay = useEdit((s) => s.edit.overlays.find((o) => o.id === id));
  if (!overlay) return null;
  const sel = { kind: "overlay" as const, id };
  return (
    <>
      <ContextMenuLabel className="capitalize">
        {overlay.kind === "text" ? overlay.text.slice(0, 28) : overlay.kind}
      </ContextMenuLabel>
      <ContextMenuItem onClick={() => usePlayback.getState().select(sel)}>
        Edit…
      </ContextMenuItem>
      <ContextMenuItem onClick={() => editActions.duplicate(sel)}>
        Duplicate
        <ContextMenuShortcut>⌘D</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => editActions.moveOverlayLane(id, 1)}>
        Bring forward
      </ContextMenuItem>
      <ContextMenuItem
        disabled={overlay.lane === 0}
        onClick={() => editActions.moveOverlayLane(id, -1)}
      >
        Send backward
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onClick={() => {
          usePlayback.getState().select(sel);
          editActions.deleteSelection();
        }}
      >
        Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

function LayerItems({ id }: { id: string }) {
  const layer = useEdit((s) => s.edit.layers?.find((l) => l.instanceId === id));
  const count = useEdit((s) => s.edit.layers?.length ?? 0);
  if (!layer) return null;
  const device = registry.get(layer.deviceId);
  // Same kind of hardware: a phone recording stays believable in another phone.
  const models = registry
    .list()
    .filter((d) => !device || d.category === device.category);
  return (
    <>
      <ContextMenuLabel>{device?.name ?? layer.deviceId}</ContextMenuLabel>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Model</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80">
          <ContextMenuRadioGroup
            value={layer.deviceId}
            onValueChange={(v) => {
              const d = registry.get(String(v));
              if (d)
                editActions.setLayer(id, {
                  deviceId: d.id,
                  colorId: d.frame.colors[0].id,
                });
            }}
          >
            {models.map((d) => (
              <ContextMenuRadioItem key={d.id} value={d.id}>
                {d.name}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {device ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Finish</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={layer.colorId}
              onValueChange={(v) =>
                editActions.setLayer(id, { colorId: String(v) })
              }
            >
              {device.frame.colors.map((c) => (
                <ContextMenuRadioItem key={c.id} value={c.id}>
                  <span
                    className="size-3 rounded-full border border-white/20"
                    style={{ background: c.body }}
                  />
                  {c.name}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      <ContextMenuCheckboxItem
        checked={layer.frame}
        onCheckedChange={() =>
          editActions.setLayer(id, { frame: !layer.frame })
        }
      >
        Device frame
      </ContextMenuCheckboxItem>
      <ContextMenuItem
        onClick={() => editActions.setLayer(id, { rotation: 0 })}
      >
        Straighten
      </ContextMenuItem>
      {count > 1 ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => editActions.soloLayer(id)}>
            Show only this device
          </ContextMenuItem>
          <ContextMenuItem onClick={() => editActions.showAllLayers()}>
            Show all devices
          </ContextMenuItem>
        </>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => usePlayback.getState().selectLayer(id)}>
        More settings…
      </ContextMenuItem>
      {count > 1 ? (
        <ContextMenuItem
          variant="destructive"
          onClick={() => editActions.setLayerHidden(id, true)}
        >
          Remove from video
        </ContextMenuItem>
      ) : null}
    </>
  );
}

function EmptyItems({ at }: { at?: { x: number; y: number } }) {
  return (
    <>
      {at ? (
        <ContextMenuItem onClick={() => editActions.zoomHere(at)}>
          Zoom here
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onClick={() => editActions.addText(TEXT_PRESETS[0], at)}>
        Add a title here
      </ContextMenuItem>
      <ContextMenuItem onClick={() => editActions.addText(TEXT_PRESETS[1], at)}>
        Add a caption here
      </ContextMenuItem>
      <ContextMenuItem onClick={() => editActions.addBlur("blur", at)}>
        Blur here
      </ContextMenuItem>
      <ContextMenuItem onClick={() => editActions.addBlur("pixelate", at)}>
        Pixelate here
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => editActions.addSlide()}>
        Add a slide at the playhead
      </ContextMenuItem>
      <ContextMenuItem onClick={() => editActions.captionScenes()}>
        Caption every scene
      </ContextMenuItem>
      <ContextMenuItem onClick={() => useBlocksDialog.getState().show({ at })}>
        Add a block here…
      </ContextMenuItem>
    </>
  );
}
