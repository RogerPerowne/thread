# Reference

`brilliant-source.png` is a crop of a screenshot supplied by the project owner —
a third-party learning app's level-path screen. It is here for one reason: it is
the yardstick `scripts/compare-reference.mjs` measures against while the
isometric path layout is being built.

Nothing in this directory is served. It sits outside `public/` and outside
`src/`, so `vite build` never sees it and none of it reaches `dist/`.

`brilliant-replica.html` is a from-measurements copy of that screen. Every
number in it came out of the source image via a measuring pass — corner
coordinates of the meander, the tile's 144x88x24 isometric box, face colours,
type sizes. It carries no Thread and no NYT styling on purpose: the point was to
prove the geometry could be reproduced *before* it was restyled, so that any
later difference is a design decision rather than an unnoticed mistake.

## What "exact" can and cannot mean here

The source is a photograph of a phone screen, with that device's subpixel
rendering, a licensed typeface I do not have, and JPEG-ish softening. A literal
byte-for-byte match is not reachable, and a test that claimed one would be
lying. So the comparison scores six things instead, and each has a floor that
the replica currently clears:

| metric      | what it measures                                        |
| ----------- | ------------------------------------------------------- |
| `layout`    | per-pixel agreement at 1/4 scale — nothing is masked out |
| `structure` | normalised cross-correlation of a 16x downsample         |
| `path`      | IoU of the lavender path, dilated 3px                    |
| `tileDark`  | IoU of the extruded side faces                           |
| `tileLite`  | IoU of the tile top faces                                |
| `chrome`    | IoU of header and tab-bar ink                            |

Run `pnpm compare:reference` to print the table and write
`compare-sheet.png` (source | replica | difference, side by side).
The type is the loudest thing left in the difference sheet, which is the
expected consequence of a substituted typeface.
