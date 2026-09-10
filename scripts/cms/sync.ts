import { readFile, rename, writeFile } from "node:fs/promises";
import { projectId, dataset, apiVersion } from "../../studio/project";
import { normalizeContent } from "./normalize";
import { normalizeSite } from "./siteNormalize";

// Fetch one published snapshot for both the browser bundle and generated metadata.
const query = `{
  "enabled": count(*[_id == "yiDigitalContentSetup"]) > 0,
  "pages": *[_type == "sitePage"] { "id": _id, entries },
  "business": *[_id == "site-business"][0],
  "media": coalesce(*[_id == "site-media"][0].items[]{key, "url": image.asset->url}, []),
  "articles": *[_type == "journalArticle"] | order(order asc, _id asc) {
    "slug": slug.current, en, my, "image": image.asset->url
  },
  "work": *[_type == "workProject"] | order(order asc, _id asc) {
    en, my, websitePreview, url, "image": image.asset->url, "scrollImage": scrollImage.asset->url
  }
}`;
const url = new URL(`https://${projectId}.api.sanity.io/v${apiVersion}/data/query/${dataset}`);
url.searchParams.set("query", query);
url.searchParams.set("perspective", "published");
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Sanity returned HTTP ${response.status}`);
  const { result } = await response.json();
  const path = new URL("../../src/cms/snapshot.json", import.meta.url);
  const existing = JSON.parse(await readFile(path, "utf8"));
  if (!result.enabled && existing.enabled) throw new Error("CMS setup marker is missing; refusing to restore old content.");
  const content = { ...normalizeContent(result), ...normalizeSite(result) };
  const next = JSON.stringify(content, null, 2) + "\n";
  if (next !== await readFile(path, "utf8")) {
    const temporary = new URL("../../src/cms/snapshot.json.tmp", import.meta.url);
    await writeFile(temporary, next);
    await rename(temporary, path);
  }
  console.log(content.enabled ? `Sanity synced: ${content.articles.length} articles and ${content.work.length} projects.` : "Sanity connected. Run cms:import after login to migrate the existing content. Website still uses its original content.");
} catch (error) {
  console.error("Content sync failed. The previous snapshot is unchanged; publishing has stopped.", error);
  process.exitCode = 1;
}
