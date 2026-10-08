import { Delete02Icon, SmartPhone01Icon, Tablet01Icon } from "@hugeicons/core-free-icons";
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
import { useEditor } from "../store/editor";
import { useProject } from "../store/project";

const brands = [...new Set(registry.list().map((d) => d.brand))].map(
  (brand) => [brand, registry.list().filter((d) => d.brand === brand)] as const,
);

export function StudioSidebar() {
  const devices = useProject((s) => s.devices);
  const addDevice = useProject((s) => s.addDevice);
  const removeDevice = useProject((s) => s.removeDevice);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader data-tauri-drag-region className="h-12 justify-end pl-20">
        <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight">
          goScreen
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Scene</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {devices.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No device yet.</p>
              ) : null}
              {devices.map((d) => {
                const def = registry.get(d.deviceId);
                return (
                  <SidebarMenuItem key={d.id}>
                    <SidebarMenuButton isActive={d.id === selectedId} onClick={() => select(d.id)}>
                      <HugeiconsIcon icon={SmartPhone01Icon} strokeWidth={1.75} />
                      <span>{def?.name ?? d.deviceId}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction showOnHover onClick={() => removeDevice(d.id)} aria-label="Remove device">
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.75} />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {brands.map(([brand, list]) => (
          <SidebarGroup key={brand}>
            <SidebarGroupLabel>{brand}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {list.map((device) => (
                  <SidebarMenuItem key={device.id}>
                    <SidebarMenuButton
                      onClick={() => {
                        const id = addDevice(device.id);
                        if (id) select(id);
                      }}
                    >
                      <HugeiconsIcon
                        icon={device.category === "tablet" ? Tablet01Icon : SmartPhone01Icon}
                        strokeWidth={1.75}
                      />
                      <span>{device.name}</span>
                    </SidebarMenuButton>
                    {device.tier === "premium" ? <SidebarMenuBadge>Pro</SidebarMenuBadge> : null}
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
