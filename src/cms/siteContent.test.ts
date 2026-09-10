import { describe, it, expect, vi } from "vitest";
import { entriesFor, applyEntries } from "./siteModel";
import { pageDefinitions, businessDefaults } from "./siteDefaults";
import { normalizeSite } from "../../scripts/content/siteNormalize";

describe("whole-site CMS", () => {
  it("round-trips every existing page without changing layout arrays or translations", () => {
    for (const page of pageDefinitions) {
      const entries = entriesFor(page.en, page.my);
      expect(applyEntries(page.en, entries, "en")).toEqual(page.en);
      expect(applyEntries(page.my, entries, "my")).toEqual(page.my);
    }
  });
  it("applies nested package prices and supports false recommendation flags", () => {
    const fallback = { packages: [{ price: "100", recommended: true }] };
    const entries = entriesFor(fallback, fallback).map(entry => entry.kind === "boolean" ? { ...entry, enBoolean: false } : { ...entry, en: "250" });
    expect(applyEntries(fallback, entries, "en")).toEqual({ packages: [{ price: "250", recommended: false }] });
  });
  it("uses English when a new translation is omitted", () => {
    const entries = entriesFor({ title: "Original" }, { title: "Original" });
    entries[0].en = "New title";
    delete entries[0].my;
    expect(applyEntries({ title: "Old translation" }, entries, "my")).toEqual({ title: "New title" });
  });
  it("rejects unsafe contact links and malformed content", () => {
    expect(() => normalizeSite({ business: { ...businessDefaults, facebook: "javascript:alert(1)" } })).toThrow();
    expect(() => normalizeSite({ business: { ...businessDefaults, phoneNumber: "bad" } })).toThrow();
    const page = pageDefinitions.find(page => page.id === "site-home")!;
    const entries = entriesFor(page.en, page.my);
    expect(() => normalizeSite({ pages: [{ id: page.id, entries: [...entries, entries[0]] }] })).toThrow();
  });
  it("ignores unknown paths instead of changing object prototypes", () => {
    const fallback = { title: "Original" };
    const result = applyEntries(fallback, [{ key: '["__proto__","polluted"]', label: "", kind: "string", en: "yes" }], "en");
    expect(result).toEqual(fallback);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
  it("connects published homepage and English dictionary edits to the website", async () => {
    vi.resetModules();
    const home = pageDefinitions.find(page => page.id === "site-home")!;
    const homeEntries = entriesFor(home.en, home.my);
    homeEntries.find(entry => entry.key === '["hero"]')!.en = "A newly published headline";
    const service = pageDefinitions.find(page => page.id === "site-services")!;
    const serviceEntries = entriesFor(service.en, service.my);
    serviceEntries.find(entry => entry.key === '["Packages"]')!.en = "Our new packages";
    vi.doMock("./snapshot.json", () => ({ default: { pages: [{ id: home.id, entries: homeEntries }, { id: service.id, entries: serviceEntries }] } }));
    const { copy } = await import("../content");
    const { translate, localize } = await import("../i18n");
    expect(copy.en.home.hero).toBe("A newly published headline");
    expect(translate("en", "services", "Packages")).toBe("Our new packages");
    expect(localize("en", "services", ["Packages"])).toEqual(["Our new packages"]);
    vi.doUnmock("./snapshot.json");
    vi.resetModules();
  });
});
