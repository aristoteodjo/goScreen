import { useEffect } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { registry } from "@/lib/registry";
import type { CaptureControls } from "@/modules/recording/useCapture";
import { ASPECTS, type AspectId } from "../store/aspect";
import { useEditor } from "../store/editor";
import { useProject } from "../store/project";

export function CommandPalette({ capture }: { capture: CaptureControls }) {
  const open = useEditor((s) => s.paletteOpen);
  const setOpen = useEditor((s) => s.setPaletteOpen);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const project = useProject();
  const selected = project.devices.find((d) => d.id === selectedId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useEditor.getState().paletteOpen);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        capture.toggleRecording();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen, capture]);

  const run = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command" />
      <CommandList>
        <CommandEmpty>No command found.</CommandEmpty>
        <CommandGroup heading="Capture">
          <CommandItem onSelect={run(capture.toggleRecording)}>
            {capture.recording ? "Stop recording" : "Start recording"}
            <CommandShortcut>Cmd Shift R</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(capture.screenshot)}>Take screenshot</CommandItem>
        </CommandGroup>
        {selected ? (
          <CommandGroup heading="Selected device">
            <CommandItem
              onSelect={run(() =>
                project.updateDevice(selected.id, {
                  orientation: selected.orientation === "portrait" ? "landscape" : "portrait",
                }),
              )}
            >
              Rotate device
            </CommandItem>
            <CommandItem onSelect={run(() => project.removeDevice(selected.id))}>Remove device</CommandItem>
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Add device">
          {registry.list().map((d) => (
            <CommandItem
              key={d.id}
              value={`add ${d.brand} ${d.name}`}
              onSelect={run(() => {
                const id = project.addDevice(d.id);
                if (id) select(id);
              })}
            >
              Add {d.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Scene">
          <CommandItem onSelect={run(project.autoLayout)}>Auto layout devices</CommandItem>
          <CommandItem onSelect={run(() => project.setSyncInteractions(!project.syncInteractions))}>
            {project.syncInteractions ? "Disable" : "Enable"} interaction sync
          </CommandItem>
          {(Object.keys(ASPECTS) as AspectId[]).map((id) => (
            <CommandItem key={id} value={`aspect ratio ${id}`} onSelect={run(() => project.setAspect(id))}>
              Aspect ratio {id}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
