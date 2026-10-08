import {
  CreditCardIcon,
  Folder01Icon,
  Logout01Icon,
  SmartPhone01Icon,
  UnfoldMoreIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type PlanId, PLAN_LABELS } from "@goscreen/entitlements";
import { useMutation } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth/client";
import type { SessionData } from "@/lib/auth/session";

const WORKSPACE = [
  { to: "/projects", label: "Projects", icon: Folder01Icon },
  { to: "/devices", label: "Devices", icon: SmartPhone01Icon },
] as const;

const SETTINGS = [
  { to: "/settings/account", label: "Account", icon: UserIcon },
  { to: "/settings/subscription", label: "Subscription", icon: CreditCardIcon },
] as const;

export function AppSidebar({ user }: { user: SessionData["user"] }) {
  const router = useRouter();
  const signOut = useMutation({
    mutationFn: async () => {
      const { data, error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign out failed.");
      return data;
    },
    onSuccess: async (data) => {
      if (!data?.success) {
        toast.error("Sign out did not complete.");
        return;
      }
      await router.invalidate();
      await router.navigate({ to: "/login" });
    },
    onError: (e) => toast.error(e.message),
  });

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader className="h-12 justify-center px-4">
        <span className="text-sm font-semibold tracking-tight">goScreen</span>
      </SidebarHeader>
      <SidebarContent>
        {[
          { label: "Workspace", items: WORKSPACE },
          { label: "Settings", items: SETTINGS },
        ].map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild>
                      <Link to={item.to} activeProps={{ "data-active": true }}>
                        <HugeiconsIcon icon={item.icon} strokeWidth={1.75} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <Avatar className="size-8 rounded-lg">
                    {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
                    <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {PLAN_LABELS[user.plan as PlanId] ?? "Free"}
                    </span>
                  </div>
                  <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={signOut.isPending} onSelect={() => signOut.mutate()}>
                  <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.75} />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
