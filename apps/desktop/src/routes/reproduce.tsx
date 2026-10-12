import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ReproduceHome } from "@/modules/motion/ReproduceHome";
import { ReproducePage } from "@/modules/motion/ReproducePage";

const searchSchema = z.object({ reference: z.string().min(1).optional() });

export const Route = createFileRoute("/reproduce")({
  validateSearch: (search) => searchSchema.parse(search),
  component: Reproduce,
});

function Reproduce() {
  const { reference } = Route.useSearch();
  return reference ? <ReproducePage key={reference} id={reference} /> : <ReproduceHome />;
}
