import type { Orientation } from "@goscreen/device-engine";
import type { DeviceCutout } from "@goscreen/device-registry";

type Props = { cutout: DeviceCutout; orientation: Orientation };

export function Cutout({ cutout, orientation }: Props) {
  if (cutout.type === "none") return null;
  const portrait = orientation === "portrait";
  const width = portrait ? cutout.width : cutout.height;
  const height = portrait ? cutout.height : cutout.width;
  const radius =
    cutout.type === "punch-hole"
      ? "9999px"
      : cutout.type === "dynamic-island"
        ? `${Math.min(width, height) / 2}px`
        : portrait
          ? "0 0 18px 18px"
          : "0 18px 18px 0";
  const position = portrait
    ? { top: cutout.offsetTop, left: "50%", transform: "translateX(-50%)" }
    : { left: cutout.offsetTop, top: "50%", transform: "translateY(-50%)" };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-20 bg-black"
      style={{ width, height, borderRadius: radius, ...position }}
    />
  );
}
