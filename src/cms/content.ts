import snapshot from "./snapshot.json";
import { journalArticles, type JournalArticle } from "../journalContent";
import { journalArticlesMy } from "../journalContent.my";
import { workItems } from "../workContent";
import { localize } from "../i18n";
import type { Locale } from "../content";

export type WorkItem = {
  type: string; title: string; summary: string; image: string;
  websitePreview: boolean; scrollImage?: string; packageName: string; url?: string;
  addons: string[]; delivered: string[]; outcome: string;
};
export type ContentSnapshot = {
  enabled: boolean;
  articles: Array<{ en: JournalArticle; my: JournalArticle }>;
  work: Array<{ en: WorkItem; my: WorkItem }>;
};
const content = snapshot as ContentSnapshot;
export function getArticles(locale: Locale): JournalArticle[] {
  return content.enabled ? content.articles.map(item => item[locale]) : locale === "my" ? journalArticlesMy : journalArticles;
}
export function getWork(locale: Locale): readonly WorkItem[] {
  return content.enabled ? content.work.map(item => item[locale]) : localize(locale, "previousWork", workItems) as unknown as WorkItem[];
}
export const absoluteImageUrl = (image: string) => new URL(image, "https://yidigitalmm.com").href;
