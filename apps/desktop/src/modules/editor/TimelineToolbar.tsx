import type { ShapeKind } from "@goscreen/render-engine";
import {
  BlurIcon,
  Copy01Icon,
  Cursor01Icon,
  HandGrabIcon,
  Knife01Icon,
  MagnetIcon,
  Delete02Icon,
  FitToScreenIcon,
  Image01Icon,
  MusicNote01Icon,
  PresentationBarChart01Icon,
  Scissor01Icon,
  ShapesIcon,
  TextIcon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { editActions, TEXT_PRESETS } from "./actions";
import { type Tool, usePlayback } from "./store";

const TOOLS: { id: Tool; label: string; key: string; icon: typeof Cursor01Icon }[] = [
  { id: "select", label: "Selection", key: "V", icon: Cursor01Icon },
  { id: "blade", label: "Blade: click a clip to cut it", key: "C", icon: Knife01Icon },
  { id: "hand", label: "Hand: drag to scroll", key: "H", icon: HandGrabIcon },
];

export const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: "arrow", label: "Arrow" },
  { id: "rect", label: "Rectangle" },
  { id: "ellipse", label: "Circle" },
  { id: "highlight", label: "Highlight" },
];

/** Add content on the left, cut tools in the middle, timeline zoom on the right. */
export function TimelineToolbar() {
  const selection = usePlayback((s) => s.selection);
  const scale = usePlayback((s) => s.scale);
  const tool = usePlayback((s) => s.tool);
  const snapping = usePlayback((s) => s.snapping);

  const zoomBy = (factor: number) => {
    const el = document.querySelector<HTMLElement>("[data-timeline-pps]");
    const current = scale ?? Number(el?.dataset.timelinePps ?? 0);
    if (!current) return;
    usePlayback.getState().setScale(Math.min(400, current * factor));
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/5 px-3">
      <div className="mr-1 flex items-center rounded-lg bg-white/[0.04] p-0.5">
        {TOOLS.map((t) => (
          <IconTool
            key={t.id}
            icon={t.icon}
            label={t.label}
            shortcut={t.key}
            active={tool === t.id}
            onClick={() => usePlayback.getState().setTool(t.id)}
          />
        ))}
        <IconTool
          icon={MagnetIcon}
          label={snapping ? "Snapping on" : "Snapping off"}
          shortcut="N"
          active={snapping}
          onClick={() => usePlayback.getState().setSnapping(!snapping)}
        />
      </div>
      <div className="mx-1 h-5 w-px bg-white/10" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolButton icon={TextIcon} label="Text" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {TEXT_PRESETS.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => editActions.addText(p)}>
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton icon={Image01Icon} label="Media" onClick={() => void editActions.importMedia(["image", "video"])} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolButton icon={ShapesIcon} label="Shape" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {SHAPES.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => editActions.addShape(s.id)}>
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolButton icon={BlurIcon} label="Blur" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => editActions.addBlur("blur")}>Blur</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editActions.addBlur("pixelate")}>Pixelate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton icon={PresentationBarChart01Icon} label="Slide" onClick={editActions.addSlide} />
      <ToolButton icon={MusicNote01Icon} label="Music" onClick={() => void editActions.importMedia(["audio"])} />

      <div className="mx-2 h-5 w-px bg-white/10" />

      <IconTool icon={Scissor01Icon} label="Split at playhead" shortcut="S" onClick={editActions.splitAtPlayhead} />
      <IconTool
        icon={Copy01Icon}
        label="Duplicate"
        shortcut="⌘ D"
        disabled={!selection}
        onClick={() => editActions.duplicate()}
      />
      <IconTool
        icon={Delete02Icon}
        label="Delete"
        shortcut="⌫"
        disabled={!selection}
        onClick={() => editActions.deleteSelection()}
      />

      <div className="ml-auto flex items-center gap-1">
        <IconTool icon={ZoomOutAreaIcon} label="Zoom out" disabled={scale === null} onClick={() => zoomBy(1 / 1.5)} />
        <IconTool icon={ZoomInAreaIcon} label="Zoom in" onClick={() => zoomBy(1.5)} />
        <IconTool
          icon={FitToScreenIcon}
          label="Fit timeline"
          disabled={scale === null}
          onClick={() => usePlayback.getState().setScale(null)}
        />
      </div>
    </div>
  );
}

function ToolButton({ icon, label, ...props }: { icon: typeof TextIcon; label: string; onClick?: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-[12px] text-muted-foreground hover:text-foreground" {...props}>
      <HugeiconsIcon icon={icon} size={15} strokeWidth={1.75} />
      {label}
    </Button>
  );
}

function IconTool({
  icon,
  label,
  shortcut,
  disabled,
  active,
  onClick,
}: {
  icon: typeof TextIcon;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-8 text-muted-foreground", active && "bg-violet-500/20 text-violet-200 hover:bg-violet-500/25")}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
        >
          <HugeiconsIcon icon={icon} size={16} strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? <Kbd className="ml-2">{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}
