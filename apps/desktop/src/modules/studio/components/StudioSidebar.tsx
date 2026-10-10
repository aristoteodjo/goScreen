import {
  ComputerIcon,
  Delete02Icon,
  LaptopIcon,
  SmartPhone01Icon,
  Tablet01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { registry } from "@/lib/registry";
import { AndroidPanel } from "@/modules/android/AndroidPanel";
import { canvasCommands } from "@/modules/canvas/commands";
import { RecordingsPanel } from "@/modules/recording/RecordingsPanel";
import { useEditor } from "../store/editor";
import { useProject } from "../store/project";

const CATEGORIES = [
  { id: "phone", label: "Phones", icon: SmartPhone01Icon },
  { id: "tablet", label: "Tablets", icon: Tablet01Icon },
  { id: "laptop", label: "Laptops", icon: LaptopIcon },
  { id: "desktop", label: "Desktops", icon: ComputerIcon },
] as const;

const groups = CATEGORIES.map((c) => ({
  ...c,
  devices: registry.list().filter((d) => d.category === c.id),
})).filter((g) => g.devices.length > 0);

const iconFor = (category: string) =>
  CATEGORIES.find((c) => c.id === category)?.icon ?? SmartPhone01Icon;

export function StudioSidebar() {
  const devices = useProject((s) => s.devices);
  const addDevice = useProject((s) => s.addDevice);
  const removeDevice = useProject((s) => s.removeDevice);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader data-tauri-drag-region className="h-12 justify-end pl-20">
        <span
          data-tauri-drag-region
          className="text-[13px] font-semibold tracking-tight"
        >
          goScreen
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Scene</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {devices.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  No device yet.
                </p>
              ) : null}
              {devices.map((d) => {
                const def = registry.get(d.deviceId);
                return (
                  <SidebarMenuItem key={d.id}>
                    <SidebarMenuButton
                      isActive={d.id === selectedId}
                      onClick={() => {
                        select(d.id);
                        if (useEditor.getState().view === "canvas")
                          canvasCommands.focus(d.id);
                      }}
                    >
                      <HugeiconsIcon
                        icon={iconFor(def?.category ?? "phone")}
                        strokeWidth={1.75}
                      />
                      <span>{def?.name ?? d.deviceId}</span>
                      {d.source.kind === "android" ? (
                        <span
                          className="ml-auto size-1.5 shrink-0 rounded-full bg-emerald-400"
                          aria-hidden="true"
                        />
                      ) : null}
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      onClick={() => removeDevice(d.id)}
                      aria-label="Remove device"
                    >
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.75} />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <AndroidPanel />
        <RecordingsPanel />
        {groups.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.devices.map((device) => (
                  <SidebarMenuItem key={device.id}>
                    <SidebarMenuButton
                      onClick={() => {
                        const id = addDevice(device.id);
                        if (id) select(id);
                      }}
                    >
                      <HugeiconsIcon icon={group.icon} strokeWidth={1.75} />
                      <span>{device.name}</span>
                    </SidebarMenuButton>
                    {device.tier === "premium" ? (
                      <SidebarMenuBadge>Pro</SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
