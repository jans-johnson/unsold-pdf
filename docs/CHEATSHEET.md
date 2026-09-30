# Unsold cheat sheet

The important facts and commands in one place. The details live in the linked
docs.

## Where things are

| What                                          | Where                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| App, websites, brand generators               | `github.com/jans-johnson/unsold-pdf` (public, AGPL-3.0), local `Utility Apps/unsold-pdf` |
| Design system, logos, mascot, home page       | `github.com/jans-johnson/unsold` (private), local `Utility Apps/unsold`                  |
| Design rules (read before designing anything) | `unsold/DESIGN.md`                                                                       |
| Building installers                           | `docs/RELEASING.md`                                                                      |
| Deploying the websites                        | `docs/DEPLOY.md`                                                                         |
| Architecture and plan                         | `docs/ROADMAP.md`                                                                        |

## Live addresses

| Address                                                | What                           | Cloudflare Pages project | Source                         |
| ------------------------------------------------------ | ------------------------------ | ------------------------ | ------------------------------ |
| https://stayunsold.com                                 | Unsold home page               | `stayunsold-home`        | `../unsold/site`               |
| https://pdf.stayunsold.com                             | Unsold PDF landing page        | `unsold-pdf-site`        | `apps/site`                    |
| https://pdf.stayunsold.app                             | Unsold PDF, in the browser     | `unsold-pdf-web`         | `apps/web` (from `native/www`) |
| www.stayunsold.com, stayunsold.app, www.stayunsold.app | 301 redirect to stayunsold.com | `stayunsold-redirect`    | `../unsold/redirect`           |

- **Domains:** bought at Hostinger, with DNS on Cloudflare (nameservers
  switched to Cloudflare).
- **DNS:** six proxied `CNAME` records, each pointing at `<project>.pages.dev`.
- **Future apps:** follow the same pattern: `gym.stayunsold.com` for the
  landing page and `gym.stayunsold.app` for the app.

## Everyday commands (run in `unsold-pdf`)

```bash
npm install                      # once, or after pulling dependency changes
npm run dev                      # the app UI in a browser, with hot reload
npm run dev -w @unsold/site      # the landing page, http://localhost:5190
python3 -m http.server -d ../unsold/site 5192   # the home page, http://localhost:5192

npm test                         # all tests
npm run typecheck
npm run lint
npm run format
```

## Building the app

`npm run build:web` builds the shared app bundle into `native/www`. Every
platform ships this same bundle, so run it first whenever app code changes.

| Platform | Command                                | Output in `release/`        | Notes                                                         |
| -------- | -------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| macOS    | `npm run release:mac`                  | `-mac-universal.dmg`        | Apple silicon and Intel in one                                |
| Windows  | `npm run release:windows`              | `-windows-x64-setup.exe`    | Docker; about 5 min. No MSI (WiX needs Windows)               |
| Linux    | `npm run release:linux -- --self-test` | `.AppImage`, `.deb`, `.rpm` | Docker (amd64 under Rosetta); about 15 min cold, 4 min cached |
| Android  | `npm run release:android`              | `.aab` + `.apk`s            | Unsigned until the Play keystore is set up                    |
| Web      | `npm run release:web`                  | `apps/web/dist`             | Deployed, not downloaded                                      |

Check a desktop build with `<app> --self-test`: exit code 0 means every
check passed. Refresh the checksums with
`cd release && shasum -a 256 Unsold-PDF-* > SHA256SUMS`.

## Deploying the websites

```bash
npm run deploy:home       # stayunsold.com
npm run deploy:site       # pdf.stayunsold.com
npm run deploy:web        # pdf.stayunsold.app (rebuilds the whole app first)
npm run deploy:redirect   # www + stayunsold.app redirects

node scripts/deploy.mjs web --no-build    # upload what's already built
node scripts/deploy.mjs web --dry-run     # run the checks only
```

