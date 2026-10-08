import type { DeviceDefinition } from "@goscreen/device-registry";

type Props = { style: DeviceDefinition["statusBar"]["style"]; height: number };

export function StatusBar({ style, height }: Props) {
  if (style === "none") return null;
  const ios = style === "ios";
  return (
    <div
      className="flex shrink-0 items-center justify-between bg-white text-black"
      style={{
        height,
        paddingInline: ios ? 32 : 22,
        paddingTop: ios ? height * 0.28 : 0,
        fontFamily: ios ? "-apple-system, 'SF Pro Text', 'Inter Variable', sans-serif" : "Roboto, 'Inter Variable', sans-serif",
      }}
    >
      <span style={{ fontSize: ios ? 17 : 14, fontWeight: ios ? 600 : 500, letterSpacing: ios ? -0.2 : 0 }}>9:41</span>
      <span className="flex items-center gap-1.5">
        <Signal />
        <Wifi />
        <Battery ios={ios} />
      </span>
    </div>
  );
}

function Signal() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 5} y={9 - i * 3} width="3" height={3 + i * 3} rx="1" fill="currentColor" />
      ))}
    </svg>
  );
}

function Wifi() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
      <path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0L8 11.5Z" fill="currentColor" />
      <path d="M3.4 6.8a6.5 6.5 0 0 1 9.2 0l-1.3 1.3a4.7 4.7 0 0 0-6.6 0L3.4 6.8Z" fill="currentColor" />
      <path d="M1.2 4.6a9.6 9.6 0 0 1 13.6 0l-1.3 1.3a7.8 7.8 0 0 0-11 0L1.2 4.6Z" fill="currentColor" />
    </svg>
  );
}

function Battery({ ios }: { ios: boolean }) {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true">
      <rect x="0.5" y="0.5" width="23" height="12" rx={ios ? 3.8 : 2.5} fill="none" stroke="currentColor" opacity="0.4" />
      <rect x="2" y="2" width="20" height="9" rx={ios ? 2.5 : 1.5} fill="currentColor" />
      <path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="currentColor" opacity="0.4" />
    </svg>
  );
}
