import { copy, type Locale } from "./content";

export type CopySection = "global" | "services" | "previousWork" | "journal" | "contact";

export function translate(locale: Locale, section: CopySection, value: string): string {
  const text = copy[locale][section].text as Record<string, string>;
  return text[value] ?? value;
}

export function localize<T>(locale: Locale, section: CopySection, value: T): T {
  if (typeof value === "string") return translate(locale, section, value) as T;
  if (Array.isArray(value)) return value.map((item) => localize(locale, section, item)) as T;
  if (value && typeof value === "object" && !("$$typeof" in value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(locale, section, item)])) as T;
  }
  return value;
}
