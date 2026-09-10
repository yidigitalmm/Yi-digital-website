# Yi Digital content management

Project: `zq4h340g`. Dataset: `production` (public). Plan: Free.

The Studio manages Journal and Previous Work, plus the existing page text, packages and pricing, FAQs, navigation, footer, animation descriptions, contact/social links, website images, and page search descriptions. English and Myanmar text are editable together. Layouts, animation behavior, and video/3D assets remain in code.

## First-time sign-in and import

From the website folder:

```sh
npm run cms:login
npm run cms:import
npm run cms:sync
npm run cms:dev
```

The login opens Sanity's own sign-in flow. Do not paste passwords or tokens into chat. The import uses your authenticated CLI session, uploads the existing article and project images, and creates 7 bilingual articles and 4 bilingual projects. It does not overwrite existing documents when rerun. Run this migration once; after editors start deleting entries, do not re-import unless you intend to restore those originals.

Open the dashboard at http://localhost:3333. If Sanity requests a CORS origin, add exactly `http://localhost:3333` in the project's API settings, with credentials allowed. Do not use a wildcard origin.

## Edit and preview locally

1. Open Journal or Previous Work in the dashboard.
2. Edit Details, English, or Myanmar. Lower display-order numbers appear first; the first article is featured.
3. Click Publish.
4. Run `npm run cms:sync`, then start the website with `npm run dev` (or refresh the already-running local site).

Myanmar is optional; entries without a Myanmar object use English. If you add a translation, complete its required fields before publishing. Article URLs are shared between languages. Changing an existing URL requires a redirect to preserve external links.

This initial integration previews published content locally. Embedded live draft previews and click-to-edit overlays are not configured.

## Build and future deployment

`npm run build` fetches published Sanity content before building the site. The website, article routes, sharing metadata, and generated sitemap all use that same snapshot. A failed fetch or invalid content stops the build, preserving the last successful deployment. No write token is included in the public website.

For an offline check of the last snapshot, use `npm run build:offline`. Do not use this as the normal deployment command because it skips new CMS changes.

Once the website has a Git-connected Cloudflare Pages deployment, use `npm run build`, output `dist`, and configure a Cloudflare deploy hook as a Sanity webhook (POST; create/update/delete; filter `_type in ["journalArticle", "workProject", "sitePage", "siteBusiness", "siteMedia"]`). Keep the deploy-hook URL private. Deployment and this automatic trigger have not been configured yet. Until then, clicking Publish changes Sanity; the website updates after a sync/build.

## Editing the remaining pages

Open a named page in the Studio sidebar, then open a row under Page text. Each row has English and Myanmar fields. Empty Myanmar text falls back to English. Page structures and the number of package columns are fixed to preserve the design; these controls edit existing content rather than add new page layouts. Package names also update the enquiry form options.

Use Contact & social links for public phone, email, address, and social links. Changing the public email does not change the contact form's server-side recipient. Website images controls logos, hero images, page illustrations, project-deck images, and motion posters. Keep replacement dimensions similar to the originals. Text baked into image artwork requires replacing that artwork.

`npm run cms:import-pages` installs the additional page documents and uploads existing website images. It preserves existing published text, appends newly introduced fields, skips drafts, and never overwrites Journal or Previous Work entries. New fixed page structures require a code/schema update.

## Maintenance

- `npm run cms:build` verifies the dashboard production bundle.
- `npm test -- --run` runs the site tests, including translation fallback and content validation.
- `src/cms/snapshot.json` contains only published website content and may be committed.
- `studio/project.ts` contains public identifiers, not credentials.
- Customer enquiries and other private records do not belong in this public content dataset.
