import { addRevealer } from "@/modules/control/aiCursor";
import { useTabTitle } from "@/modules/tabs/tabs";
import {
  compileFlow,
  type Flow,
  type FlowNode,
  flowIssues,
  flowPaths,
  parseFlow,
  pathTo,
  START,
} from "@goscreen/scenario";
import {
  ArrowLeft01Icon,
  LayoutGridIcon,
  PlayCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { MenuTrigger } from "@/lib/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { projectsIpc } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { projectKeys } from "@/modules/projects/ProjectsHome";
import { useTasks } from "@/modules/tasks/store";
import { Inspector } from "./Inspector";
import { LiveRecorder } from "./LiveRecorder";
import { type NodeStatus, nodeTypes } from "./nodes";
import { record, simulate } from "./runs";
import { flowActions, useFlowDoc } from "./store";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SAVE_AFTER_MS = 600;

// A VSL as a flow of scenes. Edits save on their own; simulations and
// recordings run in the background and colour the nodes as they go.
export function FlowPage({ project, vsl }: { project: string; vsl: string }) {
  const loaded = useQuery({
    queryKey: ["flow", project, vsl],
    queryFn: async () => {
      const parsed = parseFlow(await projectsIpc.loadVsl(project, vsl));
      if (!parsed.ok) throw new Error(parsed.errors.slice(0, 3).join("\n"));
      return parsed.flow;
    },
    gcTime: 0,
  });
  const flow = useFlowDoc((s) => s.flow);

  useEffect(() => {
    if (loaded.data) useFlowDoc.getState().load(loaded.data);
    return () => useFlowDoc.setState({ flow: null, dirty: false });
  }, [loaded.data]);

  useAutosave(project, vsl);

  if (loaded.isError)
    return (
      <div className="p-8 text-sm text-destructive">
        This VSL cannot be opened: {String(loaded.error)}
      </div>
    );
  if (!flow) return <Skeleton className="m-8 h-96 rounded-xl" />;

  return (
    <div className="flex h-full flex-col">
      <TopBar project={project} vsl={vsl} flow={flow} />
      <div className="flex min-h-0 flex-1">
        <ReactFlowProvider>
          <Canvas project={project} vsl={vsl} />
        </ReactFlowProvider>
        <Inspector project={project} vsl={vsl} />
      </div>
      <LiveRecorder project={project} vsl={vsl} />
    </div>
  );
}

function useAutosave(project: string, vsl: string) {
  const flow = useFlowDoc((s) => s.flow);
  const dirty = useFlowDoc((s) => s.dirty);
  useEffect(() => {
    if (!flow || !dirty) return;
    const timer = setTimeout(async () => {
      try {
        await projectsIpc.saveVsl(project, vsl, flow);
        // Only clear if nothing changed while saving.
        if (useFlowDoc.getState().flow === flow) useFlowDoc.getState().saved();
        void queryClient.invalidateQueries({
          queryKey: projectKeys.vsls(project),
        });
      } catch (e) {
        toast.error("Could not save the VSL", { description: message(e) });
      }
    }, SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [flow, dirty, project, vsl]);
}

function TopBar({
  project,
  vsl,
  flow,
}: {
  project: string;
  vsl: string;
  flow: Flow;
}) {
  const navigate = useNavigate();
  const dirty = useFlowDoc((s) => s.dirty);
  const target = { project, vsl };
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      toast.error(message(e));
    }
  };
  const copyScenario = async () => {
    const { scenario } = compileFlow(flow, flowPaths(flow));
    try {
      await navigator.clipboard.writeText(JSON.stringify(scenario, null, 2));
      toast.success("Scenario JSON copied");
    } catch {
      toast.error("The clipboard refused the copy.");
    }
  };
  useTabTitle(flow.name);
  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center gap-2 border-b pr-3 pl-3"
    >
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Back to the project"
        onClick={() =>
          navigate({ to: "/projects/$project", params: { project } })
        }
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
      </Button>
      <span className="truncate text-[13px] font-semibold">{flow.name}</span>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {dirty ? (
          <>
            <Spinner className="size-3" /> Saving…
          </>
        ) : (
          "Saved"
        )}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={copyScenario}>
          Copy as scenario
        </Button>
        <Button size="sm" variant="ghost" onClick={() => flowActions.layout()}>
          <HugeiconsIcon icon={LayoutGridIcon} size={15} />
          Tidy up
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => run(() => simulate(flow, target))}
        >
          <HugeiconsIcon icon={PlayCircleIcon} size={15} />
          Simulate all
        </Button>
        <Button
          size="sm"
          className="bg-rec text-white hover:bg-rec/90"
          onClick={() => run(() => record(flow, target))}
        >
          Record the VSL
        </Button>
      </div>
    </header>
  );
}

