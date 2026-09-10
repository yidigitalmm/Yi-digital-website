import { normalizeContent } from './normalize.ts';
import { normalizeSite } from './siteNormalize.ts';
import type { TextEntry } from '../../src/cms/siteModel.ts';

export type PageFile = { title: string; strings: Row<string>[]; numbers: Row<number>[]; flags: Row<boolean>[] };
type Row<T> = { key: string; label: string; en: T; my?: T };
export function pageEntries(page: PageFile): TextEntry[] {
  return ([['strings', 'string', ''], ['numbers', 'number', 'Number'], ['flags', 'boolean', 'Boolean']] as const).flatMap(([group, kind, suffix]) => {
    if (!Array.isArray(page[group])) throw new Error(`Missing page group: ${group}`);
    return page[group].map(row => ({ key: row.key, label: row.label, kind, [`en${suffix}`]: row.en, ...(row.my != null ? { [`my${suffix}`]: row.my } : {}) }));
  });
}
export function renderContent(input: { pages: { id: string; data: PageFile }[]; business: Record<string, unknown>; media: { items: { key: string; url: string }[] }; articles: any[]; work: any[] }) {
  const order = (items: any[]) => [...items].sort((a, b) => a.order - b.order || (a.slug ?? a.id).localeCompare(b.slug ?? b.id));
  for (const item of [...input.articles, ...input.work]) {
    if (!Number.isInteger(item.order) || item.order < 0) throw new Error('Display order must be a nonnegative integer');
  }
  const workIds = input.work.map(item => item.id);
  if (new Set(workIds).size !== workIds.length || workIds.some(id => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) throw new Error('Invalid or duplicate project ID');
  return {
    ...normalizeContent({ enabled: true, articles: order(input.articles), work: order(input.work) }),
    ...normalizeSite({ pages: input.pages.map(page => ({ id: page.id, entries: pageEntries(page.data) })), business: input.business, media: input.media.items }),
  };
}
