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

## 4. Finish Sanity retirement

The migration copied 7 articles, 4 projects, 9 editorial page groups, business settings and 41 images. Code-owned navigation/interface fields remain in code. Published content was compared with the export after converting image paths; no drafts existed at export time.

Backups on the migration machine are under `local-only/backups/`, including `sanity-production-2026-09-10.tar.gz`, raw documents and retired source. This directory is ignored by Git. Copy the archive to the team's private backup storage before deleting the Sanity project.

Sanity Studio, its dependencies, import/sync scripts and the unfinished two-way publishing workflow have been removed from the working repository. The live Sanity project and existing webhook have intentionally been retained until the new flow is verified.

After verification:

- Disable the old Sanity **Cloudflare rebuild** webhook in project `zq4h340g`.
- Remove obsolete Sanity-related build variables and automation tokens, if configured. Revoke any GitHub dispatch token created solely for the retired synchronization design.
- Unpublish the old hosted Studio if one exists and stop using it for edits.
- Retain the dataset/archive for rollback; permanently deleting the Sanity project is a separate owner decision.

The backup represents the export time. Any later Sanity changes must be migrated before cutover; avoid editing in both systems during the transition.

References: [Decap GitHub backend](https://decapcms.org/docs/github-backend/), [external OAuth](https://decapcms.org/docs/external-oauth-clients/), [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## Preview links inside Decap

Cloudflare Workers reports builds as GitHub Check Runs, while Decap reads commit statuses. `.github/workflows/cms-preview.yml` bridges completed checks from the verified Cloudflare app into `deploy/decap-preview` statuses. It uses the immutable preview URL from the check summary and never publishes content or starts a deployment. No additional secret is needed. The workflow and `scripts/github/preview-status.cjs` must be merged into `main` before the event trigger becomes active.

After saving a draft, wait for its Cloudflare build and the **CMS preview link** workflow to finish, then click **Check for Preview** beside the publishing controls. The resulting preview link opens the draft site. **View Live** opens production. A missing or unrecognized URL is reported as an error rather than a successful preview.
