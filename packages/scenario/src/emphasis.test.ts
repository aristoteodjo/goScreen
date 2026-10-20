import { describe, expect, it } from "vitest";
import { starNumbers } from "./edit";

describe("starNumbers", () => {
  it("marks figures as accent words and leaves the rest", () => {
    expect(starNumbers("2 493 plateaux chez 5 producteurs")).toBe(
      "*2 493* plateaux chez *5* producteurs",
    );
    expect(starNumbers("Remise de 30 % ce mois")).toBe("Remise de *30 %* ce mois");
    expect(starNumbers("Payez 12,50 € par mois")).toBe("Payez *12,50 €* par mois");
    expect(starNumbers("Trusted by 10,000+ users")).toBe(
      "Trusted by *10,000*+ users",
    );
  });

  it("keeps a caption the author already starred, and words with digits", () => {
    expect(starNumbers("La *meilleure* offre en 2 clics")).toBe(
      "La *meilleure* offre en 2 clics",
    );
    expect(starNumbers("Version v2 du produit")).toBe("Version v2 du produit");
    expect(starNumbers("Aucun chiffre ici")).toBe("Aucun chiffre ici");
  });
});
