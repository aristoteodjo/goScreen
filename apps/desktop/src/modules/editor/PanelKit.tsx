import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useEdit } from "./store";

export function Section({ title, hint, children, aside }: { title: string; hint?: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-white/5 py-4 first:pt-0 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium">{title}</h3>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const useChange = () => useEdit((s) => s.change);

export function SliderRow({
  value,
  min,
  max,
  step,
  format,
  onChange,
  onReset,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} className="flex-1" />
      <span className="w-10 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{format(value)}</span>
      {onReset ? (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground" onClick={onReset}>
          Reset
        </Button>
      ) : null}
    </div>
  );
}

