# Yi Digital — Maintainer Guide

Private source repository for Yi Digital’s English and Myanmar website. This guide covers local development, content editing, deployment, and operational handover. Keep it updated when infrastructure, content schemas, or release procedures change.

The site includes service packages, selected projects, a journal, interactive motion and 3D showcases, and consultation enquiries. It uses React 19, TypeScript, React Router, and Vite; GSAP, Motion, and Three.js handle animation. Sanity manages content. The contact API runs on Cloudflare Pages Functions with Turnstile and Resend.

## Access and project configuration

Obtain access from the project owner before taking over production maintenance. Store credentials in the team's approved password manager and hosting secret settings, never in this README or Git.

| Service | Required access or configuration |
| --- | --- |
| GitHub | Repository access; permission to review changes and inspect Actions runs |
| Cloudflare | Pages project, deployment settings, runtime secrets, domain/DNS, and Turnstile widget |
| Sanity | Project `zq4h340g`, dataset `production`; editor access for content and appropriate project access for configuration |
| Resend | Sending domain, API key management, and delivery logs |
| Business email | Access to the enquiry inbox or a designated person who can confirm delivery |

Sanity identifiers live in `studio/project.ts`. The code uses `https://yidigitalmm.com` for canonical URLs and the sitemap. The contact handler currently sends from `Yi Digital <inquiry@yidigitalmm.com>` to `yidigitalmm@gmail.com`.

The repository does not establish the current Cloudflare project name, deployment branch, deployed Studio URL, webhook status, account owners, or backup schedule. Confirm these in the service dashboards during handover and record verified details here. Do not assume that a configured integration is active just because its code exists.

Repository privacy does not make website content private: the public Sanity dataset and the content bundled into the website are for published material. Do not store customer enquiries, credentials, or internal notes there.

## Local development

Use Node.js 22.13 or later within Node 22, with npm. For nvm users, `.nvmrc` selects Node 22.

Run from the repository root:

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Install dependencies at the root; the website and Studio share the root installation and lockfile. Use `npm ci` for reproducible setup and commit intentional dependency changes together with `package-lock.json`.

The website can run from its saved content snapshot without a Sanity login. Remote CMS images still require network access. Vite serves the frontend; it does not execute the contact endpoint.

### Environment variables

| Variable | Local location | Production location | Purpose |
| --- | --- | --- | --- |
| `VITE_TURNSTILE_SITE_KEY` | `.env.local` | Pages build environment | Public contact widget key |
| `TURNSTILE_SECRET_KEY` | `.dev.vars` | Pages runtime secret | Server-side Turnstile verification |
| `RESEND_API_KEY` | `.dev.vars` | Pages runtime secret | Sending business and customer emails |

Create `.env.local` when configuring contact verification:

```dotenv
VITE_TURNSTILE_SITE_KEY=your_public_site_key
```

Create `.dev.vars` for local API testing:

```dotenv
TURNSTILE_SECRET_KEY=your_turnstile_secret
RESEND_API_KEY=your_resend_api_key
```

Both files are ignored by Git. Never give a server secret a `VITE_` prefix: those variables are embedded in the browser bundle. Restart the development server after changing build variables; rebuild deployed assets after changing the public site key. Configure preview and production environments separately where needed.

### Testing the contact endpoint locally

```sh
npm run build:offline
npx wrangler pages dev dist --port 8788
```

This serves the built website and Pages Functions. For frontend hot reload, also run `npm run dev` in another terminal; its `/api` proxy targets port 8788. `npm run preview` is a static preview and does not provide the API runtime or the development proxy.

The sending domain must be verified in Resend. Configure the Turnstile widget for the hostname being tested. The server requires the verified hostname to match the request hostname and the action to be `contact`; generic dummy test keys do not satisfy these checks. Local submissions with real credentials send real emails.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend development |
| `npm test` | Run tests in watch mode |
| `npm test -- --run` | Run automated tests once |
| `npm run build` | Fetch and validate published CMS content, type-check, and build |
| `npm run build:offline` | Type-check and build with the saved snapshot; no CMS sync |
| `npm run preview` | Preview the built static frontend |
| `npm run cms:login` | Authenticate the Sanity CLI |
| `npm run cms:dev` | Start local Sanity Studio |
| `npm run cms:sync` | Update the published content snapshot |
| `npm run cms:build` | Build Sanity Studio |
| `npm run cms:import` | Seed original journal and work content; use only for an intentional migration |
| `npm run cms:import-pages` | Seed page/business/media documents and append missing page fields |

