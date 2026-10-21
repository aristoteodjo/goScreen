import {
  type AudioClip,
  type DuckPoint,
  duckGainAt,
} from "@goscreen/render-engine";
import { delayed, envelope, planVoices } from "./voicePlan";

// Audio clips of the preview, decoded whole and scheduled on the audio clock.
// An <audio> element streamed from the local media server stalls now and then
// while the timeline runs on, which left gaps in a voice-over; the export never
// had them since FFmpeg mixes the files.

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
let live: AudioBufferSourceNode[] = [];
let generation = 0;

function context(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function bufferOf(url: string): Promise<AudioBuffer> {
  let hit = buffers.get(url);
  if (!hit) {
    hit = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Audio fetch failed (${res.status})`);
        return res.arrayBuffer();
      })
      .then((data) => context().decodeAudioData(data));
    hit.catch(() => buffers.delete(url));
    buffers.set(url, hit);
  }
  return hit;
}

/** Decodes ahead so the first play starts on time. */
export function preloadVoices(urls: Iterable<string>) {
  for (const url of urls) void bufferOf(url).catch(() => {});
}

export function stopVoices() {
  generation += 1;
  for (const source of live) {
    try {
      source.stop();
    } catch {
      // Never started: nothing to stop.
    }
  }
  live = [];
}

/**
 * Plays every clip from timeline time t on, replacing what was scheduled.
 * `duckOf` gives a clip's gain curve under the voice (seconds from the
 * clip's start), applied as the export applies it.
 */
export function startVoices(
  clips: AudioClip[],
  t: number,
  urlOf: (clip: AudioClip) => string | null,
  skip: (clip: AudioClip) => boolean,
  duckOf: (clip: AudioClip) => DuckPoint[] | null = () => null,
) {
  stopVoices();
  const run = generation;
  const audio = context();
  const asked = audio.currentTime;
  for (const planned of planVoices(clips, t, skip)) {
    const url = urlOf(planned.clip);
    if (!url) continue;
    void bufferOf(url)
      .then((buffer) => {
        if (run !== generation) return;
        const v = delayed(planned, audio.currentTime - asked);
        if (!v) return;
        const when = audio.currentTime + v.lead;
        const gain = audio.createGain();
        const [first, ...rest] = envelope(v.clip, v.into);
        gain.gain.setValueAtTime(first?.gain ?? 0, when);
        for (const p of rest)
          gain.gain.linearRampToValueAtTime(p.gain, when + p.at);
        const source = audio.createBufferSource();
        source.buffer = buffer;
        let chain: AudioNode = source.connect(gain);
        const duck = duckOf(v.clip);
        if (duck?.length) {
          const curve = duck.map((p) => ({ t: p.at, gain: p.gain }));
          const ducked = audio.createGain();
          ducked.gain.setValueAtTime(duckGainAt(curve, v.into), when);
          for (const p of duck)
            if (p.at > v.into)
              ducked.gain.linearRampToValueAtTime(p.gain, when + p.at - v.into);
          chain = chain.connect(ducked);
        }
        chain.connect(audio.destination);
        source.start(when, v.offset, v.duration);
        source.onended = () => {
          live = live.filter((s) => s !== source);
        };
        live.push(source);
      })
      .catch(() => {});
  }
}
