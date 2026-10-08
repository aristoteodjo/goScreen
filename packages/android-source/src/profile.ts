import type { AndroidDevice } from "./model";

/** The slice of a Device Registry definition needed to pick a look. */
export type ProfileCandidate = {
  id: string;
  brand: string;
  category: "phone" | "tablet" | "laptop" | "desktop";
  platform: string;
  viewport: { width: number; height: number };
};

const BRAND_HINTS: { brand: string; pattern: RegExp }[] = [
  { brand: "Google", pattern: /google|pixel|sdk_gphone|goldfish|ranchu/i },
  { brand: "Samsung", pattern: /samsung|^sm-|galaxy/i },
];

/**
 * Suggests a presentation profile for a running device: same form factor,
 * same brand when recognizable, closest screen ratio. The user can switch
 * profiles afterwards; the Android instance stays the same.
 */
export function suggestProfile(device: AndroidDevice, candidates: ProfileCandidate[]): string | null {
  const android = candidates.filter((c) => c.platform === "android");
  if (android.length === 0) return null;

  const res = device.resolution;
  const dpr = device.density ? device.density / 160 : 1;
  const shortDp = res ? Math.min(res.width, res.height) / dpr : 400;
  const category = shortDp >= 600 ? "tablet" : "phone";
  const ratio = res ? Math.max(res.width, res.height) / Math.min(res.width, res.height) : 2.1;

  const haystack = [device.manufacturer, device.model, device.name].filter(Boolean).join(" ");
  const brand = BRAND_HINTS.find((h) => h.pattern.test(haystack))?.brand;

  const sameCategory = android.filter((c) => c.category === category);
  const pool = sameCategory.length > 0 ? sameCategory : android;
  const branded = brand ? pool.filter((c) => c.brand === brand) : [];
  const ranked = (branded.length > 0 ? branded : pool)
    .map((c) => {
      const r = Math.max(c.viewport.width, c.viewport.height) / Math.min(c.viewport.width, c.viewport.height);
      return { id: c.id, score: Math.abs(r - ratio) };
    })
    .sort((a, b) => a.score - b.score);
  return ranked[0]?.id ?? null;
}