- **Login:** the first deploy on a new machine needs
  `npx --yes wrangler@4 login` once.
- **Rollback:** every deploy keeps the previous one. To roll back, go to the
  Cloudflare dashboard → Workers & Pages → the project → Deployments.

## GitHub Actions (CI)

- **Every push and pull request:** runs the typecheck, the tests and the
  Rust tests (about 7 minutes). A failure emails you.
- **Full desktop installers:** run only when you start them from Actions →
  Build → **Run workflow**. Releases are built on the Mac instead.
- **After adding or removing a workspace or dependency:** commit the updated
  `package-lock.json`. Otherwise `npm ci` fails in CI.

## Brand files (run in `unsold-pdf`)

```bash
node brand/make-brand.mjs     # logos and app icons → brand/
node brand/make-mascot.mjs    # Zero, posters, link previews → brand/mascot/
npm run app:icons             # app icons from native/icons/source.png
```

The websites and the `unsold` repo hold **copies** of these files. After
regenerating, re-copy them:

- into `apps/site/assets/` and `apps/site/public/og.jpg`
- into `../unsold/site/assets/`, `../unsold/mascot/` and `../unsold/logos/`

Link previews must be JPG or PNG, so after changing an `og-*.svg`, render it
in a browser at 1200 × 630 and save it as `og-*.jpg`.

## Rules that matter

- **AGPL:** the hosted app at pdf.stayunsold.app must offer its source, so
  this repo stays public. Keep the LICENSE and copyright notices intact. The
  "UnAcrobat" copyright line in `coherentpdf.browser.min.js` stays as it is.
- **The app never shows Zero:** the mascot is for marketing only. App icons
  and the app UI keep their own look.
- **Red means the corporate walls:** paywalls and "PRO" signs, never Unsold.
- **Tips:** at most two quiet places per app, never in a work view, and
  hidden in the mobile builds.
- **Website links:** the download and source links live in the `LINKS`
  object at the bottom of `apps/site/index.html`. An empty link shows as
  "soon".

## Troubleshooting

| Problem                                          | Fix                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo: command not found`                       | `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"`                                                                                                                                                                      |
| "No space left on device" during builds          | Delete `native/target/debug`, `*/debug` and `native/gen/android/app/build`. Docker uses about 16 GB; `docker volume rm unsold-pdf-linux-cache` or `docker volume rm unsold-pdf-windows-cache` frees a cache                                         |
| Windows or Linux build hangs or fails to start   | Start Docker Desktop first                                                                                                                                                                                                                          |
| A new domain says "site can't be reached"        | A cached "not found" from before the DNS record existed. Clear it at `chrome://net-internals/#dns` or `brave://net-internals/#dns` (Clear host cache), or run `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`, or wait about 30 min |
| Pushing or VS Code "Sync Changes" hangs or fails | Both repos push over HTTPS using the GitHub CLI login (SSH to GitHub is blocked on some networks). Check `gh auth status` shows `jans-johnson` as the active account; `gh auth switch` changes it                                                   |
| Tarring `native/` for a PC build                 | `COPYFILE_DISABLE=1 tar …` so no `._*` files ship                                                                                                                                                                                                   |
| Old virtualenvs fail with "bad interpreter"      | Stale shebangs from the folder rename. Make a fresh venv; don't fix the old ones                                                                                                                                                                    |

## Still to do

- [ ] Run the Windows app's `--self-test` once on a real Windows machine.
- [ ] Publish the installers (e.g. as a GitHub Release) and fill the download
      links in `LINKS`. Leave out the stale 28 Sep `.msi`.
- [ ] Code signing: an Apple Developer ID (to avoid the Gatekeeper warning),
      a Windows Authenticode certificate (SmartScreen), and a Play keystore.
      See `docs/RELEASING.md` → Signing.
- [ ] Test on a real iPhone or iPad, then submit to the App Store and Play
      Store.
