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

## Zero, the mascot

Zero is the 0 from the mark, drawn as a comic-noir vigilante: heavy ink, a
mask band tied round the counter with slit eyes, fists and boots, and the
orbit worn low like a belt. It carries the brand everywhere a logo can't:
the website, posters, social posts and store listings. The app icons and the
app UI never use it.

`node brand/make-mascot.mjs` writes everything into `brand/mascot/`:

| File | Use |
| --- | --- |
| `zero-crossed.svg` | The default pose: arms crossed, unbothered |
| `zero-signal.svg` | The Zero Signal over the city (a full scene, with its own night sky) |
| `zero-signal-mark.svg` | The lit signal on its own, for layouts with their own sky |
| `zero-pdf.svg` | Unsold PDF: reading the fine print in a spotlight |
| `zero-gym.svg` | Unsold Gym: deadlifting two more zeros |
| `zero-punch.svg` | Punching through a red paywall |
| `zero-private.svg` / `zero-yours.svg` / `zero-coffee.svg` | Private, your files, off duty |
| `zero-sheet.svg` | The character sheet: every pose, on night |
| `poster-*.svg` | Posters: walls (night), no catch (lime), gym (night) |

Every pose except the signal scene is transparent, with a paper die-cut
outline, so it reads on night, lime or paper. Text is outlined. The rules
for drawing and using Zero are in the movement design doc (§4b).
