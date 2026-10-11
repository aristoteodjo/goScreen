import type { FlowNode, FlowStart } from "@goscreen/scenario";
import {
  Alert02Icon,
  CameraOff01Icon,
  Globe02Icon,
  UserSwitchIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { registry } from "@/lib/registry";
import { cn } from "@/lib/utils";

export type NodeStatus = "ok" | "running" | "failed";

export type StartData = { start: FlowStart; name: string };
export type StepNodeData = {
  node: FlowNode;
  status: NodeStatus | null;
  issues: string[];
};

const STATUS_RING: Record<NodeStatus, string> = {
  ok: "ring-2 ring-emerald-400/80",
  running: "ring-2 ring-amber-400 animate-pulse",
  failed: "ring-2 ring-destructive",
};

const KIND = {
  scene: { icon: Video01Icon, label: "Scene", tint: "border-amber-500/50" },
  offcamera: {
    icon: CameraOff01Icon,
    label: "Off camera",
    tint: "border-white/15 border-dashed",
  },
  session: {
    icon: UserSwitchIcon,
    label: "Session",
    tint: "border-sky-500/50",
  },
} as const;

const handle = "!size-2.5 !border-2 !border-background !bg-white/70";

export function StartNode({ data, selected }: NodeProps) {
  const { start, name } = data as StartData;
  const device = registry.get(start.device.id);
  return (
    <div
      className={cn(
        "w-56 rounded-xl border border-emerald-500/50 bg-card px-3 py-2.5 shadow-lg",
        selected && "ring-2 ring-white/70",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-emerald-300 uppercase">
        <HugeiconsIcon icon={Globe02Icon} size={12} />
        Start
      </div>
      <div className="mt-1 truncate text-sm font-medium">{name}</div>
      <div className="truncate font-mono text-[10px] text-muted-foreground">
        {start.url}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {device?.name ?? start.device.id} · {start.film.aspect}
      </div>
      <Handle type="source" position={Position.Right} className={handle} />
    </div>
  );
}

export function StepNode({ data, selected }: NodeProps) {
  const { node, status, issues } = data as StepNodeData;
  const kind = KIND[node.kind];
  const title =
    node.kind === "scene"
      ? node.caption || "Untitled scene"
      : node.kind === "session"
        ? `Account: ${node.session ?? "?"}`
        : node.caption || "Off camera";
  return (
    <div
      className={cn(
        "w-56 rounded-xl border bg-card px-3 py-2.5 shadow-lg",
        kind.tint,
        status && STATUS_RING[status],
        selected && !status && "ring-2 ring-white/70",
        node.kind === "offcamera" && "bg-card/60",
      )}
    >
      <Handle type="target" position={Position.Left} className={handle} />
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        <HugeiconsIcon icon={kind.icon} size={12} />
        {kind.label}
        {issues.length > 0 ? (
          <span title={issues.join("\n")} className="ml-auto text-amber-400">
            <HugeiconsIcon icon={Alert02Icon} size={13} />
          </span>
        ) : null}
      </div>
      <div className="mt-1 line-clamp-2 text-sm font-medium">{title}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {node.steps.length} step{node.steps.length === 1 ? "" : "s"}
        {status === "failed" ? " · failed here" : ""}
      </div>
      <Handle type="source" position={Position.Right} className={handle} />
    </div>
  );
}

export const nodeTypes = {
  start: StartNode,
  scene: StepNode,
  offcamera: StepNode,
  session: StepNode,
};
