import {
  ASPECTS,
  briefOf,
  CATEGORIES,
  GENRES,
  genresForRecipe,
  type Inspiration,
  search,
  TECHNIQUES,
} from "@goscreen/inspiration";
import type { EditState } from "@goscreen/render-engine";
import { z } from "zod";
import { defineCommand } from "@/modules/control/registry";
import { loadInspirations, syncInspirations, withInspiration } from "./library";

// The inspiration library for an AI: find a direction that fits the film,
// read its brief (credit, format, palette, structure, banned moves and the
// studio tool for each technique), then set the film in it.

type EditAccess = {
  currentEdit: (video: string) => Promise<EditState>;
  applyEdit: (video: string, edit: EditState) => Promise<void>;
};

const slug = z
  .string()
  .regex(/^[\w-]+$/)
  .describe("Inspiration slug (inspiration.search)");

const summary = (i: Inspiration) => ({
  slug: i.slug,
  author: i.author,
  category: i.category,
  post: i.post_url,
  partial: i.prompt_partial,
  aspect: i.direction.aspect,
  duration: i.direction.duration,
  bpm: i.direction.bpm,
  palette: i.direction.palette.map((s) => s.hex),
  genres: i.direction.genres,
  techniques: i.direction.techniques,
  opening: i.prompt.slice(0, 240),
});

async function library() {
  const all = await loadInspirations();
  if (all.length === 0)
    throw new Error(
      "The inspiration library is not downloaded yet. Run inspiration.sync first.",
    );
  return all;
}

async function find(s: string) {
  const found = (await library()).find((i) => i.slug === s);
  if (!found) throw new Error(`No inspiration "${s}". Use inspiration.search.`);
  return found;
}

export function registerInspirationCommands({
  currentEdit,
  applyEdit,
}: EditAccess) {
  defineCommand({
    name: "inspiration.sync",
    title: "Download the inspiration library",
    description:
      "Downloads the latest community list of videos made as code with their prompts (about 700, MIT). Needed once before the other inspiration commands.",
    input: z.object({}),
    run: async () => ({ prompts: await syncInspirations() }),
  });
  defineCommand({
    name: "inspiration.search",
    title: "Find an inspiration",
    description:
      "Searches the inspiration library by words, category, genre (launch, ad, explainer, demo, kinetic-type, brand, data, game, art), technique (beat-sync, cursor, camera-zoom, kinetic-type, counter, device…) and format. `recipe` (a campaign recipe id such as product-launch) picks the genres of that kind of film. Returns short summaries; read one with inspiration.brief.",
    input: z.object({
      text: z.string().optional(),
      category: z.enum(CATEGORIES).optional(),
      genres: z.array(z.enum(GENRES)).optional(),
      techniques: z.array(z.enum(TECHNIQUES)).optional(),
      aspect: z.enum(ASPECTS).optional(),
      recipe: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    run: async ({ recipe, ...q }) => {
      const genres = [
        ...(q.genres ?? []),
        ...(recipe ? genresForRecipe(recipe) : []),
      ];
      return search(await library(), { ...q, genres }).map(summary);
    },
  });
  defineCommand({
    name: "inspiration.brief",
    title: "Read an inspiration's brief",
    description:
      "The creative brief of one inspiration, in Markdown: credit and original post, format, length, tempo, palette, type, banned moves, scene structure, which goScreen tool does each technique (and which are not available, never to be faked), then the full prompt. Follow it when building the film; credit the creator.",
    input: z.object({ slug }),
    run: async ({ slug: s }) => ({ brief: briefOf(await find(s)) }),
  });
  defineCommand({
    name: "inspiration.apply",
    title: "Use an inspiration as the film's direction",
    description:
      "Sets a montage's film in the inspiration's format, colours and font (only what its prompt gives) and remembers it for credit. A video that is not a film yet becomes one. Undoable by the person (⌘Z).",
    input: z.object({
      video: z
        .string()
        .min(1)
        .describe("Absolute path of a video (projects.videos)"),
      slug,
    }),
    run: async ({ video, slug: s }) => {
      const i = await find(s);
      const next = withInspiration(await currentEdit(video), i);
      await applyEdit(video, next);
      return { film: next.film?.settings ?? null };
    },
  });
}
