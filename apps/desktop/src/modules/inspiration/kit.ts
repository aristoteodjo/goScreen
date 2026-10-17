import { blockById } from "@goscreen/blocks";
import {
  filmPatch,
  type Inspiration,
  type KitElement,
  kitOf,
  kitTimes,
} from "@goscreen/inspiration";
import { type EditState, sequenceDuration } from "@goscreen/render-engine";
import { filmSchema } from "@goscreen/scenario";
import { addBlock } from "@/modules/editor/blocks";
import { FILM_FONTS } from "@/modules/editor/filmFonts";

// An inspiration's graphic elements for one montage: its blocks filled with
// the prompt's words, in the colours the film has (or will have once it
// follows this inspiration), laid along the film in one undoable change.

const plain = (s: string | undefined) => (s ?? "").replace(/\*/g, "").trim();
const looksLikeUrl = (s: string) => /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s);

/** The kit as it would look in this montage. */
export function kitForEdit(edit: EditState, i: Inspiration): KitElement[] {
  const current = filmSchema.safeParse(edit.film?.settings ?? {});
  const film = filmSchema.parse({
    ...(current.success ? current.data : {}),
    ...filmPatch(i.direction, FILM_FONTS),
  });
  const eyebrow = plain(film.outro?.eyebrow);
  return kitOf(i, {
    brand: film.brand || undefined,
    tagline: plain(film.intro?.title) || undefined,
    url: looksLikeUrl(eyebrow) ? eyebrow : undefined,
    colors: { background: film.background, ink: film.ink, accent: film.accent },
  });
}

/**
 * Renders each element (headless Chrome, one after another) and adds it as a
 * block layer at its place in the film. Returns the new edit; the caller
 * applies it once, so ⌘Z removes the whole kit.
 */
export async function placeKit(
  videoPath: string,
  edit: EditState,
  kit: KitElement[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ edit: EditState; overlays: string[] }> {
  const timed = kit.map((k) => ({
    ...k,
    duration: blockById(k.block)?.duration ?? 3,
  }));
  const starts = kitTimes(timed, sequenceDuration(edit.clips));
  let next = edit;
  const overlays: string[] = [];
  for (const [n, k] of timed.entries()) {
    onProgress?.(n, timed.length);
    const result = await addBlock(videoPath, next, k.block, k.props, starts[n]);
    next = result.edit;
    overlays.push(result.overlay);
  }
  onProgress?.(timed.length, timed.length);
  return { edit: next, overlays };
}
