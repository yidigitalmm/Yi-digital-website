import { describe, it, expect } from "vitest";
import { normalizeContent } from "../../scripts/content/normalize";
import { absoluteImageUrl } from "./content";

const doc = { slug: "test-article", image: "/uploads/test.jpg", en: {
  title: "Test", category: "Guide", summary: "Summary", imageAlt: "Cover", readTime: "2 min", intro: "Intro",
  sections: [{ heading: "Heading", paragraphs: ["Text"] }], checklist: [], closing: "Closing",
} };
describe("CMS publishing", () => {
  it("falls back to English when a Myanmar translation is absent", () => {
    const result = normalizeContent({ enabled: true, articles: [doc], work: [] });
    expect(result.articles[0].my).toEqual(result.articles[0].en);
  });
  it("uses the Myanmar translation when available", () => {
    const result = normalizeContent({ enabled: true, articles: [{ ...doc, my: { ...doc.en, title: "မြန်မာ" } }], work: [] });
    expect(result.articles[0].my.title).toBe("မြန်မာ");
  });
  it("keeps an initialized empty collection empty after unpublishing", () => {
    expect(normalizeContent({ enabled: true, articles: [], work: [] })).toEqual({ enabled: true, articles: [], work: [] });
  });
  it("rejects duplicate and unsafe article paths before building", () => {
    expect(() => normalizeContent({ enabled: true, articles: [doc, doc], work: [] })).toThrow("Duplicate");
    expect(() => normalizeContent({ enabled: true, articles: [{ ...doc, slug: "../escape" }], work: [] })).toThrow("Invalid");
  });
  it("rejects incomplete published content instead of replacing a valid snapshot", () => {
    expect(() => normalizeContent({ enabled: true, articles: [{ ...doc, en: {} }], work: [] })).toThrow();
  });
  it("preserves external sharing images and resolves existing local images", () => {
    expect(absoluteImageUrl("https://example.com/image.jpg")).toBe("https://example.com/image.jpg");
    expect(absoluteImageUrl("/social-share.png")).toBe("https://yidigitalmm.com/social-share.png");
  });
});
