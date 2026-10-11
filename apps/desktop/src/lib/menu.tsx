import type { ReactElement } from "react";
import { ContextMenuTrigger } from "@/components/ui/context-menu";

/** Right-click target: Base UI takes the element through `render`. */
export function MenuTrigger({ children }: { children: ReactElement }) {
  return <ContextMenuTrigger render={children} />;
}
