import { DEFAULT_TRANSITION, SPEEDS, TRANSITION_KINDS, type TransitionKind } from "@goscreen/render-engine";
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
import { player } from "./session";
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
