import { applyEntries, type TextEntry } from "./siteModel.ts";

// These labels ship with the UI. Editorial text remains editable in Decap.
const interfaceKeys = new Set(["nav", "language", "primaryNavigation", "toggleNavigation", "socialMedia", "consultation"]);
export function isCodeManagedEntry(pageId: string, key: string): boolean {
  if (pageId.replace(/^drafts\./, "") === "site-messages") return true;
  if (pageId.replace(/^drafts\./, "") !== "site-global") return false;
  try { return interfaceKeys.has(JSON.parse(key)[0]); } catch { return false; }
}

export function applyEditorialEntries<T>(pageId: string, fallback: T, entries: TextEntry[], locale: "en" | "my"): T {
  return applyEntries(fallback, entries.filter(entry => !isCodeManagedEntry(pageId, entry.key)), locale);
}
