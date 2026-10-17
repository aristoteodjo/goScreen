import { z } from "zod";

// The inspiration library: videos made by asking a model to write the
// animation as code, each with the prompt its creator shared. It is read from
// the community list's `data/videos.json`; every entry keeps its author and
// the link to the original post, so credit travels with the idea.

export const LIBRARY_URL =
  "https://raw.githubusercontent.com/yihui-dev/awesome-opus5-5-videos/main/data/videos.json";
export const LIBRARY_HOME =
  "https://github.com/yihui-dev/awesome-opus5-5-videos";

export const CATEGORIES = ["motion", "explainer", "3d", "interactive"] as const;
export type Category = (typeof CATEGORIES)[number];

export const entrySchema = z.object({
  slug: z.string().regex(/^[\w-]+$/),
  author: z.string().min(1),
  author_url: z.string().url().catch(""),
  post_url: z.string().url().catch(""),
  category: z.enum(CATEGORIES).catch("motion"),
  tech_tags: z.array(z.string()).catch([]),
  prompt: z.string().min(1),
  // The creator shared only part of the prompt, or only described the result.
  prompt_partial: z.boolean().catch(false),
  poster_url: z.string().url().nullable().catch(null),
  skillry_url: z.string().url().nullable().catch(null),
  added: z.string().catch(""),
  has_remake: z.boolean().catch(false),
});

export type Entry = z.infer<typeof entrySchema>;

/** Entry by entry: a broken entry is dropped alone, never the whole list. */
export function parseLibrary(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const item of raw) {
    const parsed = entrySchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.slug)) continue;
    seen.add(parsed.data.slug);
    out.push(parsed.data);
  }
  return out;
}
