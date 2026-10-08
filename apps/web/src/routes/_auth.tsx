import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth/session";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => {
    if (await getSession()) throw redirect({ to: "/projects" });
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-between p-8">
        <span className="text-sm font-semibold tracking-tight">goScreen</span>
        <div className="mx-auto w-full max-w-sm py-12">
          <Outlet />
        </div>
        <span className="text-xs text-muted-foreground">Local-first. Your recordings never leave your machine unless you share them.</span>
      </div>
      <div
        className="relative hidden overflow-hidden lg:block"
        style={{ background: "linear-gradient(135deg, #ff7a45, #7a1fd6)" }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-[560px] w-[270px] rounded-[44px] border-[10px] border-black/80 bg-white/90 shadow-[0_40px_80px_rgba(0,0,0,0.45)]" />
        </div>
        <p className="absolute bottom-10 left-10 max-w-sm text-2xl font-semibold leading-tight text-white">
          Turn any web experience into a cinematic product video.
        </p>
      </div>
    </div>
  );
}
