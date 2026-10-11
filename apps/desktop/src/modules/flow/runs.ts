import {
  compileFlow,
  type Flow,
  flowPaths,
  pathLabel,
  resolveVars,
} from "@goscreen/scenario";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { enqueue } from "@/modules/tasks/queue";

// Values asked by a VSL ({{buyerPhone}}...), kept per VSL on this machine.
// Secret ones are never stored.
type Values = {
  byVsl: Record<string, Record<string, string>>;
  set: (key: string, name: string, value: string) => void;
};

export const useFlowValues = create<Values>()(
  persist(
    (set) => ({
      byVsl: {},
      set: (key, name, value) =>
        set((s) => ({
          byVsl: { ...s.byVsl, [key]: { ...s.byVsl[key], [name]: value } },
        })),
    }),
    {
      name: "goscreen.flow-values",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export const valuesKey = (project: string, vsl: string) => `${project}/${vsl}`;

/** Secret values live in memory only, for this session. */
const secrets = new Map<string, Record<string, string>>();

export function setValue(flow: Flow, key: string, name: string, value: string) {
  if (flow.start.vars[name]?.secret)
    secrets.set(key, { ...secrets.get(key), [name]: value });
  else useFlowValues.getState().set(key, name, value);
}

export function valuesOf(key: string): Record<string, string> {
  return { ...useFlowValues.getState().byVsl[key], ...secrets.get(key) };
}

type Target = { project: string; vsl: string };

function resolved(flow: Flow, paths: string[][], key: string) {
  const { scenario, origins } = compileFlow(flow, paths);
  const r = resolveVars(scenario, valuesOf(key));
  if (!r.ok)
    throw new Error(`Fill in the values first: ${r.missing.join(", ")}.`);
  return { scenario: r.scenario, origins };
}

/** One simulation per journey (no video), each in its own task. */
export function simulate(flow: Flow, target: Target, paths = flowPaths(flow)) {
  if (paths.length === 0) throw new Error("Link a scene to Start first.");
  const key = valuesKey(target.project, target.vsl);
  const runs = paths.map((path) => ({ path, ...resolved(flow, [path], key) }));
  for (const run of runs)
    enqueue({
      kind: "simulate",
      label: `${flow.name} · ${pathLabel(flow, run.path)}`,
      scenario: run.scenario,
      origins: run.origins,
      ...target,
    });
}

/** The chosen journeys, back to back, in one take and one montage. */
export function record(flow: Flow, target: Target, paths = flowPaths(flow)) {
  if (paths.length === 0) throw new Error("Link a scene to Start first.");
  const { scenario, origins } = resolved(
    flow,
    paths,
    valuesKey(target.project, target.vsl),
  );
  enqueue({
    kind: "record",
    label: flow.name,
    scenario,
    origins,
    ...target,
  });
}
