import { absoluteImageUrl } from "./cms/content";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { type Locale } from "./content";
import { getRouteMetadata } from "./routeMetadata";

export function PageMetadata({ locale }: { locale: Locale }) {
  const { pathname } = useLocation();
  const { title, description, missing, type, image, imageAlt, canonical } = getRouteMetadata(pathname, locale);

  useEffect(() => {
    document.title = title;
    const setMeta = (attribute: "name" | "property", key: string, value: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, key);
        document.head.append(element);
      }
      element.content = value;
    };
    setMeta("name", "description", description);
    setMeta("name", "robots", missing ? "noindex, follow" : "index, follow");
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", type);
    setMeta("property", "og:image", absoluteImageUrl(image));
    setMeta("property", "og:image:alt", imageAlt);
    setMeta("property", "og:url", canonical);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.append(link); }
    if (missing) link.remove(); else link.href = canonical;
  }, [title, description, missing, type, image, imageAlt, canonical]);

  return null;
}
