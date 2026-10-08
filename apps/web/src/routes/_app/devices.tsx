import { builtinPack } from "@goscreen/device-registry";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_app/devices")({
  component: DevicesPage,
});

const BRANDS = ["all", ...new Set(builtinPack.devices.map((d) => d.brand))];

function DevicesPage() {
  const [brand, setBrand] = useState("all");
  const devices = builtinPack.devices.filter((d) => brand === "all" || d.brand === brand);

  return (
    <>
      <PageHeader
        title="Devices"
        description="The builtin device pack shipped with the desktop app."
        action={
          <Select value={brand} onValueChange={setBrand}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BRANDS.map((b) => (
                <SelectItem key={b} value={b}>
                  {b === "all" ? "All brands" : b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <ul className="divide-y rounded-xl border">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center gap-4 px-4 py-3 text-sm">
            <span className="size-3 rounded-full" style={{ background: d.frame.colors[0].body }} />
            <span className="flex-1 font-medium">{d.name}</span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {d.viewport.width}x{d.viewport.height} @{d.viewport.dpr}x
            </span>
            {d.tier === "premium" ? <Badge variant="secondary">Pro</Badge> : null}
            {!d.verified ? <Badge variant="outline">Unverified</Badge> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
