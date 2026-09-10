import { copy as defaults, images as defaultImages } from "./contentDefaults.ts";
import { pageContent, getMedia } from "./cms/siteContent.ts";
export type { Locale } from "./contentDefaults.ts";
function localized(locale: "en" | "my") {
  const original = defaults[locale];
  const prices = pageContent("site-packages", locale, {
    packages: original.services.packages, connectedPresence: original.services.connectedPresence,
    websiteAddons: original.services.websiteAddons, sourceCodeTransfer: original.services.sourceCodeTransfer,
  });
  return {
    global: pageContent("site-global", locale, original.global), home: pageContent("site-home", locale, original.home),
    services: { ...prices, text: pageContent("site-services", locale, original.services.text) },
    contact: pageContent("site-contact", locale, original.contact), previousWork: pageContent("site-work", locale, original.previousWork),
    journal: pageContent("site-journal", locale, original.journal),
  };
}
export const copy = { en: localized("en"), my: localized("my") } as typeof defaults;
export const packages = copy.en.services.packages.options;
export const images = Object.fromEntries(Object.entries(defaultImages).map(([key, value]) => [key, getMedia(key, value)])) as typeof defaultImages;
