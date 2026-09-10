export type TextValue = string | boolean | number;
export type TextEntry = { key: string; label: string; kind: string; en?: string; my?: string; enBoolean?: boolean; myBoolean?: boolean; enNumber?: number; myNumber?: number };
export type SitePage = { id: string; entries: TextEntry[] };
export type MediaItem = { key: string; url: string };
type Leaf = { path: (string | number)[]; value: TextValue };
export function leaves(value: unknown, path: (string | number)[] = []): Leaf[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, [...path, index]));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => leaves(item, [...path, key]));
  return [];
}
const labelPart = (value: string | number) => typeof value === "number" ? `Item ${value + 1}` : value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
export function entriesFor(en: unknown, my: unknown): TextEntry[] {
  const translated = new Map(leaves(my).map(item => [JSON.stringify(item.path), item.value]));
  return leaves(en).map(({ path, value }) => {
    const key = JSON.stringify(path), other = translated.get(key) ?? value;
    return { key, label: path.filter(part => part !== "text").map(labelPart).join(" · "), kind: typeof value,
      ...(typeof value === "string" ? { en: value, my: String(other) } : typeof value === "boolean" ? { enBoolean: value, myBoolean: Boolean(other) } : { enNumber: value, myNumber: Number(other) }) };
  });
}
// Only existing template paths can change; CMS data cannot set object paths or array sizes.
export function applyEntries<T>(fallback: T, entries: TextEntry[], locale: "en" | "my"): T {
  const values = new Map(entries.map(entry => [entry.key, entry]));
  const visit = (value: unknown, path: (string | number)[]): unknown => {
    const entry = values.get(JSON.stringify(path));
    if (entry) {
      const suffix = typeof value === "boolean" ? "Boolean" : typeof value === "number" ? "Number" : "";
      const replacement = entry[`${locale}${suffix}` as keyof TextEntry] ?? entry[`en${suffix}` as keyof TextEntry];
      if (typeof replacement === typeof value) return replacement;
    }
    if (Array.isArray(value)) return value.map((item, index) => visit(item, [...path, index]));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, [...path, key])]));
    return value;
  };
  return visit(fallback, []) as T;
}
