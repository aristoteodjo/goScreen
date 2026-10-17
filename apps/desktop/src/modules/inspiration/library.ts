import {
  filmPatch,
  type Inspiration,
  parseLibrary,
  withDirections,
} from "@goscreen/inspiration";
import type { EditState } from "@goscreen/render-engine";
import { adoptFilm, applyFilm, filmSchema } from "@goscreen/scenario";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { z } from "zod";
import { queryClient } from "@/lib/queryClient";
import { FILM_FONTS } from "@/modules/editor/filmFonts";

// The inspiration library on disk (downloaded on request by Rust), read as
// directions once and shared by the dialog and the AI commands.

const KEY = ["inspiration", "library"] as const;

async function load(): Promise<Inspiration[]> {
  const text = z
    .string()
    .nullable()
    .parse(await invoke("inspiration_library"));
  if (text === null) return [];
  try {
    return withDirections(parseLibrary(JSON.parse(text)));
  } catch {
    return [];
  }
}

export const loadInspirations = () =>
  queryClient.fetchQuery({ queryKey: KEY, queryFn: load, staleTime: Infinity });

export function useInspirations() {
  return useQuery({ queryKey: KEY, queryFn: load, staleTime: Infinity });
}

/** Downloads the latest list; returns how many prompts it holds. */
export async function syncInspirations(): Promise<number> {
  const count = z
    .number()
    .int()
    .nonnegative()
    .parse(await invoke("inspiration_sync"));
  await queryClient.invalidateQueries({ queryKey: KEY });
  return count;
}

export function useSyncInspirations() {
  return useMutation({
    mutationFn: syncInspirations,
    onSuccess: (count) => {
      if (typeof count !== "number") return;
      toast.success(`${count} prompts in the inspiration library.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
}

/**
 * The montage set in an inspiration's format, colours and type, remembering
 * which one (for credit). A video that is not a film yet becomes one.
 */
export function withInspiration(edit: EditState, i: Inspiration): EditState {
  const current = filmSchema.safeParse(edit.film?.settings ?? {});
  const film = filmSchema.parse({
    ...(current.success ? current.data : {}),
    ...filmPatch(i.direction, FILM_FONTS),
    inspiration: i.slug,
  });
  return edit.film
    ? applyFilm(edit, film, edit.film.locale)
    : adoptFilm(edit, film, navigator.language || "en-US");
}
