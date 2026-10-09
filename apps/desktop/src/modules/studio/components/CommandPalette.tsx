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
import { canvasCommands } from "@/modules/canvas/commands";
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
        <CommandGroup heading="View">
          <CommandItem onSelect={run(() => canvasCommands.fit())}>
            Fit all devices
            <CommandShortcut>Shift 1</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(project.arrangeCanvas)}>Arrange devices in a row</CommandItem>
        </CommandGroup>
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
            <CommandItem onSelect={run(() => project.setSynced(selected.id, !selected.synced))}>
              {selected.synced ? "Unsync" : "Sync"} this device
            </CommandItem>
            {selected.viewport ? (
              <CommandItem onSelect={run(() => project.updateDevice(selected.id, { viewport: null }))}>
                Reset to native size
              </CommandItem>
            ) : null}
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
          <CommandItem onSelect={run(() => project.setAllSynced(true))}>Sync all devices</CommandItem>
          <CommandItem onSelect={run(() => project.setAllSynced(false))}>Unsync all devices</CommandItem>
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
