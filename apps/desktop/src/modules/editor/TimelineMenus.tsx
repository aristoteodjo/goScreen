import { DEFAULT_TRANSITION, MIC_ASSET, SPEEDS, TRANSITION_KINDS, type TransitionKind } from "@goscreen/render-engine";
import type { ReactElement } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { editActions } from "./actions";
import { player, useSession } from "./session";
import { type Selection, useEdit, usePlayback } from "./store";

/** Right-click on a timeline item: it is selected, then quick actions. */
export function TimelineItemMenu({ selection, children }: { selection: Selection; children: ReactElement }) {
  const clip = useEdit((s) =>
    selection.kind === "clip" ? s.edit.clips.find((c) => c.id === selection.id) : undefined,
  );
  const item = useEdit((s) =>
    selection.kind === "overlay"
      ? s.edit.overlays.find((o) => o.id === selection.id)
      : selection.kind === "audio"
        ? s.edit.audio.find((a) => a.id === selection.id)
        : undefined,
  );

  return (
    <ContextMenu onOpenChange={(open) => open && usePlayback.getState().select(selection)}>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={editActions.splitAtPlayhead}>
          Split at playhead
          <ContextMenuShortcut>S</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => editActions.duplicate(selection)}>
          Duplicate
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>
        {item ? <ContextMenuItem onClick={() => player.seek(item.start)}>Go to start</ContextMenuItem> : null}

        {clip ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>Transition in</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={clip.transition?.kind ?? "none"}
                  onValueChange={(v) =>
                    editActions.setTransition(
                      clip.id,
                      v === "none"
                        ? null
                        : { kind: v as TransitionKind, duration: clip.transition?.duration ?? DEFAULT_TRANSITION.duration },
                    )
                  }
                >
                  <ContextMenuRadioItem value="none">Cut (none)</ContextMenuRadioItem>
                  {TRANSITION_KINDS.map((k) => (
                    <ContextMenuRadioItem key={k.id} value={k.id}>
                      {k.label}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        ) : null}

        {clip?.kind === "recording" ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>Speed</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={String(clip.speed)}
                  onValueChange={(v) => editActions.setClipSpeed(clip.id, Number(v))}
                >
                  {SPEEDS.map((s) => (
                    <ContextMenuRadioItem key={s} value={String(s)}>
                      {s}×
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuCheckboxItem checked={clip.muted} onCheckedChange={() => editActions.toggleClip(clip.id, "muted")}>
              Mute
            </ContextMenuCheckboxItem>
            <VoiceItem />
            <ContextMenuCheckboxItem
              checked={clip.cameraHidden}
              onCheckedChange={() => editActions.toggleClip(clip.id, "cameraHidden")}
            >
              Hide camera
            </ContextMenuCheckboxItem>
          </>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => editActions.deleteSelection()}>
          Delete
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Right-click on a device track: solo it, hide it, or open its settings. */
export function DeviceMenu({ instanceId, children }: { instanceId: string; children: ReactElement }) {
  const layer = useEdit((s) => s.edit.layers?.find((l) => l.instanceId === instanceId));
  if (!layer) return children;
  return (
    <ContextMenu onOpenChange={(open) => open && usePlayback.getState().selectLayer(instanceId)}>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => editActions.soloLayer(instanceId)}>Show only this device</ContextMenuItem>
        <ContextMenuItem onClick={() => editActions.showAllLayers()}>Show all devices</ContextMenuItem>
        <ContextMenuCheckboxItem
          checked={!layer.hidden}
          onCheckedChange={() => editActions.setLayerHidden(instanceId, !layer.hidden)}
        >
          Visible
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => usePlayback.getState().selectLayer(instanceId)}>Edit device…</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Detach the voice from the video (or put it back), from any recording clip. */
function VoiceItem() {
  const hasMic = useSession((s) => s.micUrl !== null);
  const detached = useEdit((s) => s.edit.audio.some((a) => a.asset === MIC_ASSET));
  if (!hasMic) return null;
  return detached ? (
    <ContextMenuItem onClick={() => editActions.reattachAudio()}>Reattach voice to video</ContextMenuItem>
  ) : (
    <ContextMenuItem onClick={() => editActions.detachAudio()}>Detach voice from video</ContextMenuItem>
  );
}
