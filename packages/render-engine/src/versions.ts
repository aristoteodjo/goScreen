import type { EditState } from "./types";

// Durable versions of a montage, the git way: every version is a full
// EditState with who made it and why. Pure: diffing and pruning only. The
// shell stores versions next to the montage and decides when to write one.

export type EditAuthor = "person" | "ai";

export type EditVersionMeta = {
  id: string;
  // ISO date.
  at: string;
  author: EditAuthor;
  // The AI command that produced it, or "save" / "restore" for explicit
  // versions. Absent: an autosave, which pruning may coalesce.
  command?: string;
  message?: string;
};

export type EditVersion = EditVersionMeta & { state: EditState };

/** The journal of a montage, oldest first. */
export type EditHistory = { versions: EditVersionMeta[] };

/** An autosave is the only kind of version pruning may drop. */
export const isAutosave = (v: EditVersionMeta) =>
  v.author === "person" && !v.command;

const KINDS = ["clips", "overlays", "zooms", "audio", "assets"] as const;
export type DiffKind = (typeof KINDS)[number];

export type ItemRef = { id: string; label: string };
export type ItemChange = ItemRef & { fields: string[] };

export type KindDiff = {
  added: ItemRef[];
  removed: ItemRef[];
  changed: ItemChange[];
};

export type SettingChange = { field: string; from: unknown; to: unknown };

/** What changed between two edits, by id. JSON-serialisable. */
export type EditDiff = Record<DiffKind, KindDiff> & {
  // Device layers, by instance id (null layers = a flat video).
  layers: KindDiff;
  settings: SettingChange[];
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!same(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/** Leaf paths that differ ("touch.style"); arrays count as one leaf. */
function changedPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (same(a, b)) return [];
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) =>
      changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix || "(value)"];
}

const short = (s: string, n = 24) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

const round = (n: number) => Math.round(n * 100) / 100;

/** A short human name for an item, next to its id. */
export function labelOf(kind: DiffKind | "layers", item: unknown): string {
  if (!isObject(item)) return "";
  switch (kind) {
    case "clips":
      return item.kind === "slide"
        ? `card "${short(String(item.title ?? ""))}"`
        : `clip ${round(Number(item.in))}–${round(Number(item.out))}s`;
    case "overlays":
      return item.kind === "text"
        ? `text "${short(String(item.text ?? ""))}"`
        : `${String(item.kind)} at ${round(Number(item.start))}s`;
    case "zooms":
      return `zoom ×${round(Number(item.scale))} ${round(Number(item.start))}–${round(Number(item.end))}s`;
    case "audio":
      return `sound ${String(item.asset)} at ${round(Number(item.start))}s`;
    case "assets":
      return `${String(item.kind)} ${String(item.name)}`;
    case "layers":
      return `device ${String(item.deviceId)}`;
  }
}

function diffById(
  kind: DiffKind | "layers",
  a: unknown[],
  b: unknown[],
  key: string,
): KindDiff {
  const idOf = (x: unknown) => (isObject(x) ? String(x[key]) : "");
  const before = new Map(a.map((x) => [idOf(x), x]));
  const after = new Map(b.map((x) => [idOf(x), x]));
  const out: KindDiff = { added: [], removed: [], changed: [] };
  for (const [id, item] of after)
    if (!before.has(id)) out.added.push({ id, label: labelOf(kind, item) });
  for (const [id, item] of before)
    if (!after.has(id)) out.removed.push({ id, label: labelOf(kind, item) });
  for (const [id, item] of after) {
    const prev = before.get(id);
    if (prev === undefined) continue;
    const fields = changedPaths(prev, item);
    if (fields.length > 0)
      out.changed.push({ id, label: labelOf(kind, item), fields });
  }
  return out;
}

const KEYS: Record<DiffKind | "layers", string> = {
  clips: "id",
  overlays: "id",
  zooms: "id",
  audio: "id",
  assets: "id",
  layers: "instanceId",
};

/** Compares two edits: items by id, the rest as global settings. */
export function diffEdits(a: EditState, b: EditState): EditDiff {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const kinds = {} as Record<DiffKind | "layers", KindDiff>;
  for (const kind of [...KINDS, "layers"] as const) {
    const xa = Array.isArray(ra[kind]) ? (ra[kind] as unknown[]) : [];
    const xb = Array.isArray(rb[kind]) ? (rb[kind] as unknown[]) : [];
    kinds[kind] = diffById(kind, xa, xb, KEYS[kind]);
  }
  const settings: SettingChange[] = [];
  const skip = new Set<string>([...KINDS, "layers"]);
  const names = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort();
  for (const name of names) {
    if (skip.has(name)) continue;
    const va = ra[name];
    const vb = rb[name];
    if (same(va, vb)) continue;
    if (isObject(va) && isObject(vb)) {
      for (const path of changedPaths(va, vb, name))
        settings.push({
          field: path,
          from: pick(va, path, name),
          to: pick(vb, path, name),
        });
    } else settings.push({ field: name, from: va, to: vb });
  }
  return { ...kinds, settings };
}

