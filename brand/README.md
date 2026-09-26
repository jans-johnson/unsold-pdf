# Unsold brand

**The mark is a price tag with its price struck out: unsold.** Each app puts
its own shape on the tag; Unsold PDF's is a page (folded corner). The slash is
the one motif everything shares: it cuts through the shape and pokes out both
sides.

| File | Use |
| --- | --- |
| `unsold-mark.svg` | The Unsold mark, lime, for dark backgrounds |
| `unsold-mark-ink.svg` | The Unsold mark, ink, for light backgrounds |
| `unsold-wordmark-on-dark.svg` / `-on-light.svg` | Mark + "unsold" (DM Sans ExtraBold, outlined) |
| `unsold-pdf-icon.svg` | Unsold PDF app icon (rounded, with margin: desktop, favicon) |
| `unsold-pdf-icon-square.svg` | Full-bleed square for platforms that round icons themselves (iOS, Android, PWA) |

Colours: lime `#C8F53B`, deep lime `#9CBF22`, ink `#111111`, paper `#F4F4EE`.
The name is always lowercase in the wordmark; in text it's "Unsold".

Regenerate the SVGs with `node brand/make-brand.mjs`. App icons come from
`native/icons/source.png` (a 1024 px render of `unsold-pdf-icon.svg`) via
`npm run app:icons`. For the iOS App Store, render icons from the square
variant, since Apple rejects icons with transparency.
