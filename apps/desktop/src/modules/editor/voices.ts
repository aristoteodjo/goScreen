import type { AudioClip } from "@goscreen/render-engine";
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

/** Plays every clip from timeline time t on, replacing what was scheduled. */
export function startVoices(
  clips: AudioClip[],
  t: number,
  urlOf: (clip: AudioClip) => string | null,
  skip: (clip: AudioClip) => boolean,
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
        source.connect(gain).connect(audio.destination);
        source.start(when, v.offset, v.duration);
        source.onended = () => {
          live = live.filter((s) => s !== source);
        };
        live.push(source);
      })
      .catch(() => {});
  }
}