## Content workflow and source of truth

```text
Sanity published documents
    → cms:sync fetches and validates content
    → src/cms/snapshot.json
    → website bundle, route metadata, and sitemap
    → deployment
```

For routine content changes:

1. Run `npm run cms:login` and `npm run cms:dev`, or use the team's verified hosted Studio address.
2. Edit and publish the relevant content. Drafts are not fetched by the website build.
3. Run `npm run cms:sync` for local review, then start or restart the frontend to inspect the result.
4. Review both languages and the snapshot diff. Commit intentional snapshot updates when they form part of a repository change.
5. Trigger a production build, or confirm that the configured webhook triggered one successfully.

A successful Sanity publish does not by itself update the deployed website. The normal build fetches the latest published content. A failed fetch or validation stops the build and leaves the previous local snapshot intact; investigate the failure rather than routinely deploying an old snapshot with `build:offline`.

### What editors can change

Sanity manages page text, prices and package details, business contact/social details, image slots, journal articles, and previous-work entries. Code defines layout, page structure, available image slots, animation behavior, video sources, and the 3D model.

- `src/cms/siteContent.ts` applies published page/media/business values over code defaults. Editing a default may have no visible effect if the CMS supplies that value.
- `src/cms/content.ts` uses published journal/work entries when the setup marker is enabled; otherwise it uses the original content files.
- Missing Myanmar translations generally fall back to English. Partially supplied article or project translations must still satisfy validation; check both languages after editing.
- `src/cms/snapshot.json` is generated published content. Hand edits will be replaced on the next successful sync.

### Schema changes and migrations

Page text keys encode object paths and array indexes from the defaults. Renaming a key, changing its type, or reordering an array can invalidate saved CMS entries or apply text to the wrong item. Coordinate changes across defaults, schemas, normalization, and stored documents; review a dataset backup before destructive migrations.

`cms:import` uses stable IDs and does not overwrite existing journal/work documents, but rerunning it can recreate originals that an editor deleted. `cms:import-pages` preserves existing values, skips pages with drafts, and appends missing fields to existing published pages. It does not migrate renamed keys or automatically extend an existing media document with new slots. Both commands write to the configured Sanity dataset and may upload assets; they are not routine preview commands.

## Where to make changes

| Change | Main files |
| --- | --- |
| Page layouts and routes | `src/pages.tsx`, `src/App.tsx` |
| Header, footer, navigation, themes | `src/ui.tsx`, `src/styles.css` |
| Text defaults and translations | `src/contentDefaults.ts`, `src/interfaceCopyDefaults.ts`, `src/animationCopyDefaults.ts`, `src/i18n.ts` |
| CMS page definitions and image slots | `src/cms/siteDefaults.ts`, `src/cms/siteModel.ts` |
| Studio schemas and navigation | `studio/schemaTypes.ts`, `studio/siteSchema.ts`, `studio/sanity.config.ts` |
| CMS fetch and validation | `scripts/cms/sync.ts`, `scripts/cms/normalize.ts`, `scripts/cms/siteNormalize.ts` |
| SEO, canonical URLs, sitemap | `src/seoDefaults.ts`, `src/routeMetadata.ts`, `src/cms/content.ts`, `scripts/static-route-html.ts`, `index.html`, `public/robots.txt` |
| Contact UI and verification | `src/pages.tsx`, `src/ContactVerification.tsx` |
| Email recipients, sender, and email copy | `functions/api/contact.ts` |
| Motion and 3D | `src/animationShowcase.tsx`, `src/NanotechRevealCanvas.tsx`, `src/InstantCameraShowcase.tsx`, `src/instantCamera*.ts`, `src/createInstantCameraModel.ts` |
| Local assets and API routing | `public/`, `public/_routes.json` |
| Build configuration and CI | `vite.config.ts`, `package.json`, `.github/workflows/ci.yml` |

