# Working notes

Decisions, scars and outstanding work. The README says what the project is;
this says what is known about it that a reader of the source would otherwise
have to rediscover.

## Two things the platform brief assumed that were not true

1. **"GAME 1 — SHAPE UP: this is the existing game already built."** It was
   not. The existing game was Thread — string routed through posts on a plain
   board, no grid of symbols, no directional clues. Shape Up as described is a
   different game. The brief also said not to throw the existing game away, so
   Thread stays as a registered game and Shape Up would be built fresh
   alongside it. That makes six entries, not five.

2. **The photographs referenced** ("the uploaded Hexagony puzzle", "the
   photographed puzzle") did not arrive. The written rules are complete enough
   to build from. Anywhere the text leaves a choice open, the choice belongs in
   the game's own metadata rather than being guessed at silently.

## Refused, with the measurement

**A twelve-by-twelve Grid.** Asked for; not deliverable. A 144-cell lattice
needs more than twenty-five pairs of pinned ends before the answer is unique,
and the palette has twelve inks — so two strands would wear the same colour and
the board would be unreadable rather than hard. The ladder stops at eight by
seven, which is the largest size that still reads. Raising the ink count is not
the fix either: twenty-five hues that a person can tell apart at post size do
not exist.

## Done since, worth remembering

**Pinned ends are numbered.** Colour alone could not pair twelve strands: the
ink palette's worst pair differs by 1.02:1 in lightness, so hue was carrying
all of it, and under dichromacy twelve hues collapse to two or three. No
re-ordering of the palette fixes that — a second channel is the only thing that
does. The number goes where the nail head goes, on top of laid string, and only
on boards with more than one strand. A dash pattern on the string was the
obvious alternative and is wrong: it breaks the promise that what is drawn is
exactly the set of points the string occupies.

## Scars

Each of these cost real time and each one is now held by a test or by a
construction. They are here so the next change does not undo the fix.

- **A presentation attribute loses to a stylesheet.** `fill` written as an SVG
  attribute had been doing nothing for weeks, because `.post { fill: … }` in
  CSS beat it. Anything that varies per element goes through a custom property
  now.
- **`svg('text', { text: … })` set an attribute.** SVG has no `text`
  attribute, so every Zigzag numeral was invisible. `dom.ts` special-cases it.
- **A new screen mounted before the old one was disposed** wiped the new
  board's handle in the old one's teardown. `show()` takes a factory, so the
  old screen is gone before the new one exists.
- **A sheet outlived its screen.** Its scrim covered the next board and ate
  every touch: the puzzle looked fine and simply did not respond. Route changes
  call `closeSheets()`.
- **A result timer fired after navigation** and opened a sheet over the next
  puzzle. Cleared on dispose.
- **`findLastIndex` needs ES2023.** Vitest transpiles without typechecking, so
  it passed locally and turned CI red. Run `pnpm build` — tsc *and* vite —
  before pushing, not just the tests.
- **The display face was never loaded.** The tokens named a font nobody had;
  the two self-hosted faces in `public/fonts/` were unreferenced. The
  deployed-bytes check then blamed the site for 404s it caused itself by not
  mirroring `<link rel=preload>`.
- **Two owners of one safe-area inset.** Invisible on a laptop, thirty-four
  pixels wrong on a phone. One owner, and a unit test that reads the sheets.
- **`pkill -f "vite preview"` kills its own shell**, because the pattern
  matches the command line it is running in. Kill by pid.

## Outstanding

- **Tutorials.** Both games declare `tutorial: []`. The `TutorialStep` contract
  exists; no steps do.
- **Four more games**: Shape Up, Hexagony, One to Nine, Isolate. Each needs a
  model, a validator, a real solver, a generator that works answer-first, a
  difficulty analyser that measures deduction rather than size, a serializer
  and unit tests.
- **Thread still pins both ends of every strand.** A purer puzzle leaves them
  free, but with no ends given it takes six or seven blocks to pin the answer
  down, and a board that cluttered is worse to look at than the free ends are
  worth. `Recipe.freeEnds` exists and is unused.
- **No entry animation into a puzzle.** The path used to fly the camera down
  onto the tile you pressed and turn its face into the board. `camera.ts` still
  carries everything that needs — `lerpCam`, the pitch and yaw — but the flight
  and the card it hands over to are not wired up.
