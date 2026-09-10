import { absoluteImageUrl } from "./cms/content";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderRouteHtml } from "../scripts/static-route-html";
import { getRouteMetadata, publicRoutes } from "./routeMetadata";

const template = readFileSync("index.html", "utf8");
describe("crawler-visible route HTML", () => {
  it.each(publicRoutes)("includes unique metadata in raw HTML for %s", path => {
    const doc = new DOMParser().parseFromString(renderRouteHtml(template, path), "text/html");
    const meta = getRouteMetadata(path);
    expect(doc.title).toBe(meta.title);
    expect(doc.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(meta.description);
    expect(doc.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(meta.title);
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(absoluteImageUrl(meta.image));
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(meta.canonical);
    expect(doc.querySelector('script[type="module"]')).not.toBeNull();
  });
  it("keeps error pages out of the index without a misleading canonical", () => {
    const doc = new DOMParser().parseFromString(renderRouteHtml(template, "/404"), "text/html");
    expect(doc.title).toBe("Page not found | Yi Digital");
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
  });
});
