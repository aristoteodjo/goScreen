import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ControlBridge } from "@/modules/control/ControlBridge";
import { TabBar } from "@/modules/tabs/TabBar";
import { TasksPanel } from "@/modules/tasks/TasksPanel";
import { useEffect } from "react";
import { ensureLocalModel } from "@/modules/motion/ipc";

/** The local model the person kept on starts with the app. */
function KeepLocalModel() {
  useEffect(() => {
    void ensureLocalModel().catch(() => {});
  }, []);
  return null;
}

export const Route = createRootRoute({
  component: () => (
    <div className="flex h-full flex-col">
      <TabBar />
      <div className="relative min-h-0 flex-1">
        <Outlet />
      </div>
      <TasksPanel />
      <ControlBridge />
      <KeepLocalModel />
    </div>
  ),
});
