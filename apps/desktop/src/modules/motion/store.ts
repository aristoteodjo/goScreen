import { queryClient } from "@/lib/queryClient";

export const motionKeys = {
  all: ["motion"] as const,
  references: () => ["motion", "references"] as const,
  spec: (id: string) => ["motion", id, "spec"] as const,
  report: (id: string) => ["motion", id, "report"] as const,
  training: () => ["motion", "training"] as const,
  localAi: () => ["motion", "local-ai"] as const,
};

/** After an AI or a step changed files: every motion view reads again. */
export const refreshMotion = () =>
  queryClient.invalidateQueries({ queryKey: motionKeys.all });
