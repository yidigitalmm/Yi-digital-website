# Yi Digital

English and Myanmar website built with React, TypeScript and Vite. Cloudflare Worker `yi-digital-website` serves the site and contact API. Decap provides a content editor at `/admin/`; GitHub is the source of truth for code and content.

## Publishing

- Editor: open `/admin/`, edit content, save a draft, then publish. Decap stores drafts on GitHub branches and publishing merges the change into `main`.
- Developer: pull the latest GitHub changes, edit content files or application code, and push through the usual review process.
- A change to `main` triggers Cloudflare's connected Git build. The build validates content, runs tests and builds the website. No CMS synchronization step is needed.

See [PUBLISHING.md](PUBLISHING.md) for the one-time GitHub sign-in setup and migration cutover. The local implementation alone does not activate production authentication.

## Local development

Use Node 24 (see `.node-version`), then run:

```sh
npm ci
npm run dev
```

For the local content editor, also run `npm run cms:dev` in a second terminal and open `/admin/` on the Vite address. Local editor saves modify working files directly; they do not publish to GitHub. After saving, run `npm run content:build` to refresh the website content. Stop the local editor server when finished; it intentionally listens only on loopback.

| Command | Purpose |
| --- | --- |
| `npm run content:build` | Validate content and images; generate the website snapshot and editor configuration |
| `npm run build` | Generate content, run tests, type-check and build production assets |
| `npm test -- --run` | Run tests once |
| `npm run build:offline` | Build using the last generated snapshot |
| `npm run preview` | Preview built static assets |
| `npm run cms:dev` | Start the local Decap editing server |

## Where to edit

| Content or feature | Location |
| --- | --- |
| Articles in both languages | `content/journal/*.json` |
| Projects in both languages | `content/work/*.json` |
| Page text and prices | `content/pages/*.json` |
| Business details and image slots | `content/settings/*.json` |
| Uploaded images | `public/uploads/` |
| Navigation and shared interface text | `src/contentDefaults.ts`, `src/interfaceCopyDefaults.ts` |
| Layout, routes and styling | `src/pages.tsx`, `src/App.tsx`, `src/ui.tsx`, `src/styles.css` |
| Editor fields | `scripts/content/admin-config.ts` |
| Content validation | `scripts/content/normalize.ts`, `scripts/content/siteNormalize.ts` |
| Contact emails | `functions/api/contact.ts` |
| GitHub editor sign-in | `functions/cms-auth.ts` |
| Worker and deployment configuration | `worker.ts`, `wrangler.jsonc` |

`src/cms/snapshot.json` and `public/admin/config.yml` are generated; edit their source files instead. Commit regenerated files with developer content changes. Decap commits source content, and Cloudflare regenerates these outputs during the build.

Developers can bulk-edit every content JSON file. The editor exposes only designated editorial fields. Navigation, shared interface messages, layout, routes and animation remain code-owned; `src/cms/contentOwnership.ts` enforces that boundary. Existing page keys encode paths and array positions: preserve them during ordinary editing. Structural changes need matching defaults, content and validation updates.

Article filenames must match their `slug`; project filenames must match their `id`. Preserve published article addresses or add redirects when changing them. Display order is a nonnegative integer. Image values must point to existing local files under `public/`; upload images in Decap or add them in Git. Keep original assets still referenced by code defaults.

The site supports Myanmar fallback to English where allowed by validation. The editor asks for complete article/project translations. Review both languages before publishing. Website content and images are public even if the repository is private; keep internal notes and credentials elsewhere.

## Contact API

| Variable | Location | Purpose |
| --- | --- | --- |
| `VITE_TURNSTILE_SITE_KEY` | `.env.local` / Cloudflare build variable | Public widget key |
| `TURNSTILE_SECRET_KEY` | `.dev.vars` / Worker runtime secret | Server verification |
| `RESEND_API_KEY` | `.dev.vars` / Worker runtime secret | Email delivery |
| `GITHUB_CLIENT_ID` | Worker runtime variable | Decap OAuth app ID |
| `GITHUB_CLIENT_SECRET` | Worker runtime secret | Decap OAuth app secret |

Local credential files are ignored. Never prefix a secret with `VITE_`: those values are bundled into public browser code.

For local Worker testing, build first and run `npx wrangler dev --port 8788`. Vite proxies `/api` there. A static preview does not execute the API. OAuth is deliberately restricted to the production origin; local editing uses the Decap local server.

The contact endpoint validates same-origin requests, required fields, a honeypot and Turnstile hostname/action before sending a business notification and acknowledgement through Resend. Real submissions send real email. Empty same-origin JSON requests should return JSON `400`, or `503` if secrets are missing. GET intentionally returns `405`.

Updating the public business email does not change the actual recipient in the contact handler. The current sender is `inquiry@yidigitalmm.com`; recipient is `yidigitalmm@gmail.com`. Check Resend delivery logs and the inbox for delivery failures. There is no enquiry database.

## Release checks

Run `npm run build`. Review English/Myanmar content, images, mobile layouts, direct article URLs, sitemap/metadata, theme switching and interactive showcases. Check `/admin/` and GitHub sign-in after deployment. Test real email delivery only when intended.

Cloudflare uses repository root `/`, build `npm run build`, deploy `npx wrangler deploy`, and production branch `main`. Preserve the existing Worker domain and contact secrets. CI checks pull requests separately; configure branch protection if passing checks must be required before merges.

Revert a faulty code or content commit in GitHub to trigger a corrective build. Cloudflare deployment rollback can restore the public site immediately, but also correct GitHub so the next build does not reintroduce the problem.

Dependency and editor bundle maintenance are documented in [MAINTENANCE.md](MAINTENANCE.md).
