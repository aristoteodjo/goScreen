import { useEffect } from "react";
import { commandForKey, editorCommands } from "./commands";
import { usePlayback } from "./store";

export function useEditorShortcuts(openExport: () => void) {
  useEffect(() => {
    const commands = editorCommands(openExport);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const { paletteOpen, setPaletteOpen } = usePlayback.getState();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (usePlayback.getState().paletteOpen || document.querySelector("[role=dialog]")) return;
      const id = commandForKey(e);
      const command = id ? commands.find((c) => c.id === id) : null;
      if (!command) return;
      e.preventDefault();
      command.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openExport]);
}
