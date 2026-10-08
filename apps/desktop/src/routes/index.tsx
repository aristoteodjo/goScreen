import { createFileRoute } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAndroidSync } from "@/modules/android/useAndroid";
import { CanvasRoot } from "@/modules/canvas/CanvasRoot";
import { CaptureBar } from "@/modules/recording/CaptureBar";
import { SiteTourDialog } from "@/modules/tour/SiteTourDialog";
import { useCapture } from "@/modules/recording/useCapture";
import { CommandPalette } from "@/modules/studio/components/CommandPalette";
import { Inspector } from "@/modules/studio/components/Inspector";
import { Stage } from "@/modules/studio/components/Stage";
import { StudioSidebar } from "@/modules/studio/components/StudioSidebar";
import { Toolbar } from "@/modules/studio/components/Toolbar";
import { useEditor } from "@/modules/studio/store/editor";
import { useBridgeWiring } from "@/modules/studio/useBridgeWiring";

export const Route = createFileRoute("/")({
  component: Studio,
});

function Studio() {
  const capture = useCapture();
  const view = useEditor((s) => s.view);
  useBridgeWiring();
  useAndroidSync();

  return (
    <SidebarProvider className="h-full min-h-0">
      <StudioSidebar />
      <SidebarInset className="flex min-h-0 min-w-0 flex-row">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Toolbar capture={capture} />
          {view === "canvas" ? <CanvasRoot /> : <Stage />}
          <CaptureBar capture={capture} />
        </div>
        <Inspector />
      </SidebarInset>
      <CommandPalette capture={capture} />
      <SiteTourDialog capture={capture} />
    </SidebarProvider>
  );
}