Keep runtime media in `public/`. Local archives and drafts belong in the ignored `local-only/` folder and are not available to a fresh clone. The website must not depend on them. Retain assets referenced by defaults and migration scripts even when the current snapshot uses CMS-hosted replacements.

## Contact service operations

**The contact email shown on the site and the actual email recipient are separate settings.** Updating the business email in Sanity does not change the recipient, sender, Reply-To behavior, or email body in `functions/api/contact.ts`. Review both when business contact details change.

The handler validates input, same-origin requests, a honeypot, and Turnstile before submitting a Resend batch with a business notification and a customer acknowledgement. Success means Resend accepted both messages; it does not prove inbox delivery. Matching retries within the same UTC day use an idempotency key to reduce duplicates.

There is no enquiry database in this project. Check Resend delivery logs and the business inbox when investigating missing enquiries. Automated tests mock email delivery and do not establish whether real messages reach an inbox.

## Deployment and rollback

| Setting | Expected value |
| --- | --- |
| Hosting | Cloudflare Pages with Pages Functions |
| Project root | Repository root |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 22.13 or later within Node 22 |
| Runtime API | `functions/api/contact.ts` at `/api/contact` |

Use a deployment flow that includes the repository's `functions/` directory. Uploading `dist` alone through a static-only flow omits the contact API. Confirm the actual production branch, environment variables, domain aliases, and Turnstile hostname settings in Cloudflare.

A Sanity webhook may trigger a Pages deploy hook. If configured, it must cover page, business, media, journal, and work changes—not only articles. Keep the deploy-hook URL private and verify that an editor's publish actually produces a successful deployment.

Route HTML contains generated metadata, not fully rendered React page bodies. When adding a route or changing an article slug, update metadata and redirects as needed; check direct navigation, the sitemap, canonical URLs, and missing-page behavior. A domain change also requires updates to the hard-coded SEO origin, DNS, Turnstile, and email sending-domain configuration.

For a faulty release, restore a known-good deployment through the hosting workflow, then diagnose the code or content change. A Git revert followed by `npm run build` still fetches the latest CMS content; it does not restore older published content. Restore or correct the CMS separately when content caused the issue. An intentional emergency snapshot build should be documented and followed by fixing normal CMS synchronization.

## Verification before release

Run the checks used by GitHub Actions:

```sh
npm test -- --run
npm run build:offline
npm run cms:build
```

Also verify `npm run build` when CMS connectivity or published content changed. CI uses the committed snapshot, so green checks alone do not prove that current CMS content passes synchronization. Do not rely on a fixed test count; check that the current suite completes successfully.

On the deployment preview, check:

- English and Myanmar text, light/dark themes, mobile layouts, and keyboard navigation.
- Direct page and article URLs, missing pages, metadata, images, and video fallbacks.
- Interactive animation and camera behavior on a real phone as well as desktop.
- A real enquiry using an address you control: both emails, spam folders, and Reply-To behavior.

## Troubleshooting

| Symptom | First checks |
| --- | --- |
| Published content is missing | Confirm it is published, not a draft; run `cms:sync`; inspect snapshot changes and the deployment build log. |
| Sync reports invalid keys or text | Compare CMS entries with current defaults and normalization rules; check for renamed keys, reordered arrays, incomplete translations, or draft pages skipped by migration. |
| Verification widget is absent | Check `VITE_TURNSTILE_SITE_KEY`, restart/rebuild, and inspect browser network errors or script blocking. |
| Contact returns 400 or 403 | Check required fields, widget hostname/action, and same-origin requests. |
| Contact returns 503 | Check that both runtime secrets are present in the environment handling the request. |
| Contact returns 502 | Inspect Turnstile/Resend availability, secret validity, sender-domain verification, and provider logs. |
| Contact works locally but fails after deployment | Confirm Pages Functions was included and production secrets and hostname settings are configured. |
| Success shown but no email arrives | Inspect Resend delivery status, recipient settings, spam filtering, and the business inbox. |
| An image disappeared after cleanup | Check code defaults, CMS snapshot, migration references, and 3D texture URLs before moving assets out of `public/`. |

After resolving an operational issue, update this guide if the fix changes the maintenance procedure or configuration.
