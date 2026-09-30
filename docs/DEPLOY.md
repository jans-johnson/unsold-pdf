# Deploying the websites

Three static sites, all on Cloudflare Pages (free plan), deployed from this
Mac with `wrangler`:

| Address              | What                              | Pages project     | Source                                              |
| -------------------- | --------------------------------- | ----------------- | --------------------------------------------------- |
| `stayunsold.com`     | The Unsold home page              | `stayunsold-home` | `../unsold/site` (the `unsold` repo, no build step) |
| `pdf.stayunsold.com` | The Unsold PDF landing page       | `unsold-pdf-site` | `apps/site` → `apps/site/dist`                      |
| `pdf.stayunsold.app` | Unsold PDF itself, in the browser | `unsold-pdf-web`  | `native/www` → `apps/web/dist`                      |

`www.stayunsold.com`, `stayunsold.app` and `www.stayunsold.app` are attached
to a fourth project, `stayunsold-redirect` (`../unsold/redirect`), whose
`_redirects` sends every request to `https://stayunsold.com` with a 301,
keeping the path. That needs no Redirect Rules.

Why Pages: it's free with no bandwidth bills, and it reads the `_headers`
file each site ships. The web app needs its cross-origin isolation headers
(COOP/COEP) for the WASM engines; `apps/web/build.mjs` writes them, and the
service worker adds the same headers on the rare request that misses them.
The web build fits the free limits (20,000 files, 25 MiB per file) because
`build.mjs` splits the big engines into 19 MB parts. `scripts/deploy.mjs`
checks those limits before every upload.

## Before the web app goes live

- **Make the repo public.** Unsold PDF is AGPL-3.0. Running it as a service
  at `pdf.stayunsold.app` means offering its source to the people using it,
  so the source must be reachable. Then fill `source:` in the `LINKS` object
  at the bottom of `apps/site/index.html`.
- **Download links.** Fill `mac`, `windows`, `linux`, `android` and `ios` in
  the same `LINKS` object (for example GitHub Releases on the public repo).
  Empty links show as "soon".

## One-time setup

1. **Domains on Cloudflare.** Both `stayunsold.com` and `stayunsold.app` are
   added to Cloudflare, with Hostinger's parking records deleted and the
   nameservers in Hostinger switched to Cloudflare's two. Wait until
   Cloudflare shows both domains as **Active**.
2. **Log wrangler in:** `npx --yes wrangler@4 login` (opens the browser once).
3. **First deploys** (each creates its Pages project on the first run):

   ```bash
   npm run deploy:home   # stayunsold.com
   npm run deploy:site   # pdf.stayunsold.com
   npm run deploy:web    # pdf.stayunsold.app (rebuilds the whole app first; takes a few minutes)
   ```

   Each prints a `*.pages.dev` preview address. Open it and check it works.

4. **Custom domains.** In the Cloudflare dashboard, go to **Workers & Pages**,
   open each project and use **Custom domains → Set up a custom domain**:

   | Project           | Add                                         |
   | ----------------- | ------------------------------------------- |
   | `stayunsold-home` | `stayunsold.com`, then `www.stayunsold.com` |
   | `unsold-pdf-site` | `pdf.stayunsold.com`                        |
   | `unsold-pdf-web`  | `pdf.stayunsold.app`                        |

   Cloudflare adds the DNS records and the HTTPS certificate itself. If it
   says the domain already has records, delete the old `A`/`CNAME` for that
   name under **DNS → Records** and try again.

5. **Redirects.**
   - `stayunsold.com` zone: **Rules → Redirect Rules → Create rule →
     template "Redirect from WWW to root"**, status 301.
   - `stayunsold.app` zone: under **DNS → Records**, add `AAAA` `@`
     `100::` (proxied) and `CNAME` `www` `stayunsold.app` (proxied). Then
     **Rules → Redirect Rules → Create rule**: _Hostname_ is in
     `stayunsold.app www.stayunsold.app` → _Static_ URL
     `https://stayunsold.com`, status 301. (`pdf.stayunsold.app` isn't
     matched, so the app is unaffected.)

## Checking it

```bash
curl -sI https://pdf.stayunsold.app/ | grep -i cross-origin   # COOP and COEP present
curl -sI https://www.stayunsold.com/ | grep -i location          # → https://stayunsold.com/
curl -sI https://stayunsold.app/ | grep -i location              # → https://stayunsold.com/
```

Then open `https://pdf.stayunsold.app`, run a tool that uses a WASM engine
(OCR or Word to PDF), and in the browser console `crossOriginIsolated` should
be `true`.

## Updating later

Run the same `npm run deploy:*` command. Add `--no-build` to upload what's
already built, or `--dry-run` to run the checks without uploading:

```bash
node scripts/deploy.mjs web --no-build --dry-run
```

Every deploy also keeps the previous one, so a bad release can be rolled back
from the project's **Deployments** tab in the dashboard.
