import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TasksPanel } from "@/modules/tasks/TasksPanel";

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <TasksPanel />
    </>
  ),
});
