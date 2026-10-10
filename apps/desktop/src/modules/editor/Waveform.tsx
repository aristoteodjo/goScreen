import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

// Peaks per second of audio. Enough for a timeline zoomed in a long way.
const RATE = 60;

/** Max absolute amplitude per 1/RATE s of the file, decoded once. */
async function peaksOf(url: string): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio fetch failed (${res.status})`);
  const ctx = new OfflineAudioContext(1, 1, 44_100);
  const audio = await ctx.decodeAudioData(await res.arrayBuffer());
  const step = Math.max(1, Math.floor(audio.sampleRate / RATE));
  const count = Math.ceil(audio.length / step);
  const out = new Float32Array(count);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) =>
    audio.getChannelData(c),
  );
  for (let i = 0; i < count; i += 1) {
    let max = 0;
    const end = Math.min(audio.length, (i + 1) * step);
    for (const data of channels) {
      for (let j = i * step; j < end; j += 4) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
    }
    out[i] = max;
  }
  // Normalize so quiet recordings still read.
  let top = 0;
  for (const v of out) top = Math.max(top, v);
  if (top > 0) for (let i = 0; i < count; i += 1) out[i] /= top;
  return out;
}

export function usePeaks(url: string | null) {
  return useQuery({
    queryKey: ["peaks", url],
    queryFn: () => peaksOf(url as string),
    enabled: url !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/**
 * The waveform of [from, from + duration × speed) of a file, drawn mirrored
 * around the middle of a `width` × `height` box.
 */
export function Waveform({
  url,
  from,
  duration,
  speed = 1,
  width,
  height,
  color,
}: {
  url: string | null;
  from: number;
  duration: number;
  speed?: number;
  width: number;
  height: number;
  color: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { data: peaks } = usePeaks(url);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    // Browsers cap canvas size; very wide clips are drawn at lower density.
    const w = Math.min(8000, Math.round(width * dpr));
    canvas.width = w;
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    const mid = canvas.height / 2;
    const span = duration * speed;
    for (let x = 0; x < w; x += 2) {
      const a = Math.floor((from + (x / w) * span) * RATE);
      const b = Math.max(
        a + 1,
        Math.floor((from + ((x + 2) / w) * span) * RATE),
      );
      let v = 0;
      for (let i = a; i < b && i < peaks.length; i += 1)
        v = Math.max(v, peaks[i] ?? 0);
      const h = Math.max(1, v * mid * 0.95);
      ctx.fillRect(x, mid - h, 1.5, h * 2);
    }
  }, [peaks, from, duration, speed, width, height, color]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0"
      style={{ width, height }}
    />
  );
}