function pick(root: Record<string, unknown>, path: string, name: string) {
  let v: unknown = root;
  for (const k of path.slice(name.length + 1).split(".")) {
    if (k === "") continue;
    v = isObject(v) ? v[k] : undefined;
  }
  return v;
}

export function isEmptyDiff(d: EditDiff): boolean {
  return (
    d.settings.length === 0 &&
    ([...KINDS, "layers"] as const).every(
      (k) =>
        d[k].added.length === 0 &&
        d[k].removed.length === 0 &&
        d[k].changed.length === 0,
    )
  );
}

const show = (v: unknown) =>
  v === undefined
    ? "–"
    : typeof v === "string"
      ? `"${short(v, 32)}"`
      : typeof v === "number"
        ? String(round(v))
        : short(JSON.stringify(v) ?? "", 40);

const ref = (r: ItemRef) => (r.label ? `${r.id} (${r.label})` : r.id);

/** The diff in a few lines, for a person or an AI. */
export function describeDiff(d: EditDiff): string {
  const lines: string[] = [];
  for (const kind of [...KINDS, "layers"] as const) {
    const k = d[kind];
    const parts: string[] = [];
    if (k.added.length)
      parts.push(`+${k.added.length}: ${k.added.map(ref).join(", ")}`);
    if (k.removed.length)
      parts.push(`-${k.removed.length}: ${k.removed.map(ref).join(", ")}`);
    if (k.changed.length)
      parts.push(
        `~${k.changed.length}: ${k.changed
          .map((c) => `${ref(c)} [${c.fields.join(", ")}]`)
          .join("; ")}`,
      );
    if (parts.length) lines.push(`${kind}: ${parts.join("  ")}`);
  }
  for (const s of d.settings)
    lines.push(`${s.field}: ${show(s.from)} -> ${show(s.to)}`);
  return lines.length ? lines.join("\n") : "No changes.";
}

export type PruneOptions = {
  // Autosaves younger than this are all kept (ms).
  recentMs?: number;
  // Beyond that, at most one autosave per bucket (ms).
  bucketMs?: number;
  // Hard cap on the number of versions.
  limit?: number;
};

export const PRUNE_DEFAULTS: Required<PruneOptions> = {
  recentMs: 60 * 60 * 1000,
  bucketMs: 5 * 60 * 1000,
  limit: 200,
};

/**
 * Which versions to keep: every explicit or AI version, the recent
 * autosaves, then one autosave per bucket (its latest). Over the cap, the
 * oldest autosaves go first, then the oldest versions. The newest version
 * always stays. `keep` is in the input's order.
 */
export function pruneHistory<T extends EditVersionMeta>(
  versions: T[],
  now: number,
  options: PruneOptions = {},
): { keep: T[]; drop: T[] } {
  const { recentMs, bucketMs, limit } = { ...PRUNE_DEFAULTS, ...options };
  const sorted = [...versions].sort((a, b) => a.at.localeCompare(b.at));
  const newest = sorted[sorted.length - 1];
  const dropped = new Set<T>();
  const bucketLatest = new Map<number, T>();
  for (const v of sorted) {
    if (!isAutosave(v) || v === newest) continue;
    const age = now - Date.parse(v.at);
    if (age < recentMs) continue;
    const bucket = Math.floor(Date.parse(v.at) / bucketMs);
    const prev = bucketLatest.get(bucket);
    if (prev) dropped.add(prev);
    bucketLatest.set(bucket, v);
  }
  let left = sorted.length - dropped.size;
  if (left > limit)
    for (const v of sorted) {
      if (left <= limit) break;
      if (dropped.has(v) || !isAutosave(v) || v === newest) continue;
      dropped.add(v);
      left--;
    }
  if (left > limit)
    for (const v of sorted) {
      if (left <= limit) break;
      if (dropped.has(v) || v === newest) continue;
      dropped.add(v);
      left--;
    }
  return {
    keep: versions.filter((v) => !dropped.has(v)),
    drop: versions.filter((v) => dropped.has(v)),
  };
}
