import { z } from "zod";

/** Mirrors `modules/site/brand.rs` (`site_brand`, `site_sections`). */
export const ROLES = [
  "hero",
  "features",
  "pricing",
  "stats",
  "how-it-works",
  "testimonials",
  "listing",
  "faq",
  "cta",
  "other",
] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

const opt = z.string().nullish().transform((v) => v ?? undefined);

export const brandSchema = z.object({
  name: z.string(),
  tagline: opt,
  description: opt,
  lang: opt,
  colors: z.object({ background: opt, primary: opt, accent: opt, ink: opt }),
  fonts: z.object({ heading: opt, body: opt }),
  logo: opt,
});
export type Brand = z.input<typeof brandSchema>;

export const sectionSchema = z.object({
  role: roleSchema.catch("other"),
  title: z.string(),
  text: z.string(),
  /** Page the section was read on (added by the caller). */
  page: z.string().optional(),
});
export type Section = z.infer<typeof sectionSchema>;

export interface Site {
  url: string;
  brand: Brand;
  sections: Section[];
}

export function rolesOf(sections: Section[]): Set<Role> {
  return new Set(sections.map((s) => s.role));
}
