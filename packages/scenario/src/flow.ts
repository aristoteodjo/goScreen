import { z } from "zod";
import {
  type Scenario,
  type Step,
  scenarioSchema,
  stepSchema,
} from "./scenario";

// A VSL drawn as a flow: a Start node (site, device, film), then scene,
// off-camera and session nodes joined by edges. Each path from Start to a
// leaf is one journey; a branch is a variant. Flows compile to scenarios,
// so the runner, the montage and the editor stay the same.

export const START = "start";

const position = z.object({ x: z.number(), y: z.number() });

export const flowNodeSchema = z
  .object({
    id: z
      .string()
      .regex(/^[\w-]+$/)
      .refine((id) => id !== START, { message: "reserved id" }),
    // scene: filmed, with its caption; offcamera: played, cut out of the
    // montage; session: switches to another account (its own cookies).
    kind: z.enum(["scene", "offcamera", "session"]),
    caption: z.string().default(""),
    session: z
      .string()
      .regex(/^[\w-]+$/)
      .optional(),
    steps: z.array(stepSchema).default([]),
    position,
  })
  .strict();

export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z
  .object({ id: z.string().min(1), source: z.string(), target: z.string() })
  .strict();

export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowStartSchema = scenarioSchema
  .omit({ version: true, name: true, steps: true })
  .extend({ position: position.default({ x: 0, y: 0 }) });

export type FlowStart = z.infer<typeof flowStartSchema>;

export const flowSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    start: flowStartSchema,
    nodes: z.array(flowNodeSchema),
    edges: z.array(flowEdgeSchema),
  })
  .strict();

export type Flow = z.infer<typeof flowSchema>;

export type ParsedFlow =
  | { ok: true; flow: Flow }
  | { ok: false; errors: string[] };

export function parseFlow(json: unknown): ParsedFlow {
  const parsed = flowSchema.safeParse(json);
  if (parsed.success) return { ok: true, flow: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) =>
      i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
    ),
  };
}

/** An empty VSL: the Start node and a first scene. */
export function newFlow(name: string, url: string, deviceId: string): Flow {
  return {
    version: 1,
    name,
    start: flowStartSchema.parse({ url, device: { id: deviceId } }),
    nodes: [
      {
        id: "scene-1",
        kind: "scene",
        caption: "First scene",
        steps: [{ do: "wait", ms: 2000 }],
        position: { x: 320, y: 0 },
      },
    ],
    edges: [{ id: "e-start-scene-1", source: START, target: "scene-1" }],
  };
}

const byY = (flow: Flow) => (a: string, b: string) => {
  const y = (id: string) =>
    flow.nodes.find((n) => n.id === id)?.position.y ?? 0;
  return y(a) - y(b);
};

/** Next nodes, top to bottom (the upper branch is the main journey). */
export function nextOf(flow: Flow, id: string): string[] {
  return flow.edges
    .filter((e) => e.source === id && flow.nodes.some((n) => n.id === e.target))
    .map((e) => e.target)
    .sort(byY(flow));
}

const MAX_PATHS = 64;

/**
 * Every journey: node ids from Start to a leaf, upper branches first. A loop
 * is cut where it would revisit a node of the same journey.
 */
export function flowPaths(flow: Flow, from: string = START): string[][] {
  const out: string[][] = [];
  const walk = (id: string, path: string[]) => {
    if (out.length >= MAX_PATHS) return;
    const next = nextOf(flow, id).filter((n) => !path.includes(n));
    if (next.length === 0) {
      if (path.length > 0) out.push(path);
      return;
    }
    for (const n of next) walk(n, [...path, n]);
  };
  walk(from, from === START ? [] : [from]);
  return out;
}

/** The first journey from Start that reaches `id` (for "simulate up to here"). */
export function pathTo(flow: Flow, id: string): string[] | null {
  const seen = new Set<string>();
  const walk = (at: string, path: string[]): string[] | null => {
    if (at === id) return path;
    for (const n of nextOf(flow, at)) {
      if (seen.has(n)) continue;
      seen.add(n);
      const found = walk(n, [...path, n]);
      if (found) return found;
    }
    return null;
  };
  return walk(START, []);
}

export function pathLabel(flow: Flow, path: string[]): string {
  const names = path
    .map((id) => flow.nodes.find((n) => n.id === id))
    .filter((n): n is FlowNode => n?.kind === "scene")
    .map((n) => n.caption || n.id);
  return names.length > 0 ? names.join(" → ") : "(no scene)";
}

export type Compiled = {
  scenario: Scenario;
  // The node each step comes from (null: added by the compiler).
  origins: (string | null)[];
};

function nodeSteps(node: FlowNode, session: (name: string) => string): Step[] {
  const head: Step[] =
    node.kind === "scene"
      ? [{ do: "scene", caption: node.caption || node.id }]
      : node.kind === "offcamera"
        ? [{ do: "cut" }]
        : [
            { do: "cut" },
            { do: "session", name: session(node.session ?? "main") },
          ];
  const body = node.steps.map((s) =>
    s.do === "session" ? { ...s, name: session(s.name) } : s,
  );
  return [...head, ...body];
}

