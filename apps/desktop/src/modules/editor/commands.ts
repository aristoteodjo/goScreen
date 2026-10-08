import { placeZoom } from "@goscreen/render-engine";
import { player } from "./session";
import { useEdit, usePlayback } from "./store";

const FRAME = 1 / 30;

export type EditorCommand = {
  id: string;
  group: "Playback" | "Edit" | "Zoom";
  label: string;
  shortcut?: string;
  run: () => void;
};

function addZoomAtPlayhead() {
  const { time, duration, selectZoom } = usePlayback.getState();
  const slot = placeZoom(useEdit.getState().edit.zooms, time, duration);
  if (!slot) return;
  const id = `zoom-${Date.now().toString(36)}`;
  useEdit.getState().change((ed) => ({ ...ed, zooms: [...ed.zooms, { id, ...slot, scale: 2, focus: null }] }));
  selectZoom(id);
}

function deleteSelectedZoom() {
  const { selectedZoom, selectZoom } = usePlayback.getState();
  if (!selectedZoom) return;
  useEdit.getState().change((ed) => ({ ...ed, zooms: ed.zooms.filter((z) => z.id !== selectedZoom) }));
  selectZoom(null);
}

export function editorCommands(openExport: () => void): EditorCommand[] {
  return [
    { id: "play", group: "Playback", label: "Play / pause", shortcut: "Space", run: player.toggle },
    { id: "first", group: "Playback", label: "Go to first frame", shortcut: "⌘ ←", run: player.first },
    { id: "last", group: "Playback", label: "Go to last frame", shortcut: "⌘ →", run: player.last },
    { id: "back", group: "Playback", label: "Move backwards", shortcut: "←", run: () => player.step(-FRAME) },
    { id: "back-fast", group: "Playback", label: "Move backwards fast", shortcut: "⇧ ←", run: () => player.step(-1) },
    { id: "fwd", group: "Playback", label: "Move forwards", shortcut: "→", run: () => player.step(FRAME) },
    { id: "fwd-fast", group: "Playback", label: "Move forwards fast", shortcut: "⇧ →", run: () => player.step(1) },
    { id: "undo", group: "Edit", label: "Undo", shortcut: "⌘ Z", run: () => useEdit.getState().undo() },
    { id: "redo", group: "Edit", label: "Redo", shortcut: "⇧ ⌘ Z", run: () => useEdit.getState().redo() },
    { id: "export", group: "Edit", label: "Export MP4", shortcut: "⌘ E", run: openExport },
    { id: "zoom-add", group: "Zoom", label: "Add zoom at playhead", shortcut: "Z", run: addZoomAtPlayhead },
    { id: "zoom-delete", group: "Zoom", label: "Delete selected zoom", shortcut: "⌫", run: deleteSelectedZoom },
    {
      id: "zoom-clear",
      group: "Zoom",
      label: "Remove all zooms",
      run: () => {
        useEdit.getState().change((ed) => ({ ...ed, zooms: [] }));
        usePlayback.getState().selectZoom(null);
      },
    },
  ];
}

/** Keyboard event -> command id. Inputs keep their own keys. */
export function commandForKey(e: KeyboardEvent): string | null {
  const target = e.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable=true], [role=slider]")) return null;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === "z") return e.shiftKey ? "redo" : "undo";
  if (mod && key === "e") return "export";
  if (mod && key === "arrowleft") return "first";
  if (mod && key === "arrowright") return "last";
  if (mod) return null;
  if (key === " ") return "play";
  if (key === "arrowleft") return e.shiftKey ? "back-fast" : "back";
  if (key === "arrowright") return e.shiftKey ? "fwd-fast" : "fwd";
  if (key === "z") return "zoom-add";
  if (key === "backspace" || key === "delete") return "zoom-delete";
  return null;
}
