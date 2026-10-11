import { describe, expect, it } from "vitest";
import {
  compileFlow,
  EXAMPLE_SCENARIO,
  type Flow,
  flowFromScenario,
  flowIssues,
  flowPaths,
  LAYOUT,
  layoutFlow,
  newFlow,
  parseFlow,
  parseScenario,
  pathLabel,
  pathTo,
  START,
} from "./index";

// Start -> A -> B (top) -> C
//               \-> D (bottom, a variant)
function branching(): Flow {
  const f = newFlow("Demo", "https://x.test/", "galaxy-s25");
  const node = (
    id: string,
    y: number,
    kind: "scene" | "offcamera" | "session" = "scene",
  ) => ({
    id,
    kind,
    caption: kind === "scene" ? id.toUpperCase() : "",
    steps: [{ do: "wait" as const, ms: 100 }],
    position: { x: 0, y },
  });
  f.nodes = [node("a", 0), node("b", 0), node("c", 0), node("d", 200)];
  f.edges = [
    { id: "1", source: START, target: "a" },
    { id: "2", source: "a", target: "d" },
    { id: "3", source: "a", target: "b" },
    { id: "4", source: "b", target: "c" },
  ];
  return f;
}

describe("flow paths", () => {
  it("lists every journey, upper branch first", () => {
    expect(flowPaths(branching())).toEqual([
      ["a", "b", "c"],
      ["a", "d"],
    ]);
  });

  it("cuts loops instead of running forever", () => {
    const f = branching();
    f.edges.push({ id: "5", source: "c", target: "a" });
    expect(flowPaths(f)).toEqual([
      ["a", "b", "c"],
      ["a", "d"],
    ]);
  });

  it("finds the way to a node and names a journey by its scenes", () => {
    const f = branching();
    expect(pathTo(f, "d")).toEqual(["a", "d"]);
    expect(pathTo(f, "nowhere")).toBeNull();
    expect(pathLabel(f, ["a", "d"])).toBe("A → D");
  });
});

describe("compileFlow", () => {
  it("turns nodes into scenes, cuts and sessions, step by step", () => {
    const f = branching();
    f.nodes[1] = { ...f.nodes[1], kind: "offcamera", caption: "" };
    f.nodes[2] = {
      ...f.nodes[2],
      kind: "session",
      session: "seller",
      caption: "",
    };
    const { scenario, origins } = compileFlow(f, [["a", "b", "c"]]);
    expect(scenario.steps.map((s) => s.do)).toEqual([
      "scene",
      "wait",
      "cut",
      "wait",
      "cut",
      "session",
      "wait",
    ]);
    expect(origins).toEqual(["a", "a", "b", "b", "c", "c", "c"]);
    expect(parseScenario(JSON.stringify(scenario)).ok).toBe(true);
  });

  it("plays each further journey in fresh sessions from the Start page", () => {
    const f = branching();
    f.nodes[3] = { ...f.nodes[3], steps: [{ do: "session", name: "seller" }] };
    const { scenario, origins } = compileFlow(f, flowPaths(f));
    const second = scenario.steps.slice(6);
    expect(second.slice(0, 3)).toEqual([
      { do: "cut" },
      { do: "session", name: "path2" },
      { do: "goto", url: "https://x.test/" },
    ]);
    expect(second).toContainEqual({ do: "session", name: "path2-seller" });
    expect(origins.slice(6, 9)).toEqual([null, null, null]);
    expect(origins).toHaveLength(scenario.steps.length);
  });
});

describe("checks, import and layout", () => {
  it("flags unlinked, unnamed and empty nodes", () => {
    const f = branching();
    f.nodes.push({
      id: "z",
      kind: "scene",
      caption: "",
      steps: [],
      position: { x: 0, y: 0 },
    });
    const issues = flowIssues(f)
      .filter((i) => i.node === "z")
      .map((i) => i.message);
    expect(issues).toEqual([
      "Not linked to Start",
      "Scene without caption",
      "No step",
    ]);
  });

  it("imports a scenario as a chain that compiles back to the same steps", () => {
    const parsed = parseScenario(JSON.stringify(EXAMPLE_SCENARIO));
    if (!parsed.ok) throw new Error("bad example");
    const flow = flowFromScenario(parsed.scenario);
    expect(flow.nodes.map((n) => n.kind)).toEqual([
      "offcamera",
      "scene",
      "scene",
    ]);
    const back = compileFlow(flow, flowPaths(flow)).scenario;
    expect(back.steps.slice(1)).toEqual(parsed.scenario.steps);
    expect(parseFlow(JSON.parse(JSON.stringify(flow))).ok).toBe(true);
  });

  it("lays nodes out by depth, branches stacked", () => {
    const laid = layoutFlow(branching());
    const at = (id: string) => laid.nodes.find((n) => n.id === id)?.position;
    expect(at("a")).toEqual({ x: LAYOUT.colWidth, y: 0 });
    expect(at("c")).toEqual({ x: 3 * LAYOUT.colWidth, y: 0 });
    expect([at("b")?.y, at("d")?.y].sort()).toEqual([0, LAYOUT.rowHeight]);
  });

  it("wraps a long journey into bands, below the tallest branch", () => {
    const f = branching();
    const extra = Array.from({ length: 4 }, (_, i) => ({
      id: `x${i}`,
      kind: "scene" as const,
      caption: `X${i}`,
      steps: [{ do: "wait" as const, ms: 100 }],
      position: { x: 0, y: 0 },
    }));
    f.nodes.push(...extra);
    f.edges.push(
      ...extra.map((n, i) => ({
        id: `x-${i}`,
        source: i === 0 ? "c" : `x${i - 1}`,
        target: n.id,
      })),
    );
    const laid = layoutFlow(f);
    const at = (id: string) => laid.nodes.find((n) => n.id === id)?.position;
    // c is at depth 3, so x1 (depth 5) ends the first band and x2 opens the next.
    expect(at("x1")).toEqual({ x: 5 * LAYOUT.colWidth, y: 0 });
    const second = 2 * LAYOUT.rowHeight + LAYOUT.bandGap;
    expect(at("x2")).toEqual({ x: 0, y: second });
    expect(at("x3")).toEqual({ x: LAYOUT.colWidth, y: second });
  });

  it("lays out an imported scenario", () => {
    const f = flowFromScenario({
      version: 1,
      ...newFlow("Demo", "https://x.test/", "galaxy-s25").start,
      name: "Demo",
      steps: [
        { do: "scene", caption: "A" },
        { do: "wait", ms: 10 },
        { do: "scene", caption: "B" },
        { do: "wait", ms: 10 },
      ],
    } as never);
    expect(f.nodes.map((n) => n.position.x)).toEqual([
      LAYOUT.colWidth,
      2 * LAYOUT.colWidth,
    ]);
  });

  it("refuses a flow with a broken step, naming where", () => {
    const f = JSON.parse(JSON.stringify(branching()));
    f.nodes[0].steps = [{ do: "tap" }];
    const r = parseFlow(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^nodes\.0\.steps\.0/);
  });
});
