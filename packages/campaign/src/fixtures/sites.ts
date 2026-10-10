import type { Site } from "../site";

/** Test fixtures only. Brand and roles as `site_brand` / `site_sections` read them. */
const section = (role: Site["sections"][number]["role"], title: string) => ({
  role,
  title,
  text: title,
});

export const oeufsdor: Site = {
  url: "https://oeufsdor.vercel.app/",
  brand: {
    name: "OEUF D'OR",
    tagline:
      "Consultez les disponibilités dans votre zone, trouvez rapidement votre fournisseur.",
    description: "Place de marché avicole d'Abomey-Calavi et Cotonou.",
    lang: "fr",
    colors: {
      background: "#f7f7f2",
      primary: "#e9a100",
      accent: "#fcefc7",
      ink: "#16241c",
    },
    fonts: {
      heading: "Bricolage Grotesque Variable",
      body: "Atkinson Hyperlegible",
    },
    logo: "https://oeufsdor.vercel.app/favicon.svg",
  },
  sections: [
    section("hero", "Consultez les disponibilités dans votre zone"),
    section("listing", "Disponible maintenant"),
    section("pricing", "Meilleurs prix du moment"),
    section("listing", "Classement des producteurs"),
    section("stats", "Le marché en chiffres"),
    section("testimonials", "Une note après chaque remise"),
    section("how-it-works", "Comment ça marche"),
  ],
};

/** Opposite profile: English, dark, no pricing, no listing. */
export const darkSaas: Site = {
  url: "https://acme.example/",
  brand: {
    name: "Acme",
    tagline: "Ship & scale",
    lang: "en",
    colors: { background: "#0b0d12", primary: "hsl(262 83% 58%)" },
    fonts: { heading: "Inter Display" },
  },
  sections: [
    section("hero", "Ship & scale"),
    section("features", "Everything you need"),
    section("testimonials", "Loved by teams"),
  ],
};
