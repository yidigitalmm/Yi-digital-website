import { business, getMedia } from "./cms/siteContent.ts";
import { type Locale } from "./content.ts";
import { getArticles } from "./cms/content.ts";

export { seoCopy as pages } from "./cms/siteContent.ts";
import { seoCopy as pages } from "./cms/siteContent.ts";

export const publicRoutes = [...Object.keys(pages.en), ...getArticles("en").map(article => `/journal/${article.slug}`)];

export function getRouteMetadata(pathname: string, locale: Locale = "en") {
  const path = pathname.replace(/\/+$/, "") || "/";
  const normalized = path === "/previous-work" ? "/our-work" : path;
  const article = getArticles(locale)
    .find(item => normalized === `/journal/${item.slug}`);
  const page = pages[locale][normalized as keyof typeof pages.en];
  const missing = !article && !page;
  const [title, description] = article ? [article.title, article.summary] : page ?? (locale === "my"
    ? ["စာမျက်နှာကို ရှာမတွေ့ပါ", "ဤစာမျက်နှာကို ရှာမတွေ့ပါ။ Yi Digital ပင်မစာမျက်နှာသို့ ပြန်သွားပါ သို့မဟုတ် ကျွန်ုပ်တို့ကို ဆက်သွယ်ပါ။"]
    : ["Page not found", "This page could not be found. Return to Yi Digital's homepage or contact us for help."]);

  return { title: `${title} | ${business.brandName}`, description, missing, type: article ? "article" : "website", image: article?.image ?? getMedia("socialShare", "/social-share.png"), imageAlt: article?.imageAlt ?? "Yi Digital logo", canonical: `https://yidigitalmm.com${normalized}` };
}
