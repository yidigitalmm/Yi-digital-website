import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getCliClient } from "sanity/cli";
import { apiVersion } from "../../studio/project";
import { pageDefinitions, businessDefaults, mediaDefaults } from "../../src/cms/siteDefaults";
import { entriesFor, type TextEntry } from "../../src/cms/siteModel";

const client = getCliClient({ apiVersion, perspective: "raw" });
async function main() {
  const ids = [...pageDefinitions.map(page => page.id), "site-business", "site-media"];
  const documents = await client.fetch<Array<{ _id: string; entries?: TextEntry[] }>>("*[_id in $ids]{_id, entries}", { ids: [...ids, ...ids.map(id => `drafts.${id}`)] });
  const saved = new Map(documents.map(doc => [doc._id, doc]));
  // This migration never touches existing journal or work documents.
  for (const page of pageDefinitions) {
    const existing = saved.get(page.id);
    const draft = saved.get(`drafts.${page.id}`);
    if (draft) { console.log(`Kept draft: ${page.title}`); continue; }
    if (existing) {
      const keys = new Set((existing.entries ?? []).map((entry: { key: string }) => entry.key));
      const missing = entriesFor(page.en, page.my).filter(entry => !keys.has(entry.key)).map(entry => ({ ...entry, _key: `text-${createHash("sha256").update(entry.key).digest("hex").slice(0, 16)}`, _type: "siteText" }));
      if (missing.length) await client.patch(page.id).setIfMissing({ entries: [] }).append("entries", missing).commit();
      console.log(`Kept existing: ${page.title}${missing.length ? ` (added ${missing.length} new fields)` : ""}`);
      continue;
    }
    await client.createIfNotExists({ _id: page.id, _type: "sitePage", title: page.title,
      entries: entriesFor(page.en, page.my).map((entry, index) => ({ ...entry, _key: `text-${index}`, _type: "siteText" })),
    });
    console.log(`Added: ${page.title}`);
  }
  if (!saved.has("drafts.site-business") && !saved.has("site-business")) await client.createIfNotExists({ _id: "site-business", _type: "siteBusiness", ...businessDefaults });
  if (!saved.has("site-media") && !saved.has("drafts.site-media")) {
    const items = [];
    for (const [key, path] of Object.entries(mediaDefaults)) {
      const data = await readFile(new URL(`../../public${path}`, import.meta.url));
      const asset = await client.assets.upload("image", data, { filename: path.split("/").pop() });
      items.push({ _key: key, _type: "siteImage", key, label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase()), image: { _type: "image", asset: { _type: "reference", _ref: asset._id } } });
    }
    await client.createIfNotExists({ _id: "site-media", _type: "siteMedia", items });
    console.log(`Added ${items.length} website image slots.`);
  }
  console.log("Page import complete. Run npm run cms:sync to update the local website.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
