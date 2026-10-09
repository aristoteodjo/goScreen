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
import { canvasCommands } from "@/modules/canvas/commands";
import { useReload } from "@/modules/interaction/runtime";
import { useCaptureSettings } from "@/modules/recording/settings";
import { useRecording } from "@/modules/recording/store";
import { studioActions } from "../actions";
import { useEditor } from "../store/editor";
import { useProject } from "../store/project";

/** Right-click on a device, in the canvas or the scene. */
export function DeviceContextMenu({ id, children }: { id: string; children: ReactElement }) {
  const device = useProject((s) => s.devices.find((d) => d.id === id));
  const view = useEditor((s) => s.view);
  const recording = useRecording((s) => s.active);
  const def = device ? registry.get(device.deviceId) : undefined;
  if (!device || !def) return children;
  const web = device.source.kind === "web";

  return (
    // Disabled, never unwrapped, while recording: unwrapping would remount the
    // frame (and its page) and detach the element the capture measures.
    <ContextMenu disabled={recording} onOpenChange={(open) => open && useEditor.getState().select(id)}>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="truncate">{def.name}</ContextMenuLabel>
        <ContextMenuItem onClick={() => studioActions.recordDevice(id)}>Record this device</ContextMenuItem>
        <ContextMenuItem onClick={() => studioActions.screenshotDevice(id)}>Screenshot this device</ContextMenuItem>
        <ContextMenuSeparator />
        {view === "canvas" ? (
          <ContextMenuItem onClick={() => canvasCommands.focus(id)}>Zoom to device</ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem onClick={() => useProject.getState().reorderDevice(id, "front")}>
              Bring to front
            </ContextMenuItem>
            <ContextMenuItem onClick={() => useProject.getState().reorderDevice(id, "back")}>Send to back</ContextMenuItem>
          </>
        )}
        {web ? (
          <>
            <ContextMenuItem onClick={() => studioActions.rotate(id)}>
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
              <ContextMenuItem onClick={() => useProject.getState().updateDevice(id, { viewport: null })}>
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
        <ContextMenuItem onClick={() => studioActions.duplicate(id)}>Duplicate</ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => studioActions.remove(id)}>
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Right-click on the empty canvas or around the scene. */
export function ViewContextMenu({ children }: { children: ReactElement }) {
  const view = useEditor((s) => s.view);
  const recording = useRecording((s) => s.active);
  const hasDevices = useProject((s) => s.devices.length > 0);
  const bubbleHidden = useCaptureSettings((s) => s.camera !== null && !s.bubble.visible);

  return (
    <ContextMenu disabled={recording}>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-56">
        <ContextMenuItem disabled={!hasDevices} onClick={studioActions.recordView}>
          Record the {view}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasDevices} onClick={studioActions.screenshotView}>
          Screenshot the {view}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {view === "canvas" ? (
          <>
            <ContextMenuItem disabled={!hasDevices} onClick={() => canvasCommands.fit()}>
              Fit all devices
              <ContextMenuShortcut>⇧1</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => canvasCommands.reset()}>
              Zoom to 100%
              <ContextMenuShortcut>⌘0</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!hasDevices} onClick={() => useProject.getState().arrangeCanvas()}>
              Arrange in a row
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem disabled={!hasDevices} onClick={() => useProject.getState().autoLayout()}>
            Auto layout
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => useReload.getState().reloadAll()}>Reload all pages</ContextMenuItem>
        {bubbleHidden ? (
          <ContextMenuItem onClick={() => useCaptureSettings.getState().setBubble({ visible: true })}>
            Show camera bubble
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => useEditor.getState().setPaletteOpen(true)}>
          Add a device…
          <ContextMenuShortcut>⌘K</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
