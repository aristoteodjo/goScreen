import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { getSession } from "@/lib/auth/session";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/login", });
    return { session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { session } = Route.useRouteContext();
  return (
    <SidebarProvider>
      <AppSidebar user={session.user} />
      <SidebarInset>
        <header className="flex h-12 items-center border-b px-3">
          <SidebarTrigger />
        </header>
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
