import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_app/projects")({
  component: ProjectsPage,
});

function ProjectsPage() {
  return (
    <>
      <PageHeader title="Projects" description="Synced projects appear here. Recordings stay on your computer." />
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
        <HugeiconsIcon icon={Folder01Icon} size={28} strokeWidth={1.5} className="text-muted-foreground" />
        <p className="text-sm font-medium">No synced project yet</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Create a project in the goScreen desktop app. Only its metadata syncs here, and only when you turn sync on.
        </p>
      </div>
    </>
  );
}
