import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ControlBridge } from "@/modules/control/ControlBridge";
import { TasksPanel } from "@/modules/tasks/TasksPanel";

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <TasksPanel />
      <ControlBridge />
    </>
  ),
});
