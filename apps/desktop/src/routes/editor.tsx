import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { EditorPage } from "@/modules/editor/EditorPage";

const searchSchema = z.object({ video: z.string().min(1) });

export const Route = createFileRoute("/editor")({
  validateSearch: (search) => searchSchema.parse(search),
  component: Editor,
});

function Editor() {
  const { video } = Route.useSearch();
  // Keyed by file: opening another recording starts a fresh session.
  return <EditorPage key={video} video={video} />;
}