/**
 * Journeys played one after another in one take: each one after the first
 * starts in fresh sessions (its own cookies) on the Start page, so variants
 * never share a login or a cart.
 */
export function compileFlow(flow: Flow, paths: string[][]): Compiled {
  const steps: Step[] = [];
  const origins: (string | null)[] = [];
  paths.forEach((path, k) => {
    const session = (name: string) =>
      k === 0
        ? name
        : name === "main"
          ? `path${k + 1}`
          : `path${k + 1}-${name}`;
    if (k > 0) {
      const reset: Step[] = [
        { do: "cut" },
        { do: "session", name: session("main") },
        { do: "goto", url: flow.start.url },
      ];
      steps.push(...reset);
      origins.push(...reset.map(() => null));
    }
    for (const id of path) {
      const node = flow.nodes.find((n) => n.id === id);
      if (!node) continue;
      const own = nodeSteps(node, session);
      steps.push(...own);
      origins.push(...own.map(() => id));
    }
  });
  const { position: _position, ...start } = flow.start;
  return {
    scenario: {
      ...start,
      version: 1,
      name: flow.name,
      steps: steps.length > 0 ? steps : [{ do: "wait", ms: 500 }],
    },
    origins,
  };
}

export type FlowIssue = { node: string; message: string };

/** What would make a journey fail or look wrong, per node. */
export function flowIssues(flow: Flow): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const reachable = new Set(flowPaths(flow).flat());
  for (const n of flow.nodes) {
    if (!reachable.has(n.id))
      issues.push({ node: n.id, message: "Not linked to Start" });
    if (n.kind === "scene" && !n.caption.trim())
      issues.push({ node: n.id, message: "Scene without caption" });
    if (n.kind === "session" && !n.session)
      issues.push({ node: n.id, message: "Session without a name" });
    if (n.kind !== "session" && n.steps.length === 0)
      issues.push({ node: n.id, message: "No step" });
  }
  if (flow.nodes.length === 0)
    issues.push({ node: START, message: "Add a first scene" });
  return issues;
}

/** Splits a scenario into nodes at each scene, cut and session. */
export function flowFromScenario(s: Scenario): Flow {
  const nodes: FlowNode[] = [];
  let current: FlowNode | null = null;
  const open = (kind: FlowNode["kind"], extra: Partial<FlowNode>) => {
    current = {
      id: `${kind}-${nodes.length + 1}`,
      kind,
      caption: "",
      steps: [],
      position: { x: 0, y: 0 },
      ...extra,
    };
    nodes.push(current);
    return current;
  };
  for (const step of s.steps) {
    if (step.do === "scene") open("scene", { caption: step.caption });
    else if (step.do === "cut") open("offcamera", {});
    else if (step.do === "session") open("session", { session: step.name });
    else (current ?? open("offcamera", {})).steps.push(step);
  }
  const edges: FlowEdge[] = nodes.map((n, i) => ({
    id: `e-${i}`,
    source: i === 0 ? START : nodes[i - 1].id,
    target: n.id,
  }));
  const { version: _v, name, steps: _s, ...start } = s;
  return layoutFlow({
    version: 1,
    name,
    start: { ...start, position: { x: 0, y: 0 } },
    nodes,
    edges,
  });
}

// Nodes are 224 px wide and at most ~110 px tall.
export const LAYOUT = {
  columns: 6,
  colWidth: 272,
  rowHeight: 140,
  bandGap: 70,
};

/**
 * Tidy layout: one column per depth from Start, branches stacked, and a long
 * journey wrapped into bands of `columns` steps, read like lines of text.
 */
export function layoutFlow(flow: Flow): Flow {
  const depth = new Map<string, number>([[START, 0]]);
  const queue = [START];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const n of nextOf(flow, id)) {
      if (depth.has(n)) continue;
      depth.set(n, (depth.get(id) ?? 0) + 1);
      queue.push(n);
    }
  }
  const orphanDepth = Math.max(0, ...depth.values()) + 1;
  const depthOf = (id: string) => depth.get(id) ?? orphanDepth;
  const { columns, colWidth, rowHeight, bandGap } = LAYOUT;
  const band = (d: number) => Math.floor(d / columns);

  const rowOf = new Map<string, number>();
  const used = new Map<number, number>();
  const tallest = new Map<number, number>([[0, 1]]);
  for (const n of flow.nodes) {
    const d = depthOf(n.id);
    const row = used.get(d) ?? 0;
    used.set(d, row + 1);
    rowOf.set(n.id, row);
    tallest.set(band(d), Math.max(tallest.get(band(d)) ?? 0, row + 1));
  }
  const top = new Map<number, number>();
  let y = 0;
  for (let b = 0; b <= band(orphanDepth); b++) {
    top.set(b, y);
    const rows = tallest.get(b) ?? 0;
    if (rows > 0) y += rows * rowHeight + bandGap;
  }
  const at = (d: number, row: number) => ({
    x: (d % columns) * colWidth,
    y: (top.get(band(d)) ?? 0) + row * rowHeight,
  });
  return {
    ...flow,
    start: { ...flow.start, position: at(0, 0) },
    nodes: flow.nodes.map((n) => ({
      ...n,
      position: at(depthOf(n.id), rowOf.get(n.id) ?? 0),
    })),
  };
}
