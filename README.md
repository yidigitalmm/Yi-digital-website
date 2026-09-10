# Yi Digital website

The English and Myanmar website for Yi Digital, built with React, TypeScript, Vite, and a Sanity content studio. Cloudflare Pages Functions handle contact enquiries through Resend and Turnstile.

## Local setup

Use Node.js 22.13 or newer in the Node 22 series and npm. If you use nvm, run `nvm install` and `nvm use` to follow `.nvmrc`.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open the local address printed by Vite. Set `VITE_TURNSTILE_SITE_KEY` in `.env.local` to enable the contact verification widget. Browsing the website does not require server secrets; sending enquiries requires the Cloudflare runtime and configuration described in [contact form setup](docs/contact-form-routing.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local website |
| `npm test -- --run` | Run all automated tests once |
| `npm run build:offline` | Type-check and build using the committed content snapshot |
| `npm run build` | Fetch published Sanity content, then build for deployment |
| `npm run preview` | Preview the built static website |
| `npm run cms:dev` | Start the Sanity editing studio |
| `npm run cms:build` | Check the studio production build |

The production build outputs `dist/`. The normal build needs access to the configured public Sanity dataset and stops if content synchronization fails. See [Sanity setup](docs/sanity-setup.md) for sign-in, editing, and import instructions. Install dependencies from the repository root; the studio uses the root dependency installation.

## Repository contents

- `src/`: website code, tests, translations, and the published CMS snapshot.
- `public/`: website images, video, branding, and Cloudflare routing configuration.
- `functions/`: the contact endpoint deployed by Cloudflare Pages.
- `studio/`: Sanity configuration and content schemas.
- `scripts/`: CMS synchronization, import, and generated page metadata.
- `docs/`: contact-form and Sanity setup instructions.

Unused media, audits, design plans, browser captures, and production working files are stored in `local-only/`, preserving their original folder structure. This folder is excluded from Git and is not deployed. Keep future drafts and unused assets there; put only website assets in `public/`.

Local credentials, dependency folders, build output, browser captures, and media-production scratch folders are ignored by Git. Runtime media lives in `public/` and must be committed. `src/cms/snapshot.json` is public content and must also be committed. The example environment files contain no credentials.

## Upload to GitHub

The `codex/github-ready` branch starts with a clean website-only history. Earlier local history is preserved separately on `home-page-animation`; it contains old planning documents that are not part of the clean upload.

Create an empty GitHub repository, without adding a README, license, or `.gitignore` there. Then run these commands from this folder, replacing `YOUR-ACCOUNT/YOUR-REPOSITORY` with its actual address:

```sh
git switch codex/github-ready
git status --short
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin HEAD:main
```

This uploads only the clean branch as GitHub's `main` branch. Do not use `--all` or `--mirror`, which would also upload preserved local history. The included GitHub Actions workflow runs the tests, website build, and studio build on pushes and pull requests. It uses the committed CMS snapshot and does not need deployment secrets.

## Website deployment

Uploading the source to GitHub does not deploy the website. The existing contact endpoint is designed for **Cloudflare Pages with Functions**; GitHub Pages alone cannot run it.

Connect the GitHub repository to Cloudflare Pages with the repository root as the project root, `npm run build` as the build command, and `dist` as the output directory. Use Node 22.13 or newer in the Node 22 series. Configure the public `VITE_TURNSTILE_SITE_KEY` build variable and the server secrets `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` in Cloudflare. Never place server secrets in `VITE_` variables.

Follow [contact form setup](docs/contact-form-routing.md) for domain verification and a real delivery check, and [Sanity setup](docs/sanity-setup.md) for automatic rebuilds after content publication.
