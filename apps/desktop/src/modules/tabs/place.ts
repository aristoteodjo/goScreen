export type TabKind = "home" | "project" | "flow" | "editor" | "studio" | "reproduce";

export type Tab = { id: string; href: string; title: string; kind: TabKind };

/** What a place is, and a first name for it until the page names it. */
export function describe(href: string): { kind: TabKind; title: string } {
  const url = new URL(href, "http://app");
  const q = url.searchParams;
  const stem = (p: string) =>
    (p.split("/").pop() ?? p).replace(/\.[^.]+$/, "") || p;
  if (url.pathname.startsWith("/editor"))
    return { kind: "editor", title: stem(q.get("video") ?? "Video") };
  if (url.pathname.startsWith("/flow"))
    return { kind: "flow", title: q.get("vsl") ?? "Flow" };
  if (url.pathname.startsWith("/projects/"))
    return {
      kind: "project",
      title: decodeURIComponent(url.pathname.split("/")[2] ?? "Project"),
    };
  if (url.pathname.startsWith("/reproduce"))
    return { kind: "reproduce", title: q.get("reference") ? "Reference" : "Reproduce" };
  if (url.pathname.startsWith("/studio"))
    return { kind: "studio", title: "Studio" };
  return { kind: "home", title: "Projects" };
}
