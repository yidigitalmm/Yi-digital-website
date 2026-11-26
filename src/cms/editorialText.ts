import defaults from './editorialDefaults.json' with { type: 'json' };
import { pageContent } from './siteContent.ts';

const { "motion-use-cases": _motion, ...textDefaults } = defaults;
type Group = keyof typeof textDefaults;
const resolved = Object.fromEntries(Object.entries(textDefaults).map(([id, values]) => [id, {
  en: pageContent(`site-${id}`, 'en', values.en),
  my: pageContent(`site-${id}`, 'my', values.my),
}])) as unknown as Record<Group, Record<'en' | 'my', Record<string, string>>>;
export function editorialText(group: Group, locale: 'en' | 'my', english: string, myanmar: string) {
  return resolved[group][locale][english] ?? (locale === 'my' ? myanmar : english);
}
