import { businessDefaults, pageDefinitions, mediaDefaults } from "../../src/cms/siteDefaults";
import { entriesFor, type SitePage, type TextEntry, type MediaItem } from "../../src/cms/siteModel";

export function normalizeSite(result: { pages?: SitePage[]; media?: MediaItem[]; business?: Record<string, unknown> | null }) {
  const pages = (result.pages ?? []).map(page => {
    const definition = pageDefinitions.find(item => item.id === page.id);
    if (!definition) throw new Error(`Unknown page: ${page.id}`);
    if (!Array.isArray(page.entries)) throw new Error(`Missing page text: ${page.id}`);
    const known = new Map(entriesFor(definition.en, definition.my).map(entry => [entry.key, entry]));
    const seen = new Set<string>();
    const entries = page.entries.map(entry => {
      const original = known.get(entry.key);
      if (!original || seen.has(entry.key)) throw new Error(`Invalid or duplicate text row in ${page.id}`);
      seen.add(entry.key);
      const suffix = original.kind === "boolean" ? "Boolean" : original.kind === "number" ? "Number" : "";
      const en = `en${suffix}` as keyof TextEntry, my = `my${suffix}` as keyof TextEntry;
      if (typeof entry[en] !== original.kind) throw new Error(`Invalid English value: ${original.label}`);
      if (original.kind === "string" && !(entry[en] as string).trim()) throw new Error(`Empty English text: ${original.label}`);
      if (entry[my] != null && typeof entry[my] !== original.kind) throw new Error(`Invalid Myanmar value: ${original.label}`);
      return { key: original.key, label: original.label, kind: original.kind, [en]: entry[en], ...(entry[my] != null && entry[my] !== "" ? { [my]: entry[my] } : {}) } as TextEntry;
    });
    return { id: page.id, entries };
  });
  if (new Set(pages.map(page => page.id)).size !== pages.length) throw new Error("Duplicate page documents");
  const media = (result.media ?? []).map(item => {
    if (!(item.key in mediaDefaults) || !/^https:\/\/cdn\.sanity\.io\/images\//.test(item.url ?? "")) throw new Error(`Invalid website image: ${item.key}`);
    return { key: item.key, url: item.url };
  });
  if (new Set(media.map(item => item.key)).size !== media.length) throw new Error("Duplicate image slots");
  let business: typeof businessDefaults | undefined;
  if (result.business) {
    business = { ...businessDefaults };
    for (const key of Object.keys(businessDefaults) as (keyof typeof businessDefaults)[]) {
      const value = result.business[key];
      if (typeof value !== "string" || !value.trim()) throw new Error(`Missing contact setting: ${key}`);
      if (["facebook", "instagram", "tiktok", "linkedin"].includes(key) && !/^https:\/\//.test(value)) throw new Error(`Invalid social URL: ${key}`);
      if (key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Invalid contact email");
      if (key.endsWith("Number") && !/^\+[0-9]{6,15}$/.test(value)) throw new Error("Invalid phone number");
      business[key] = value;
    }
  }
  return { pages, media, ...(business ? { business } : {}) };
}
