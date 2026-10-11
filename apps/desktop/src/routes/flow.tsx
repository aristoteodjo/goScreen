import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FlowPage } from "@/modules/flow/FlowPage";

const searchSchema = z.object({
  project: z.string().min(1),
  vsl: z.string().min(1),
});

export const Route = createFileRoute("/flow")({
  validateSearch: (search) => searchSchema.parse(search),
  component: Flow,
});

function Flow() {
  const { project, vsl } = Route.useSearch();
  return <FlowPage key={`${project}/${vsl}`} project={project} vsl={vsl} />;
}
