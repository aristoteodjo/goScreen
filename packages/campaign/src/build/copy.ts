import type { Campaign } from "../campaign";
import type { Site } from "../site";
import type { Scene } from "./scenes";

/** The words of a montage. Local templates by default; AI copywriting can replace it later. */
export interface Copy {
  /** Opening line (≤ 7 words for a social ad). */
  hook: string;
  /** Product name for the logo card. */
  name: string;
  /** One caption per scene shown. */
  caption: (scene: Scene, index: number) => string;
  /** Title of a walkthrough. */
  walkthrough: string;
  cta: string;
  /** Short address shown under the CTA. */
  url: string;
}

export type CopyProvider = (site: Site, campaign: Campaign) => Copy;

const WALKTHROUGH: Record<string, string> = {
  fr: "Comment ça marche",
  en: "How it works",
  es: "Cómo funciona",
  de: "So funktioniert's",
  pt: "Como funciona",
};

/** First words of `text`, cut on a word boundary. */
export function shorten(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words
    .slice(0, maxWords)
    .join(" ")
    .replace(/[,;:.!?–—-]+$/, "")}…`;
}

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const localCopy: CopyProvider = (site, campaign) => {
  const lang = campaign.language.slice(0, 2);
  // The brief's offer speaks for the campaign; the site's tagline is the fallback.
  const source =
    campaign.offer ||
    site.brand.tagline ||
    site.brand.description ||
    site.brand.name;
  // A tagline often has two sentences or clauses: the first is the hook.
  const first = source.split(/(?<=[.!?])\s+|,\s+/)[0] ?? source;
  return {
    hook: shorten(first, 9),
    name: site.brand.name,
    caption: (scene) => shorten(scene.title, 6),
    walkthrough: WALKTHROUGH[lang] ?? WALKTHROUGH.en,
    cta: campaign.cta.label,
    url: host(campaign.cta.url || site.url),
  };
};
