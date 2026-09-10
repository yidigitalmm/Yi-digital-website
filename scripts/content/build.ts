import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { renderContent } from './model.ts';

const read = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
async function folder(path: string) {
  const files = (await readdir(path)).filter(file => file.endsWith('.json')).sort();
  return Promise.all(files.map(async file => ({ id: file.slice(0, -5), data: await read(`${path}/${file}`) })));
}
const [pages, articles, work, business, media] = await Promise.all([
  folder('content/pages'), folder('content/journal'), folder('content/work'), read('content/settings/business.json'), read('content/settings/media.json'),
]);
for (const article of articles) if (article.id !== article.data.slug) throw new Error(`Article filename must match slug: ${article.id}`);
for (const item of work) if (item.id !== item.data.id) throw new Error(`Project filename must match ID: ${item.id}`);
const snapshot = renderContent({ pages, articles: articles.map(item => item.data), work: work.map(item => item.data), business, media });
const paths = new Set(snapshot.media.map(item => item.url));
for (const item of [...snapshot.articles, ...snapshot.work]) {
  for (const locale of ['en', 'my'] as const) {
    paths.add(item[locale].image);
    if ('scrollImage' in item[locale] && item[locale].scrollImage) paths.add(item[locale].scrollImage as string);
  }
}
const publicRoot = resolve('public');
for (const path of paths) {
  const file = resolve(publicRoot, '.' + path);
  if (!file.startsWith(publicRoot + sep) || !(await stat(file)).isFile()) throw new Error(`Missing or unsafe image: ${path}`);
}
await writeFile('src/cms/snapshot.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Built Git content: ${articles.length} articles, ${work.length} projects, ${pages.length} page groups, ${paths.size} image paths.`);
