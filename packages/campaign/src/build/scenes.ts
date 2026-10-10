import type { Role, Section } from "../site";

/** One page of the tour, in source seconds (journal v4 `chapters`). */
export interface Chapter {
  url: string;
  start: number;
  end: number;
}

/** Where a section is visible in the recording, in source seconds. */
export interface Scene {
  role: Role;
  title: string;
  start: number;
  end: number;
}

const samePage = (a: string, b: string) => {
  const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return norm(a) === norm(b);
};

/**
 * Places each section in the recording. A tour scrolls a page from top to
 * bottom at a steady pace, so a page's sections share its chapter evenly, in
 * document order. Without chapters, the whole recording is the first page.
 * Precise rectangles (journal `marks`) will replace this estimate.
 */
export function scenesFrom(
  sections: Section[],
  chapters: Chapter[],
  duration: number,
): Scene[] {
  const pages: Chapter[] =
    chapters.length > 0
      ? chapters
      : [{ url: sections[0]?.page ?? "", start: 0, end: duration }];
  return pages.flatMap((chapter, i) => {
    const own = sections.filter(
      (s) => s.page !== undefined && samePage(s.page, chapter.url),
    );
    const onPage =
      own.length > 0 || i > 0
        ? own
        : sections.filter(
            (s) => s.page === undefined || samePage(s.page, chapter.url),
          );
    const length = (chapter.end - chapter.start) / Math.max(1, onPage.length);
    return onPage.map((s, k) => ({
      role: s.role,
      title: s.title,
      start: chapter.start + k * length,
      end: chapter.start + (k + 1) * length,
    }));
  });
}

/**
 * Scenes for the given roles, best first: roles in the asked order, then
 * source order. `variant` rotates the choice so each variant shows other scenes.
 * When the site has too few, the other sections fill in, in page order: a
 * montage keeps its rhythm instead of holding one shot too long.
 */
export function pickScenes(
  scenes: Scene[],
  roles: Role[],
  count: number,
  variant = 0,
): Scene[] {
  const pool = roles.flatMap((r) => scenes.filter((s) => s.role === r));
  if (pool.length === 0) return [];
  const shift = (variant * count) % pool.length;
  const rotated = [...pool.slice(shift), ...pool.slice(0, shift)];
  const filler = scenes.filter((s) => !pool.includes(s) && s.role !== "other");
  return [...rotated, ...filler].slice(0, count);
}
