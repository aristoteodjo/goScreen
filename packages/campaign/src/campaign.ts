import { z } from "zod";

import { roleSchema, rolesOf, type Role, type Site } from "./site";

export const OBJECTIVES = ["launch", "acquisition", "promo", "feature", "recruit-supply", "awareness"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const TONES = ["energetic", "calm", "premium", "playful", "corporate"] as const;
export type Tone = (typeof TONES)[number];

export const CHANNELS = ["youtube", "website", "linkedin", "instagram-reel", "instagram-feed", "tiktok", "x", "booth"] as const;
export type Channel = (typeof CHANNELS)[number];

export const FORMATS = ["16:9", "9:16", "1:1", "4:5"] as const;
export type Format = (typeof FORMATS)[number];

/** Formats each channel publishes, preferred first. */
export const CHANNEL_FORMATS: Record<Channel, Format[]> = {
  youtube: ["16:9"],
  website: ["16:9"],
  linkedin: ["1:1", "16:9"],
  "instagram-reel": ["9:16"],
  "instagram-feed": ["4:5", "1:1"],
  tiktok: ["9:16"],
  x: ["16:9", "1:1"],
  booth: ["16:9"],
};

/** Every field falls back on its own: a damaged file never loses the whole brief. */
export const campaignSchema = z.object({
  objective: z.enum(OBJECTIVES).catch("awareness"),
  audience: z.string().catch(""),
  tone: z.enum(TONES).catch("energetic"),
  offer: z.string().catch(""),
  cta: z.object({ label: z.string(), url: z.string() }).catch({ label: "", url: "" }),
  channels: z.array(z.enum(CHANNELS)).min(1).catch(["youtube"]),
  language: z.string().min(2).catch("en"),
  /** Target duration in seconds; null lets each recipe pick. */
  durationHint: z.number().positive().nullable().catch(null),
  focus: z.object({ pages: z.array(z.string()), roles: z.array(roleSchema) }).catch({ pages: [], roles: [] }),
  brand: z
    .object({ primary: z.string().optional(), logo: z.string().optional(), font: z.string().optional() })
    .catch({}),
});
export type Campaign = z.infer<typeof campaignSchema>;

export function parseCampaign(raw: unknown): Campaign {
  return campaignSchema.parse(typeof raw === "object" && raw !== null ? raw : {});
}

/** Formats to produce, in channel order, without duplicates. */
export function formatsFor(channels: Channel[]): Format[] {
  return [...new Set(channels.flatMap((c) => CHANNEL_FORMATS[c]))];
}

const CTA_LABELS: Record<string, string> = {
  fr: "Découvrir",
  en: "Get started",
  es: "Descubrir",
  de: "Jetzt entdecken",
  pt: "Descobrir",
};

/** Roles worth showing, in the order a viewer expects them. */
const FOCUS_ORDER: Role[] = ["how-it-works", "features", "listing", "stats", "pricing", "testimonials"];

/** A brief filled from what the site says; the client corrects it. */
export function defaultCampaign(site: Site): Campaign {
  const roles = rolesOf(site.sections);
  const language = (site.brand.lang ?? "en").slice(0, 2).toLowerCase();
  return parseCampaign({
    objective: roles.has("pricing") || roles.has("cta") ? "acquisition" : "awareness",
    audience: "",
    tone: "energetic",
    offer: site.brand.description ?? site.brand.tagline ?? "",
    cta: { label: CTA_LABELS[language] ?? CTA_LABELS.en, url: site.url },
    channels: ["youtube", "instagram-reel", "linkedin"],
    language,
    durationHint: null,
    focus: { pages: [], roles: FOCUS_ORDER.filter((r) => roles.has(r)) },
    brand: {},
  });
}
