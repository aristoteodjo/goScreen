/** HH:MM:SS:FF at 30 fps, as editors read time. */
export function timecode(seconds: number, fps = 30) {
  const frames = Math.max(0, Math.round(seconds * fps));
  const ff = frames % fps;
  const s = Math.floor(frames / fps);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(ff)}`;
}
