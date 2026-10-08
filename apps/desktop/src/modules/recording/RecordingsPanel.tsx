import { Video01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ipc } from "@/lib/ipc";

const shown = 5;
const when = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// Past captures, reopened in the editor with their saved edits.
export function RecordingsPanel() {
  const navigate = useNavigate();
  const recordings = useQuery({ queryKey: ["recordings"], queryFn: ipc.recordingsList, staleTime: 10_000 });
  if (!recordings.data || recordings.data.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Recordings</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {recordings.data.slice(0, shown).map((r) => (
            <SidebarMenuItem key={r.path}>
              <SidebarMenuButton onClick={() => navigate({ to: "/editor", search: { video: r.path } })}>
                <HugeiconsIcon icon={Video01Icon} strokeWidth={1.75} />
                <span>{when.format(r.modifiedMs)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
