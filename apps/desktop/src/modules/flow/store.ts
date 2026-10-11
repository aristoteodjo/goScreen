import {
  type Flow,
  type FlowNode,
  layoutFlow,
  START,
  type Step,
} from "@goscreen/scenario";
import { create } from "zustand";

// The VSL being edited. Every change marks it dirty; FlowPage saves it.
type FlowState = {
  flow: Flow | null;
  dirty: boolean;
  selected: string | null;
  // The node whose steps are being recorded on the live site.
  live: string | null;
  setLive: (id: string | null) => void;
  load: (flow: Flow) => void;
  saved: () => void;
  update: (change: (flow: Flow) => Flow) => void;
  select: (id: string | null) => void;
};

export const useFlowDoc = create<FlowState>((set) => ({
  flow: null,
  dirty: false,
  selected: null,
  live: null,
  setLive: (live) => set({ live }),
  load: (flow) => set({ flow, dirty: false, selected: null, live: null }),
  saved: () => set({ dirty: false }),
  update: (change) =>
    set((s) => (s.flow ? { flow: change(s.flow), dirty: true } : s)),
  select: (selected) => set({ selected }),
}));

const edit = (change: (flow: Flow) => Flow) =>
  useFlowDoc.getState().update(change);

const freshId = (flow: Flow, kind: FlowNode["kind"]) => {
  let n = flow.nodes.length + 1;
  while (flow.nodes.some((x) => x.id === `${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
};

const TEMPLATE: Record<FlowNode["kind"], Partial<FlowNode>> = {
  scene: { caption: "New scene", steps: [{ do: "wait", ms: 1500 }] },
  offcamera: { caption: "", steps: [{ do: "wait", ms: 500 }] },
  session: { caption: "", session: "second", steps: [] },
};

export const flowActions = {
  /** Adds a node; linked after `after` when given. Returns its id. */
  add(
    kind: FlowNode["kind"],
    position: { x: number; y: number },
    after?: string,
  ): string {
    let id = "";
    edit((flow) => {
      id = freshId(flow, kind);
      const node: FlowNode = {
        id,
        kind,
        caption: "",
        steps: [],
        position,
        ...TEMPLATE[kind],
      };
      return {
        ...flow,
        nodes: [...flow.nodes, node],
        edges: after
          ? [
              ...flow.edges,
              { id: `e-${after}-${id}`, source: after, target: id },
            ]
          : flow.edges,
      };
    });
    useFlowDoc.getState().select(id);
    return id;
  },

  /** A node after `from`, placed to its right (below if taken). */
  addAfter(kind: FlowNode["kind"], from: string) {
    const flow = useFlowDoc.getState().flow;
    if (!flow) return;
    const origin =
      from === START
        ? flow.start.position
        : (flow.nodes.find((n) => n.id === from)?.position ?? { x: 0, y: 0 });
    let y = origin.y;
    while (
      flow.nodes.some(
        (n) =>
          Math.abs(n.position.x - (origin.x + 320)) < 100 &&
          Math.abs(n.position.y - y) < 120,
      )
    )
      y += 200;
    return flowActions.add(kind, { x: origin.x + 320, y }, from);
  },

  patchNode(id: string, patch: Partial<FlowNode>) {
    edit((flow) => ({
      ...flow,
      nodes: flow.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
  },

  setSteps(id: string, steps: Step[]) {
    flowActions.patchNode(id, { steps });
  },

  move(id: string, position: { x: number; y: number }) {
    edit((flow) =>
      id === START
        ? { ...flow, start: { ...flow.start, position } }
        : {
            ...flow,
            nodes: flow.nodes.map((n) =>
              n.id === id ? { ...n, position } : n,
            ),
          },
    );
  },

  duplicate(id: string) {
    const flow = useFlowDoc.getState().flow;
    const node = flow?.nodes.find((n) => n.id === id);
    if (!flow || !node) return;
    const copy = flowActions.add(node.kind, {
      x: node.position.x + 40,
      y: node.position.y + 160,
    });
    flowActions.patchNode(copy, {
      caption: node.caption ? `${node.caption} (copy)` : "",
      session: node.session,
      steps: structuredClone(node.steps),
    });
  },

  remove(ids: string[]) {
    const drop = new Set(ids.filter((id) => id !== START));
    edit((flow) => ({
      ...flow,
      nodes: flow.nodes.filter((n) => !drop.has(n.id)),
      edges: flow.edges.filter(
        (e) => !drop.has(e.source) && !drop.has(e.target),
      ),
    }));
    const sel = useFlowDoc.getState().selected;
    if (sel && drop.has(sel)) useFlowDoc.getState().select(null);
  },

  connect(source: string, target: string) {
    if (source === target || target === START) return;
    edit((flow) =>
      flow.edges.some((e) => e.source === source && e.target === target)
        ? flow
        : {
            ...flow,
            edges: [
              ...flow.edges,
              { id: `e-${source}-${target}`, source, target },
            ],
          },
    );
  },

  removeEdges(ids: string[]) {
    const drop = new Set(ids);
    edit((flow) => ({
      ...flow,
      edges: flow.edges.filter((e) => !drop.has(e.id)),
    }));
  },

  disconnect(id: string) {
    edit((flow) => ({
      ...flow,
      edges: flow.edges.filter((e) => e.source !== id && e.target !== id),
    }));
  },

  layout() {
    edit(layoutFlow);
  },
};
