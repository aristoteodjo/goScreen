// Site tour timing, pure. The executor (runTour.ts) follows these numbers.

export type TourOptions = {
  // Seconds spent scrolling each page from top to bottom.
  scrollSeconds: number;
  // Seconds held at the top before scrolling and at the bottom after.
  pauseSeconds: number;
};

export const DEFAULT_TOUR: TourOptions = {
  scrollSeconds: 6,
  pauseSeconds: 1.5,
};

/** Gentle start and stop, like a hand on a trackpad. */
export function scrollRatioAt(elapsed: number, duration: number): number {
  if (duration <= 0) return 1;
  const x = Math.max(0, Math.min(1, elapsed / duration));
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

/** Rough length of the video, page loads excluded. */
export function tourSeconds(pages: number, o: TourOptions): number {
  return pages * (o.scrollSeconds + o.pauseSeconds * 2);
}

/** Same page for a tour: origin + path, trailing slash and hash ignored. */
export function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, "") || "/";
    return (
      x.origin === y.origin && path(x) === path(y) && x.search === y.search
    );
  } catch {
    return false;
  }
}

/** Short label for a page in lists: its path. */
export function pageLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}
