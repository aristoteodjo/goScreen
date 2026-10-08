import { createFileRoute } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useCapture } from "@/modules/recording/useCapture";
import { CommandPalette } from "@/modules/studio/components/CommandPalette";
import { Inspector } from "@/modules/studio/components/Inspector";
import { Stage } from "@/modules/studio/components/Stage";
import { StudioSidebar } from "@/modules/studio/components/StudioSidebar";
import { Toolbar } from "@/modules/studio/components/Toolbar";

export const Route = createFileRoute("/")({
  component: Studio,
});

function Studio() {
  const capture = useCapture();
  return (
    <SidebarProvider className="h-full min-h-0">
      <StudioSidebar />
      <SidebarInset className="flex min-h-0 min-w-0 flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          <Toolbar capture={capture} />
          <Stage />
        </div>
        <Inspector />
      </SidebarInset>
      <CommandPalette capture={capture} />
    </SidebarProvider>
  );
}
