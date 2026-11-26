# Activate Decap publishing

The intended flow is **Decap editor or code changes → GitHub → Cloudflare**. GitHub holds the same content files for both editing methods. Sanity is no longer part of the new build.

## 1. Configure editor sign-in

In GitHub, open Settings → Developer settings → OAuth Apps → New OAuth App. Use an account or organization controlled by the website owner:

| Setting | Value |
| --- | --- |
| Application name | Yi Digital Content Editor |
| Homepage URL | `https://yidigitalmm.com` |
| Authorization callback URL | `https://yidigitalmm.com/api/cms/callback` |

Copy the Client ID and generate a Client Secret. In Cloudflare → Workers & Pages → `yi-digital-website` → Settings → Variables and Secrets, add:

- `GITHUB_CLIENT_ID`: the Client ID, as a runtime variable.
- `GITHUB_CLIENT_SECRET`: the Client Secret, as a runtime secret.

Do not paste the secret into chat or commit it. These belong to the Worker runtime, not only its build environment. Keep `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` intact.

Editors need GitHub accounts with write access to `yidigitalmm/Yi-digital-website`. The direct GitHub backend uses OAuth's `repo` scope, which can authorize access beyond this one private repository; our callback additionally checks write access to the configured repository before admitting an editor. Organization OAuth restrictions may require owner approval. Configure branch protection to match the team's review policy; Decap publishing cannot bypass required approvals.

## 2. Keep GitHub connected to Cloudflare

Use the existing Worker and domain:

- Repository: `yidigitalmm/Yi-digital-website`
- Production branch: `main`
- Root: `/`
- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Version command, if shown: `npx wrangler versions upload`

If the Git build integration was disabled while exploring Sanity synchronization, restore it. No separate GitHub deploy workflow or CMS deploy hook is needed. Keep the public Turnstile site key in build settings.

Merge the migration branch into `main` and confirm the Cloudflare build succeeds. The generated editor configuration targets `main`, regardless of the local development branch.

## 3. Verify before retiring Sanity

1. Check the live site in both languages, especially journal, Our Work, prices and images.
2. Open `https://yidigitalmm.com/admin/` and sign in with GitHub.
3. Make an intended small content edit, save a draft, and confirm a draft branch/PR appears in GitHub. Publish when ready, satisfying any required review checks.
4. Confirm the merge into `main` triggers Cloudflare and the live content changes.
5. Pull the latest `main`, make a content edit in code, run `npm run build`, and publish through GitHub. Confirm Decap displays that edit after refreshing.

Draft saves should not update production. Cloudflare may create preview versions for branches depending on its settings. Local Decap mode writes files directly and does not test the production GitHub draft/publish flow.

## 4. Sanity retirement status

Decap publishing and previews were verified by the owner on 2026-09-10. The site now uses Git-managed content and local media exclusively.

Completed:

- Removed Sanity Studio, dependencies, import/sync scripts and the retired two-way publishing workflow.
- Verified no Sanity credentials remain in local environment files or GitHub repository settings; GitHub has no configured environments.
- Sanity project `zq4h340g` lists no project API tokens and no registered hosted Studio.
- Deleted the local Sanity export archive, extracted dataset/assets, raw documents, retired source and migration scripts/references at the owner's request. No local Sanity backup is retained. Active Decap content and `public/uploads/` are unchanged.

Still pending: disable **Cloudflare rebuild** in Sanity project `zq4h340g`. The saved CLI login can read project metadata but the update API returns `401 Unauthorized` and says project membership is required. Sign in to Sanity Manage with an authorized project account, open API → Webhooks, and disable this webhook. The project and dataset have not been deleted.

Cloudflare account settings have not been audited in this cleanup. Remove any obsolete Sanity-only build variables if present; preserve the GitHub OAuth, Turnstile and Resend settings used by the current site.

References: [Decap GitHub backend](https://decapcms.org/docs/github-backend/), [external OAuth](https://decapcms.org/docs/external-oauth-clients/), [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## Preview links inside Decap

Cloudflare Workers reports builds as GitHub Check Runs, while Decap reads commit statuses. `.github/workflows/cms-preview.yml` bridges completed checks from the verified Cloudflare app into `deploy/decap-preview` statuses. It uses the immutable preview URL from the check summary and never publishes content or starts a deployment. No additional secret is needed. The workflow and `scripts/github/preview-status.cjs` must be merged into `main` before the event trigger becomes active.

After saving a draft, wait for its Cloudflare build and the **CMS preview link** workflow to finish, then click **Check for Preview** beside the publishing controls. The resulting preview link opens the draft site. **View Live** opens production. A missing or unrecognized URL is reported as an error rather than a successful preview.

## Current website editing (November 2026)

Under **Page text & pricing**:
- **Services — packages & system prices** controls current USD packages, system add-ons and displayed package terms. Old MMK packages and unused comparison-table/private draft fields are no longer shown.
- **Services — headings, inclusions & terms** controls section headings, package expansion charges, PDF language charges, maintenance percentage, Google/social and invitation prices, and supporting copy.
- **Connected presence — details** controls the Google/social description and included items.
- **Home — service summaries** controls the homepage cards. Keep `{singlePrice}` and `{businessPrice}` in the website summary; they are filled from current package prices. Other summary prices are editorial text: update them alongside the corresponding services price.
- **Home — search demonstration** controls Suky and the illustrative listing. Update the searching message alongside the name.
- **Animation — tea journey** controls tea copy and use-case labels. **Animation — example use cases** controls the three motion example tag sets. Existing **Animation page** fields still control the reveal, camera and main motion copy.
- **Services — updated FAQ answers** holds newer FAQ text. Original service copy remains under **Services & FAQs**.

Under **Business & images → Website images & animation media**, replace the service images, tea poster/video or motion example files. Preserve video formats: transparent examples use WebM, fallbacks and tea use MP4. Replacing video media does not change animation sequencing or interaction logic. Tea is one assembled video; editing individual source clips requires rebuilding it.

English and Myanmar are separate editable fields. Keep related descriptions consistent when changing a price or scope. The layout, number of cards, responsive behaviour, animation logic and camera model stay code-managed.

Publishing still requires the normal Git workflow and deployment build (`npm run build`). The build validates content and local media, regenerates the website snapshot and editor configuration, then tests and builds the site. Do not edit `src/cms/snapshot.json` or `public/admin/config.yml` directly. These CMS changes have not been pushed or deployed automatically.

### Local tea production files
The browser uses only `public/videos/start-end/tea-journey.mp4` and its poster. Original clips are kept in ignored `local-only/tea-source/` and are not required for CI or deployment. To rebuild with ffmpeg installed, run `node scripts/media/build-tea-journey.mjs`; an optional first argument selects another source directory containing the nine named clips. Private invoices, catalog decisions and design-review artifacts are also intentionally ignored.
