export type Background =
  | { kind: "color"; value: string }
  | { kind: "gradient"; from: string; to: string; angle: number }
  | { kind: "transparent" };

export const BACKGROUND_PRESETS: {
  id: string;
  name: string;
  value: Background;
}[] = [
  {
    id: "ember",
    name: "Ember",
    value: { kind: "gradient", from: "#ff7a45", to: "#7a1fd6", angle: 135 },
  },
  {
    id: "dusk",
    name: "Dusk",
    value: { kind: "gradient", from: "#1e2a78", to: "#ff6f91", angle: 160 },
  },
  {
    id: "mint",
    name: "Mint",
    value: { kind: "gradient", from: "#c6f6d5", to: "#4fd1c5", angle: 120 },
  },
  { id: "paper", name: "Paper", value: { kind: "color", value: "#f2efe9" } },
  {
    id: "graphite",
    name: "Graphite",
    value: { kind: "color", value: "#1b1c20" },
  },
  {
    id: "night",
    name: "Night",
    value: { kind: "gradient", from: "#0f1020", to: "#2b2d42", angle: 180 },
  },
  { id: "transparent", name: "Transparent", value: { kind: "transparent" } },
];

export function backgroundToCss(bg: Background): string {
  switch (bg.kind) {
    case "color":
      return bg.value;
    case "gradient":
      return `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`;
    case "transparent":
      return "repeating-conic-gradient(#2a2b30 0% 25%, #222327 0% 50%) 50% / 32px 32px";
  }
}
