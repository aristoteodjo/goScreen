import { SPEEDS } from "@goscreen/render-engine";
import type { ReactNode } from "react";
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
export function TimelineItemMenu({ selection, children }: { selection: Selection; children: ReactNode }) {
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
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={editActions.splitAtPlayhead}>
          Split at playhead
          <ContextMenuShortcut>S</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => editActions.duplicate(selection)}>
          Duplicate
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>
        {item ? <ContextMenuItem onSelect={() => player.seek(item.start)}>Go to start</ContextMenuItem> : null}

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
        <ContextMenuItem variant="destructive" onSelect={() => editActions.deleteSelection()}>
          Delete
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
