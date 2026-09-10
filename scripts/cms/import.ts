import { readFile } from "node:fs/promises";
import { getCliClient } from "sanity/cli";
import { journalArticles } from "../../src/journalContent";
import { journalArticlesMy } from "../../src/journalContent.my";
import { workItems } from "../../src/workContent";
import { localize } from "../../src/i18n";
import { apiVersion } from "../../studio/project";

const client = getCliClient({ apiVersion });
const cache = new Map<string, object>();
async function upload(path: string) {
  if (cache.has(path)) return cache.get(path);
  const bytes = await readFile(new URL(`../../public${path}`, import.meta.url));
  const asset = await client.assets.upload("image", bytes, { filename: path.split("/").pop() });
  const image = { _type: "image", asset: { _type: "reference", _ref: asset._id } };
  cache.set(path, image);
  return image;
}
function articleText(article: typeof journalArticles[number]) {
  const { slug, image, ...text } = article;
  return { ...text, _type: "articleText", sections: text.sections.map((section, index) => ({ ...section, _type: "articleSection", _key: `section-${index}` })) };
}
function projectText(project: typeof workItems[number]) {
  const { image, scrollImage, websitePreview, url, ...text } = project;
  return { ...text, _type: "projectText" };
}
// Stable IDs and createIfNotExists ensure reruns cannot overwrite editor changes.
async function main() {
  for (const [index, article] of journalArticles.entries()) {
    const id = `journal-${article.slug}`;
    if (await client.getDocument(id)) continue;
    const translated = journalArticlesMy.find(item => item.slug === article.slug);
    await client.createIfNotExists({ _id: id, _type: "journalArticle", order: index,
      slug: { _type: "slug", current: article.slug }, image: await upload(article.image),
      en: articleText(article), ...(translated ? { my: articleText(translated) } : {}),
    });
    console.log(`Imported article: ${article.title}`);
  }
  for (const [index, project] of workItems.entries()) {
    const id = `work-${index + 1}`;
    if (await client.getDocument(id)) continue;
    await client.createIfNotExists({ _id: id, _type: "workProject", order: index,
      image: await upload(project.image), ...(project.scrollImage ? { scrollImage: await upload(project.scrollImage) } : {}),
      websitePreview: project.websitePreview, ...(project.url ? { url: project.url } : {}),
      en: projectText(project), my: projectText(localize("my", "previousWork", project)),
    });
    console.log(`Imported project: ${project.title}`);
  }
  await client.createIfNotExists({ _id: "yiDigitalContentSetup", _type: "contentSetup", initialized: true });
  console.log("Import complete. Run npm run cms:sync from the website folder.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
