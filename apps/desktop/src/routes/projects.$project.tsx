import { createFileRoute } from "@tanstack/react-router";
import { ProjectPage } from "@/modules/projects/ProjectPage";

export const Route = createFileRoute("/projects/$project")({
  component: Project,
});

function Project() {
  const { project } = Route.useParams();
  return <ProjectPage key={project} project={project} />;
}
