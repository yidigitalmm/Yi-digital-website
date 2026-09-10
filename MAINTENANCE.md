# Dependency maintenance

Use Node 24 for local builds and Cloudflare Pages. `.node-version` selects that
major version; `package.json` also records the supported Node ranges. Run installs
from the repository root so the root lockfile and dependency overrides apply to
both the website and Sanity Studio.

## Security fixes applied on 2026-09-10

- Vitest 4.1.11 fixes the mock-server file-read advisory.
- Targeted overrides select `js-yaml` 3.15.2 and `smol-toml` 1.8.0 under
  `@vercel/frameworks`, which still pins vulnerable versions.
- `typeid-js` 1.2.0 uses UUID 11.1.1 via an override. This preserves CommonJS
  support while fixing the UUID buffer-bounds advisory.
- React and React DOM are aligned at 19.2.8 in the website and Studio to satisfy
  the Sanity editor's peer requirement.

Remove the overrides when the parent packages adopt patched versions themselves.
Verify the website tests, CMS sync, Studio build, and TypeID UUID round-trip when
changing them.

## Remaining upstream advisory

`adm-zip` 0.6.0 has no published patched release as of this review:
https://github.com/advisories/GHSA-vwc7-r8mq-g2x9

The audit counts this issue in eight packages through Sanity CLI and module
federation dependencies. The vulnerability requires an attacker-controlled
symbolic link in an archive extraction destination and extraction with overwrite
enabled. Use clean, private build workspaces; do not run these CLI extraction
operations in directories writable by untrusted users. These packages are not
used by the public contact endpoint. Do not use `npm audit fix --force` to resolve
this report: its current proposal downgrades Sanity across a major version.

## Build maintenance

The Vite configuration's local import graph uses explicit TypeScript extensions
and JSON import attributes for native loading. Router code is emitted as a
separate shared bundle to keep the application bundle below the default warning
threshold, without raising or suppressing that threshold.

Routine checks:

```sh
npm ci
npm run build
npm test -- --run
npm run cms:build
npm audit
npm audit --omit=dev
```

The full audit remains nonzero until the upstream archive issue is fixed; the
production-only audit should remain clean.
