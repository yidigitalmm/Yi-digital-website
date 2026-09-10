# Dependency maintenance

Use Node 24 and install from the repository root with `npm ci`. Sanity and its transitive dependencies have been removed.

## Decap editor

The browser editor is pinned to Decap CMS 3.16.2 and served locally from `public/admin/vendor/decap-3.16.2/`. It was obtained from the official npm package and checked against its registry SHA-512 integrity value. Keep the license notices. Vendoring avoids a third-party CDN dependency at sign-in.

When upgrading, download the official `decap-cms` package, verify its registry integrity, and replace the main `decap-cms.js`, `*.decap-cms.js` lazy chunks, CSS, WASM and license notice in a new version directory. Update `public/admin/index.html`. The duplicate `*.cms.js` variant and source maps are unnecessary. Verify editor loading, image selection, saving existing and new entries, and production OAuth before release. npm audit does not scan this vendored browser bundle.

The local editing server is `decap-server` 3.11.2. It binds only to `127.0.0.1`; never expose it publicly because it writes working files without production authentication.

## Dependency audit on 2026-09-10

A `qs` override selects 6.16.0 because Express currently constrains an older minor release with known advisories. Remove the override when its parent packages adopt a patched version.

Two low-severity audit entries remain from the same upstream `@hapi/joi` custom-message prototype-pollution advisory and its dependent `decap-server`. npm reports no available fix. This dependency belongs to the local development editor server, not the deployed Worker. Track [the advisory](https://github.com/advisories/GHSA-6w3j-5fw6-r9vr) and upstream Decap releases. Avoid forced major-version changes solely to suppress audit output.

Routine checks:

```sh
npm ci
npm run build
npm audit
npm audit --omit=dev
```

The production-dependency audit should remain clean. Keep credentials outside the repository and preserve the contact service's runtime secrets during CMS maintenance.
