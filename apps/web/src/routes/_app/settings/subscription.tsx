import {
  canCreateShareLink,
  canExport4K,
  canSyncProject,
  canUsePremiumDevice,
  canUseTeamWorkspace,
  entitlementsFor,
  PLAN_LABELS,
  type PlanId,
} from "@goscreen/entitlements";
import { CheckmarkCircle02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_app/settings/subscription")({
  component: SubscriptionPage,
});

const PRICES = { monthly: "$19 / month", yearly: "$149 / year" } as const;

function SubscriptionPage() {
  const { session } = Route.useRouteContext();
  const plan = (session.user.plan in PLAN_LABELS ? session.user.plan : "free") as PlanId;
  const e = entitlementsFor(plan);
  const [cycle, setCycle] = useState<keyof typeof PRICES>("yearly");

  const rows = [
    { label: `Export up to ${e.maxResolution}`, ok: canExport4K(e) },
    { label: e.watermark ? "Watermark on exports" : "No watermark", ok: !e.watermark },
    { label: e.maxProjects === null ? "Unlimited projects" : `${e.maxProjects} projects`, ok: e.maxProjects === null },
    { label: "Premium devices", ok: canUsePremiumDevice(e) },
    { label: "Cloud sync", ok: canSyncProject(e) },
    { label: "Share links", ok: canCreateShareLink(e) },
    { label: "Team workspace", ok: canUseTeamWorkspace(e) },
  ];

  return (
    <>
      <PageHeader title="Subscription" description="One product, a few simple plans." />
      <section className="mb-10 flex items-center justify-between rounded-xl border p-5">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Current plan</p>
          <p className="text-lg font-semibold">{PLAN_LABELS[plan]}</p>
        </div>
        <Badge variant={plan === "free" ? "outline" : "secondary"}>{plan === "free" ? "Free forever" : "Active"}</Badge>
      </section>

      <ul className="mb-10 grid gap-2.5 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2.5 text-sm">
            <HugeiconsIcon
              icon={r.ok ? CheckmarkCircle02Icon : Cancel01Icon}
              size={16}
              className={r.ok ? "text-signal" : "text-muted-foreground"}
            />
            <span className={r.ok ? "" : "text-muted-foreground"}>{r.label}</span>
          </li>
        ))}
      </ul>

      {plan === "free" ? (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-signal/40 bg-signal/5 p-5">
          <div className="flex-1 space-y-1">
            <p className="font-medium">goScreen Pro</p>
            <p className="text-sm text-muted-foreground">4K, no watermark, sync and share links.</p>
          </div>
          <Select value={cycle} onValueChange={(v) => setCycle(v as keyof typeof PRICES)}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">{PRICES.monthly}</SelectItem>
              <SelectItem value="yearly">{PRICES.yearly}</SelectItem>
            </SelectContent>
          </Select>
          <Button className="bg-signal text-signal-foreground hover:bg-signal/90" disabled>
            Upgrade (soon)
          </Button>
        </section>
      ) : null}
    </>
  );
}
