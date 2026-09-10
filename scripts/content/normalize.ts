import type { ContentSnapshot, WorkItem } from "../../src/cms/content";
import type { JournalArticle } from "../../src/journalContent";

type RecordValue = Record<string, any>;
function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}`);
  return value;
}
function list(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("Expected a text list");
  return value;
}
function imageUrl(value: unknown): string {
  const url = required(value, "image");
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("..")) throw new Error("Expected a local image path");
  return url;
}
function article(doc: RecordValue, locale: "en" | "my"): JournalArticle {
  const t = doc[locale] ?? doc.en;
  if (!t || !Array.isArray(t.sections) || !t.sections.length) throw new Error("Article needs text and sections");
  const slug = required(doc.slug, "slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid article URL: ${slug}`);
  return { slug, image: imageUrl(doc.image),
    title: required(t.title, "title"), category: required(t.category, "category"), summary: required(t.summary, "summary"),
    imageAlt: required(t.imageAlt, "image description"), readTime: required(t.readTime, "reading time"), intro: required(t.intro, "introduction"),
    sections: t.sections.map((section: RecordValue) => {
      const paragraphs = list(section.paragraphs);
      if (!paragraphs.length) throw new Error("Section needs paragraphs");
      return { heading: required(section.heading, "section heading"), paragraphs };
    }), checklist: list(t.checklist), closing: required(t.closing, "closing paragraph"),
  };
}
function work(doc: RecordValue, locale: "en" | "my"): WorkItem {
  const t = doc[locale] ?? doc.en;
  if (!t) throw new Error("Project needs English text");
  const url = doc.url || undefined;
  if (url && !/^https?:\/\//.test(url)) throw new Error("Project URL must use HTTP or HTTPS");
  return { title: required(t.title, "project name"), type: required(t.type, "business type"), summary: required(t.summary, "project summary"),
    packageName: required(t.packageName, "package"), outcome: required(t.outcome, "outcome"),
    addons: list(t.addons), delivered: list(t.delivered), image: imageUrl(doc.image),
    websitePreview: doc.websitePreview === true, scrollImage: doc.scrollImage ? imageUrl(doc.scrollImage) : undefined, url };
}
export function normalizeContent(result: { enabled: boolean; articles: RecordValue[]; work: RecordValue[] }): ContentSnapshot {
  const seen = new Set<string>();
  return { enabled: result.enabled,
    articles: result.articles.map(doc => {
      if (seen.has(doc.slug)) throw new Error(`Duplicate article URL: ${doc.slug}`);
      seen.add(doc.slug);
      return { en: article(doc, "en"), my: article(doc, "my") };
    }), work: result.work.map(doc => ({ en: work(doc, "en"), my: work(doc, "my") })),
  };
}
