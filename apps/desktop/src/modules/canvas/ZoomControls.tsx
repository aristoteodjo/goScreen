import { CenterFocusIcon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canvasCommands } from "./commands";
import { useCanvasView } from "./view";

export function ZoomControls() {
  const zoom = useCanvasView((s) => s.zoom);
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border bg-popover/90 p-1 shadow-lg backdrop-blur"
    >
      <Tip label="Zoom out (Cmd -)">
        <Button variant="ghost" size="icon-sm" onClick={() => canvasCommands.zoomBy(-1)} aria-label="Zoom out">
          <HugeiconsIcon icon={MinusSignIcon} strokeWidth={1.75} />
        </Button>
      </Tip>
      <Tip label="Reset to 100% (Cmd 0)">
        <Button variant="ghost" size="sm" className="w-14 font-mono text-xs tabular-nums" onClick={canvasCommands.reset}>
          {Math.round(zoom * 100)}%
        </Button>
      </Tip>
      <Tip label="Zoom in (Cmd +)">
        <Button variant="ghost" size="icon-sm" onClick={() => canvasCommands.zoomBy(1)} aria-label="Zoom in">
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={1.75} />
        </Button>
      </Tip>
      <Tip label="Fit all devices (Shift 1)">
        <Button variant="ghost" size="icon-sm" onClick={() => canvasCommands.fit()} aria-label="Fit all devices">
          <HugeiconsIcon icon={CenterFocusIcon} strokeWidth={1.75} />
        </Button>
      </Tip>
    </div>
  );
}

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
