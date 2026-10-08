import type { DeviceInstance, Shadow } from "./types";

export function shadowToCss(shadow: Shadow): string {
  if (shadow.opacity <= 0) return "none";
  const alpha = Math.round(Math.min(1, shadow.opacity) * 255)
    .toString(16)
    .padStart(2, "0");
  return `drop-shadow(${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}${alpha})`;
}

export function instanceTransform(instance: DeviceInstance): string {
  const parts = [
    `translate(${instance.x}px, ${instance.y}px)`,
    "translate(-50%, -50%)",
  ];
  if (instance.renderMode === "perspective") {
    parts.push(`perspective(2400px) rotateY(${instance.tilt}deg)`);
  }
  parts.push(`rotate(${instance.rotation}deg)`, `scale(${instance.scale})`);
  return parts.join(" ");
}

export const SHADOW_PRESETS = {
  none: { color: "#000000", opacity: 0, blur: 0, spread: 0, offsetX: 0, offsetY: 0 },
  soft: { color: "#000000", opacity: 0.25, blur: 30, spread: 0, offsetX: 0, offsetY: 16 },
  floating: { color: "#000000", opacity: 0.4, blur: 60, spread: 0, offsetX: 0, offsetY: 40 },
  studio: { color: "#000000", opacity: 0.55, blur: 24, spread: 0, offsetX: 0, offsetY: 10 },
  dramatic: { color: "#000000", opacity: 0.7, blur: 90, spread: 0, offsetX: 30, offsetY: 60 },
  neon: { color: "#7c5cff", opacity: 0.8, blur: 50, spread: 0, offsetX: 0, offsetY: 0 },
} as const satisfies Record<string, Shadow>;

export type ShadowPresetId = keyof typeof SHADOW_PRESETS;
