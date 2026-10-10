// Accepts what people type in an address bar: "localhost:3000",
// "example.com", "192.168.1.4:5173/app".
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const local =
    /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
      raw,
    );
  try {
    const url = new URL(
      hasScheme ? raw : `${local ? "http" : "https"}://${raw}`,
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