/** How far the latest run of this VSL got, node by node. */
function useNodeStatus(project: string, vsl: string) {
  const tasks = useTasks((s) => s.tasks);
  return useMemo(() => {
    const status = new Map<string, NodeStatus>();
    const task = tasks.find(
      (t) => t.project === project && t.vsl === vsl && t.status !== "queued",
    );
    if (!task || task.origins.length === 0) return status;
    const reached =
      task.status === "done" ? task.origins.length : task.index + 1;
    task.origins.slice(0, reached).forEach((id) => {
      if (id) status.set(id, "ok");
    });
    const current = task.origins[task.index];
    if (task.status === "running" && current) status.set(current, "running");
    if (task.failedNode) status.set(task.failedNode, "failed");
    return status;
  }, [tasks, project, vsl]);
}

type MenuTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "pane"; at: { x: number; y: number } };

function Canvas({ project, vsl }: { project: string; vsl: string }) {
  const flow = useFlowDoc((s) => s.flow) as Flow;
  const selected = useFlowDoc((s) => s.selected);
  const status = useNodeStatus(project, vsl);
  const { screenToFlowPosition, fitView, getNode, getZoom, setCenter } =
    useReactFlow();
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);

  // The AI's cursor shows a node out of view: pan to it first.
  useEffect(
    () =>
      addRevealer((el) => {
        const id = el.closest(".react-flow__node")?.getAttribute("data-id");
        const node = id ? getNode(id) : undefined;
        if (!node || !box.current?.contains(el)) return false;
        void setCenter(
          node.position.x + (node.measured?.width ?? 224) / 2,
          node.position.y + (node.measured?.height ?? 100) / 2,
          { zoom: Math.max(getZoom(), 0.8), duration: 400 },
        );
        return true;
      }),
    [getNode, getZoom, setCenter],
  );

  const issues = useMemo(() => {
    const byNode = new Map<string, string[]>();
    for (const i of flowIssues(flow))
      byNode.set(i.node, [...(byNode.get(i.node) ?? []), i.message]);
    return byNode;
  }, [flow]);

  const nodes: Node[] = useMemo(
    () => [
      {
        id: START,
        type: "start",
        position: flow.start.position,
        data: { start: flow.start, name: flow.name },
        selected: selected === START,
        deletable: false,
      },
      ...flow.nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: n.position,
        data: {
          node: n,
          status: status.get(n.id) ?? null,
          issues: issues.get(n.id) ?? [],
        },
        selected: selected === n.id,
      })),
    ],
    [flow, selected, status, issues],
  );
  const edges: Edge[] = useMemo(() => {
    const x = new Map([
      [START, flow.start.position.x],
      ...flow.nodes.map((n) => [n.id, n.position.x] as const),
    ]);
    return flow.edges.map((e) => ({
      ...e,
      // A journey wrapped to the next band: a curve would cross the band.
      type:
        (x.get(e.target) ?? 0) < (x.get(e.source) ?? 0)
          ? "smoothstep"
          : undefined,
      animated: status.get(e.target) === "running",
    }));
  }, [flow, status]);

  const onNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === "position" && c.position)
        flowActions.move(c.id, c.position);
      if (c.type === "select" && c.selected) useFlowDoc.getState().select(c.id);
    }
    const removed = changes.flatMap((c) => (c.type === "remove" ? [c.id] : []));
    if (removed.length > 0) flowActions.remove(removed);
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = changes.flatMap((c) => (c.type === "remove" ? [c.id] : []));
    if (removed.length > 0) flowActions.removeEdges(removed);
  };
  const onConnect = (c: Connection) => {
    if (c.source && c.target) flowActions.connect(c.source, c.target);
  };

  const target = { project, vsl };
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      toast.error(message(e));
    }
  };
  const add = (kind: FlowNode["kind"]) =>
    flowActions.add(
      kind,
      menu?.kind === "pane" ? menu.at : lastPointer.current,
    );

  return (
    <ContextMenu onOpenChange={(open) => !open && setMenu(null)}>
      <MenuTrigger>
        <div
          ref={box}
          role="application"
          aria-label="VSL flow"
          className="relative min-w-0 flex-1"
          onContextMenu={(e) => {
            const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            lastPointer.current = at;
            // Node and edge handlers ran first (deeper in the tree).
            setMenu((m) => m ?? { kind: "pane", at });
          }}
        >
          <ReactFlow
            data-ai="flow"
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => useFlowDoc.getState().select(null)}
            onNodeContextMenu={(_, n) => {
              useFlowDoc.getState().select(n.id);
              setMenu({ kind: "node", id: n.id });
            }}
            onEdgeContextMenu={(_, e) => setMenu({ kind: "edge", id: e.id })}
            colorMode="dark"
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </MenuTrigger>
      <ContextMenuContent className="w-60">
        {menu?.kind === "node" ? (
          <NodeMenu id={menu.id} flow={flow} target={target} run={run} />
        ) : menu?.kind === "edge" ? (
          <ContextMenuItem
            variant="destructive"
            onClick={() => flowActions.removeEdges([menu.id])}
          >
            Delete this link
          </ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem onClick={() => add("scene")}>
              Add a scene here
            </ContextMenuItem>
            <ContextMenuItem onClick={() => add("offcamera")}>
              Add an off-camera block here
            </ContextMenuItem>
            <ContextMenuItem onClick={() => add("session")}>
              Add a session (other account) here
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => flowActions.layout()}>
              Tidy up
            </ContextMenuItem>
            <ContextMenuItem onClick={() => fitView({ padding: 0.3 })}>
              Fit to screen
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => run(() => simulate(flow, target))}>
              Simulate every journey
            </ContextMenuItem>
            <ContextMenuItem onClick={() => run(() => record(flow, target))}>
              Record the VSL
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NodeMenu({
  id,
  flow,
  target,
  run,
}: {
  id: string;
  flow: Flow;
  target: { project: string; vsl: string };
  run: (fn: () => void) => void;
}) {
  const node = flow.nodes.find((n) => n.id === id);
  const upTo = () => {
    const path = pathTo(flow, id);
    if (!path) throw new Error("This node is not linked to Start.");
    simulate(flow, target, [path]);
  };
  const fromHere = () =>
    flowPaths(flow, id).map((tail) => [
      ...(pathTo(flow, id) ?? []),
      ...tail.slice(1),
    ]);
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Add next</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={() => flowActions.addAfter("scene", id)}>
            Scene
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => flowActions.addAfter("offcamera", id)}
          >
            Off camera
          </ContextMenuItem>
          <ContextMenuItem onClick={() => flowActions.addAfter("session", id)}>
            Session (other account)
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {id !== START ? (
        <>
          <ContextMenuItem onClick={() => useFlowDoc.getState().setLive(id)}>
            Record actions on the site
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(upTo)}>
            Simulate up to here
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => run(() => record(flow, target, fromHere()))}
          >
            Record the journeys through here
          </ContextMenuItem>
          <ContextMenuSeparator />
          {node ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>Turn into</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {(["scene", "offcamera", "session"] as const)
                  .filter((k) => k !== node.kind)
                  .map((kind) => (
                    <ContextMenuItem
                      key={kind}
                      onClick={() =>
                        flowActions.patchNode(id, {
                          kind,
                          session:
                            kind === "session"
                              ? (node.session ?? "second")
                              : node.session,
                        })
                      }
                    >
                      {kind === "scene"
                        ? "Scene"
                        : kind === "offcamera"
                          ? "Off camera"
                          : "Session"}
                    </ContextMenuItem>
                  ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          <ContextMenuItem onClick={() => flowActions.duplicate(id)}>
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem onClick={() => flowActions.disconnect(id)}>
            Remove its links
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => flowActions.remove([id])}
          >
            Delete
          </ContextMenuItem>
        </>
      ) : (
        <ContextMenuItem onClick={() => run(() => simulate(flow, target))}>
          Simulate every journey
        </ContextMenuItem>
      )}
    </>
  );
}
