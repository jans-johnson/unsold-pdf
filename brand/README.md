# Unsold brand

**The mark is Zero Orbit:** a tall 0 with a ring around it. The 0 is the
price, $0, free forever, and the ring makes it a small world of its own. The
ring passes behind the 0 at the top right and in front at the bottom left,
with a small gap wherever the two cross.

Every Unsold app is a dark tile with the orbit on it. The tile's top-right
corner and a short label underneath say which app it is. Unsold PDF's corner
is folded like a page and its label is "PDF".

The design system for the whole movement (every app, not just this one)
lives outside this repo in `Utility Apps/unsold/DESIGN.md`.

| File | Use |
| --- | --- |
| `unsold-mark.svg` / `-ink.svg` | The mark alone: lime for dark backgrounds, ink for light |
| `unsold-logo-stacked-on-dark.svg` / `-on-light.svg` | Mark over "Unsold": website, README, social |
| `unsold-wordmark-on-dark.svg` / `-on-light.svg` | Mark beside "Unsold": headers, narrow spaces |
| `unsold-tile.svg` | The mark on a tile: favicons, Unsold profile pictures |
| `unsold-pdf-icon.svg` | Unsold PDF app icon (folded corner and "PDF", with margin: desktop) |
| `unsold-pdf-icon-square.svg` | Full-bleed square for platforms that round icons themselves (iOS, Android, PWA); no fold, because their mask would cut it |

Colours: lime `#C8F53B`, deep lime `#9CBF22`, ink `#111111`, tile
`#1D1D1B`, paper `#F4F4EE`. Type: DM Sans ExtraBold, outlined in every
file so nothing depends on the font.

Regenerate the SVGs with `node brand/make-brand.mjs`. App icons come from
`native/icons/source.png` (a 1024 px render of `unsold-pdf-icon.svg`) via
`npm run app:icons`. The web favicons use `unsold-tile.svg`, since "PDF"
can't be read at 16 px; the Apple touch and PWA icons use the square variant.
