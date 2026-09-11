import { business, getMedia } from "../src/cms/siteContent.ts";
import { absoluteImageUrl } from "../src/cms/content.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { Plugin } from "vite";
import { getRouteMetadata, publicRoutes } from "../src/routeMetadata.ts";

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function renderRouteHtml(template: string, path: string) {
  const meta = getRouteMetadata(path);
  const clean = template.replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<meta\s+(?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*>/g, "")
    .replace(/<link\s+rel="canonical"[^>]*>/g, "");
  const tag = (key: string, value: string) => `<meta ${key.startsWith("og:") ? "property" : "name"}="${key}" content="${escape(value)}" />`;
  const head = [
    `<title>${escape(meta.title)}</title>`,
    ...(path === "/" ? [`<link rel="preload" as="image" href="${escape(getMedia("heroBrowser", "/images/hero-animation/browser-window-supplied.webp"))}" fetchpriority="high" />`] : []),
    tag("description", meta.description), tag("robots", meta.missing ? "noindex, follow" : "index, follow"),
    tag("og:title", meta.title), tag("og:description", meta.description), tag("og:type", meta.type),
    tag("og:site_name", business.brandName), tag("og:image", absoluteImageUrl(meta.image)), tag("og:image:alt", meta.imageAlt),
    tag("twitter:card", "summary_large_image"),
    ...(!meta.missing ? [tag("og:url", meta.canonical), `<link rel="canonical" href="${escape(meta.canonical)}" />`] : []),
  ].join("\n    ");
  return clean.replace("</head>", `${head}\n  </head>`);
}

export function staticRouteHtml(): Plugin {
  let outDir: string;
  return {
    name: "static-route-html",
    apply: "build",
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const template = await readFile(resolve(outDir, "index.html"), "utf8");
      for (const path of [...publicRoutes, "/previous-work", "/404"]) {
        const file = resolve(outDir, path === "/" ? "index.html" : path === "/404" ? "404.html" : `${path.slice(1)}/index.html`);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, renderRouteHtml(template, path));
      }
      await writeFile(resolve(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${publicRoutes.map(path => `  <url><loc>${escape(`https://yidigitalmm.com${path}`)}</loc></url>`).join("\n")}
</urlset>
`);
      console.log(`Generated metadata HTML for ${publicRoutes.length} public routes, the work alias, and 404.`);
    },
  };
}
