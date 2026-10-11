import { Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A docked panel, Premiere style: a row of tab names, the active one
// underlined with its panel menu, then the panel's body.

export function PanelFrame<T extends string>({
  tabs,
  active,
  onTab,
  menu,
  actions,
  children,
  className,
  bodyClassName,
  ai,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onTab?: (id: T) => void;
  menu?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  // Where the AI's cursor can point (data-ai).
  ai?: string;
}) {
  return (
    <section
      data-ai={ai}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col bg-[var(--panel)]",
        className,
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab?.(t.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] whitespace-nowrap transition-colors",
              t.id === active
                ? "text-foreground underline decoration-1 underline-offset-[5px]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.id === active && menu === undefined ? (
              <HugeiconsIcon icon={Menu01Icon} size={13} strokeWidth={1.75} />
            ) : null}
          </button>
        ))}
        {menu}
        {actions ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {actions}
          </div>
        ) : null}
      </header>
      <div className={cn("relative min-h-0 flex-1", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
