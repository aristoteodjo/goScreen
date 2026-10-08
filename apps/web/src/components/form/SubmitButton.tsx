import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useFormContext } from "./context";

// `pending` comes from the mutation's isPending, never from local state.
export function SubmitButton({ children, pending }: { children: ReactNode; pending: boolean }) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(s) => s.canSubmit}>
      {(canSubmit) => (
        <Button type="submit" className="w-full" disabled={!canSubmit || pending}>
          {pending ? <Spinner /> : null}
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}
