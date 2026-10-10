import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { type EditorCommand, editorCommands } from "./commands";
import { usePlayback } from "./store";

const GROUPS: EditorCommand["group"][] = [
  "Playback",
  "Edit",
  "Tools",
  "View",
  "Add",
  "Zoom",
];

export function EditorPalette({ openExport }: { openExport: () => void }) {
  const open = usePlayback((s) => s.paletteOpen);
  const setOpen = usePlayback((s) => s.setPaletteOpen);
  const commands = editorCommands(openExport);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type to find a command" />
      <CommandList>
        <CommandEmpty>No command found.</CommandEmpty>
        {GROUPS.map((group) => (
          <CommandGroup key={group} heading={group}>
            {commands
              .filter((c) => c.group === group)
              .map((c) => (
                <CommandItem
                  key={c.id}
                  onSelect={() => {
                    setOpen(false);
                    c.run();
                  }}
                >
                  {c.label}
                  {c.shortcut ? (
                    <CommandShortcut>{c.shortcut}</CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
