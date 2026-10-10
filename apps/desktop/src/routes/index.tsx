import { createFileRoute } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAndroidSync } from "@/modules/android/useAndroid";
import { CanvasRoot } from "@/modules/canvas/CanvasRoot";
import { CaptureBar } from "@/modules/recording/CaptureBar";
import { LiveCamera } from "@/modules/recording/LiveCamera";
import { useCapture } from "@/modules/recording/useCapture";
import { bindCapture } from "@/modules/studio/actions";
import { CommandPalette } from "@/modules/studio/components/CommandPalette";
import { Inspector } from "@/modules/studio/components/Inspector";
import { StudioSidebar } from "@/modules/studio/components/StudioSidebar";
import { Toolbar } from "@/modules/studio/components/Toolbar";
import { useBridgeWiring } from "@/modules/studio/useBridgeWiring";
import { SiteTourDialog } from "@/modules/tour/SiteTourDialog";

export const Route = createFileRoute("/")({
  component: Studio,
});

function Studio() {
  const capture = useCapture();
  bindCapture(capture);
  useBridgeWiring();
  useAndroidSync();

  return (
    <SidebarProvider className="h-full min-h-0">
      <StudioSidebar />
      <SidebarInset className="flex min-h-0 min-w-0 flex-row">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Toolbar capture={capture} />
          <div className="relative flex min-h-0 flex-1 flex-col">
            <CanvasRoot />
            <LiveCamera />
          </div>
          <CaptureBar capture={capture} />
        </div>
        <Inspector />
      </SidebarInset>
      <CommandPalette capture={capture} />
      <SiteTourDialog capture={capture} />
    </SidebarProvider>
  );
}
