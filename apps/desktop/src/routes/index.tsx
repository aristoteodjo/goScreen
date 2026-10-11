import { createFileRoute } from "@tanstack/react-router";
import { ProjectsHome } from "@/modules/projects/ProjectsHome";

export const Route = createFileRoute("/")({
  component: ProjectsHome,
});
