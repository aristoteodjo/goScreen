import type { ReactNode } from "react";
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
import { canvasCommands } from "@/modules/canvas/commands";
import { useReload } from "@/modules/interaction/runtime";
import { useRecording } from "@/modules/recording/store";
import { studioActions } from "../actions";
import { useEditor } from "../store/editor";
import { useProject } from "../store/project";

/** Right-click on a device, in the canvas or the scene. */
export function DeviceContextMenu({ id, children }: { id: string; children: ReactNode }) {
  const device = useProject((s) => s.devices.find((d) => d.id === id));
  const view = useEditor((s) => s.view);
  const recording = useRecording((s) => s.active);
  const def = device ? registry.get(device.deviceId) : undefined;
  if (!device || !def || recording) return children;
  const web = device.source.kind === "web";

  return (
    <ContextMenu onOpenChange={(open) => open && useEditor.getState().select(id)}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="truncate">{def.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => studioActions.recordDevice(id)}>Record this device</ContextMenuItem>
        <ContextMenuItem onSelect={() => studioActions.screenshotDevice(id)}>Screenshot this device</ContextMenuItem>
        <ContextMenuSeparator />
        {view === "canvas" ? (
          <ContextMenuItem onSelect={() => canvasCommands.focus(id)}>Zoom to device</ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem onSelect={() => useProject.getState().reorderDevice(id, "front")}>
              Bring to front
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => useProject.getState().reorderDevice(id, "back")}>Send to back</ContextMenuItem>
          </>
        )}
        {web ? (
          <>
            <ContextMenuItem onSelect={() => studioActions.rotate(id)}>
              Rotate
              <ContextMenuShortcut>{device.orientation === "portrait" ? "Landscape" : "Portrait"}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuCheckboxItem
              checked={device.synced}
              onCheckedChange={(v) => useProject.getState().setSynced(id, v === true)}
            >
              Sync with shared URL
            </ContextMenuCheckboxItem>
            {device.viewport ? (
              <ContextMenuItem onSelect={() => useProject.getState().updateDevice(id, { viewport: null })}>
                Reset to native size
              </ContextMenuItem>
            ) : null}
          </>
        ) : null}
        {def.frame.colors.length > 1 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Color</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={device.colorId}
                onValueChange={(colorId) => useProject.getState().updateDevice(id, { colorId })}
              >
                {def.frame.colors.map((c) => (
                  <ContextMenuRadioItem key={c.id} value={c.id}>
                    <span className="size-3 rounded-full border border-white/20" style={{ background: c.body }} />
                    {c.name}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => studioActions.duplicate(id)}>Duplicate</ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => studioActions.remove(id)}>
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Right-click on the empty canvas or around the scene. */
export function ViewContextMenu({ children }: { children: ReactNode }) {
  const view = useEditor((s) => s.view);
  const recording = useRecording((s) => s.active);
  const hasDevices = useProject((s) => s.devices.length > 0);
  if (recording) return children;
  const other = view === "canvas" ? "scene" : "canvas";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem disabled={!hasDevices} onSelect={studioActions.recordView}>
          Record the {view}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasDevices} onSelect={studioActions.screenshotView}>
          Screenshot the {view}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {view === "canvas" ? (
          <>
            <ContextMenuItem disabled={!hasDevices} onSelect={() => canvasCommands.fit()}>
              Fit all devices
              <ContextMenuShortcut>⇧1</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => canvasCommands.reset()}>
              Zoom to 100%
              <ContextMenuShortcut>⌘0</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!hasDevices} onSelect={() => useProject.getState().arrangeCanvas()}>
              Arrange in a row
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem disabled={!hasDevices} onSelect={() => useProject.getState().autoLayout()}>
            Auto layout
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => useReload.getState().reloadAll()}>Reload all pages</ContextMenuItem>
        <ContextMenuItem onSelect={() => useEditor.getState().setView(other)}>Switch to {other}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => useEditor.getState().setPaletteOpen(true)}>
          Add a device…
          <ContextMenuShortcut>⌘K</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
