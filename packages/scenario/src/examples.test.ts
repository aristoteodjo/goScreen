import { describe, expect, it } from "vitest";
// Scenarios shipped in examples/: they must stay valid as the format grows.
import buyer from "../../../examples/oeufdor-vsl/acheteur.scenario.json";
import producer from "../../../examples/oeufdor-vsl/producteur.scenario.json";
import { parseScenario, requiredVars } from "./index";

describe("example scenarios", () => {
  for (const [name, json] of Object.entries({ buyer, producer })) {
    it(`${name} parses and only asks for declared values`, () => {
      const parsed = parseScenario(JSON.stringify(json));
      if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
      const declared = Object.keys(parsed.scenario.vars);
      expect(requiredVars(parsed.scenario).sort()).toEqual(declared.sort());
      expect(parsed.scenario.steps.some((s) => s.do === "scene")).toBe(true);
    });
  }
});
