import snapshot from "./snapshot.json";
import { applyEntries, type SitePage, type MediaItem } from "./siteModel";
import { animationDefaults, businessDefaults } from "./siteDefaults";
import { pages } from "../seoDefaults";
import { interfaceDefaults } from "../interfaceCopyDefaults";
const site = snapshot as unknown as { pages?: SitePage[]; media?: MediaItem[]; business?: typeof businessDefaults };
export function pageContent<T>(id: string, locale: "en" | "my", fallback: T): T {
  return applyEntries(fallback, site.pages?.find(page => page.id === id)?.entries ?? [], locale);
}
export function getMedia(key: string, fallback: string): string { return site.media?.find(item => item.key === key)?.url ?? fallback; }
export const business = { ...businessDefaults, ...site.business };
export const animationCopy = { en: pageContent("site-animation", "en", animationDefaults.en), my: pageContent("site-animation", "my", animationDefaults.my) };
export const seoCopy = { en: pageContent("site-seo", "en", pages.en), my: pageContent("site-seo", "my", pages.my) };
const messages = { en: pageContent("site-messages", "en", interfaceDefaults.en), my: pageContent("site-messages", "my", interfaceDefaults.my) };
export const interfaceText = (locale: "en" | "my", english: string) => (messages[locale] as Record<string, string>)[english] ?? english;
