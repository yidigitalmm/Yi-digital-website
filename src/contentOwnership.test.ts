import { describe, expect, it } from "vitest";
import { applyEditorialEntries, isCodeManagedEntry } from "./cms/contentOwnership";
import { entriesFor } from "./cms/siteModel";
import { normalizeSite } from "../scripts/content/siteNormalize";
import { copy } from "./contentDefaults";

describe("content ownership", () => {
  it.each(["en", "my"] as const)("keeps code navigation while accepting editorial changes in %s", locale => {
    const defaults = { nav: ["Our Work"], copyright: "Default footer", text: { Discover: "Discover" } };
    const cms = { nav: ["Stale label"], copyright: "Edited footer", text: { Discover: "Editorial heading" } };
    expect(applyEditorialEntries("site-global", defaults, entriesFor(cms, cms), locale)).toEqual({
      nav: ["Our Work"], copyright: "Edited footer", text: { Discover: "Editorial heading" },
    });
  });

  it("ignores old form messages but preserves service content", () => {
    const entries = entriesFor({ label: "CMS edit" }, { label: "CMS edit" });
    expect(applyEditorialEntries("site-messages", { label: "Code message" }, entries, "en").label).toBe("Code message");
    expect(applyEditorialEntries("site-services", { label: "Default" }, entries, "en").label).toBe("CMS edit");
  });

  it("excludes legacy code-owned rows when synchronizing published content", () => {
    const entries = entriesFor(copy.en.global, copy.my.global);
    const normalized = normalizeSite({ pages: [
      { id: "site-global", entries },
      { id: "site-messages", entries: entriesFor({ obsolete: "Old message" }, {}) },
    ] });
    expect(normalized.pages).toHaveLength(1);
    expect(normalized.pages[0].entries.some(entry => entry.key === '["nav",3]')).toBe(false);
    expect(normalized.pages[0].entries.some(entry => entry.key === '["copyright"]')).toBe(true);
  });

  it("recognizes code-owned rows in Studio drafts", () => {
    expect(isCodeManagedEntry("drafts.site-global", '["nav",3]')).toBe(true);
    expect(isCodeManagedEntry("drafts.site-messages", '["Close"]')).toBe(true);
    expect(isCodeManagedEntry("site-global", '["text","Discover"]')).toBe(false);
  });
});
