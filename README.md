# Puzzles

A small catalogue of logic puzzles that share a shell and share nothing else.
Six games are in it.

**Thread** — a lattice of posts and a string for each colour. Use every post
once, run each string between its own two dots, and never through a wall. The
drawing is the rule: what you see stroked on the board is exactly the set of
points the string occupies.

**Zigzag** — one line through every cell, in order. The numbers say which cell
the line may step to next, and exactly one route uses them all.

**One to Nine** — nine digits, six sums, one arrangement. Every digit from one
to nine used once, and all three rows and all three columns have to come out at
the number beside them.

**Shape Up** — one of each shape in every row and column. The clues round the
outside say what you would see looking in: the shape, and whether it is the
first one you meet along that line or the second.

**Hexagony** — hexagonal tiles cut into six numbered sectors. Every tile has a
place and every place a tile, and where two of them touch the numbers facing
each other have to match. Tiles never turn.

**Isolate** — draw walls on the lines between cells until every room holds
exactly two circles. A number in a circle says how many cells its room takes,
a cross says at least two walls meet at that corner, and the walls already
drawn are part of the board.

```
pnpm install
pnpm dev        # play it
pnpm test       # unit tests
pnpm validate   # the board gate: every Thread board re-proven unique
pnpm boards     # regenerate boards/thread.json from the designer
pnpm zigzag     # regenerate puzzles/zigzag.json
pnpm nine       # regenerate puzzles/nine.json
pnpm shape      # regenerate puzzles/shape.json
pnpm hex        # regenerate puzzles/hex.json
pnpm isolate    # regenerate puzzles/isolate.json
pnpm e2e        # solve every board through real pointer events
pnpm ci         # everything CI runs
```

Live at <https://rogerperowne.github.io/thread/>.

## How it is put together

The hard part of a puzzle platform is not the shell — it is resisting the urge
to make every game go through one board component. Routing string and tracing a
numbered path share almost nothing at the level of "a cell you tap". They share
everything one level up: what a puzzle **is**, what a move **is**, how you know
it is solved, how it is stored, how hard it is, and what the screen around it
looks like.

So the split is: **the platform owns the app, the game owns its board.** A game
hands over a package of pure logic plus one function that mounts a view into a
box. It never sees the router, the header, the timer or the stats, and the
platform never sees a post.

```
src/platform      the app, and what a game has to be
  types.ts          the contracts: GamePackage, Session, View, Puzzle, Verdict
  registry.ts       the register of games — one line per game, and nothing else
                    in the platform knows any game's name
  app.ts            three routes: the library, a game's ladder, one puzzle
  store.ts          what has been done and what was half-done, in localStorage
  daily.ts          today's puzzle, chosen from the date and nothing else
  signature.ts      the spoiler-free share line
  rng.ts tween.ts haptics.ts dom.ts palette.ts
  ui/               frame.ts (the screen round a board), components.ts,
                    icons.ts, camera.ts (the path's projection)
  design/           tokens.css, base.css, components.css, play.css, path.css
src/library        library.ts (the home screen), path.ts (a game's ladder)
src/games/thread   board, check, search, make, session, play, render, mini
src/games/zigzag   model, solve, design, session, view
src/games/nine     model, solve, design, session, view
src/games/shape    model, solve, design, session, view, glyphs
boards/            Thread's 56 boards, generated and proven, never authored
puzzles/           Zigzag's 44, One to Nine's 64, Shape Up's 66
scripts/           the designers, the gate, and the audits
tests/             vitest unit tests + playwright end-to-end
```

A game's engine has no DOM imports. That is what makes the gate possible: the
same code that decides whether a move is legal during play is the code that
proves, in Node, that every shipped board has exactly one answer.

## Adding a game

Write a `GamePackage` and register it. Everything else — its card on the home
screen, its place in the router, its ladder as a path, its timer, undo, hints,
sharing, resuming — follows from the register.

```ts
register(hexagony);
```

The test for whether this is working is simple: `grep` for a game's id outside
its own folder should turn up exactly one line, its registration.

## Answers first

No board here is authored and then checked. Every one is built the other way
round: draw a legal answer, then constrain the board until that answer is the
only one. A puzzle built this way cannot be impossible, because the answer
existed before the puzzle did.

Thread's designer draws a covering path over the lattice, cuts it into strings,
and then takes freedoms away for as long as the solver still finds rivals: a
wall across a run the rival used, or — when no wall will fit — one more cut,
which costs a colour. Isolate's cuts the grid into rooms, drops two circles in
each, and adds clues until the board has one answer that can also be reasoned
out; then it lifts every clue in turn and puts back only the ones it needed,
which is the difference between a board with a cross on every corner and a
board with two.

Shape Up goes the other way and takes clues AWAY. Every clue the answer could
carry is generated, then removed one at a time for as long as exactly one
filling still fits. What is left is minimal: every clue on a shipped board was
removed once, found to cost uniqueness, and put back — so nothing there is
read for nothing.

Its clues look one shape in or two, and never further. That is a rule about
reading rather than about arithmetic: "the first shape along" and "the one
after it" are two things you can hold in your head while your eye runs down the
line, where "the fourth shape along" is something you can only get by counting
shapes that are not on the board yet. It costs the designer almost nothing, and
the reason is worth stating because it is not obvious. Every line holds exactly
as many shapes as the board has, so the kth shape counting from one end is the
(shapes + 1 - k)th counting from the other — with four shapes or fewer, every
reading of every line is still a first or a second from ONE end or the other,
and all the restriction does is decide which side the clue sits on. Five shapes
gives up exactly one clue, the middle of five, which is a third from both ends.
The measured difficulty barely moved: the same seed builds 66 boards spread
across the same bands it did when a clue could look five shapes deep.

That last step has a trap in it, and the gate caught it. A search that runs out
of its node budget has found one answer and *stopped looking*, which is not the
same as there being one — and treating the two alike removes the clue that was
holding the board together. The solver reports whether it finished, and "unique"
means one answer **and** a search that got to the end.

`pnpm validate` re-proves all 190 from the shipped JSON, not from the
designer's memory of them:

```
           boards   answer legal   only answer   nodes to prove
------------------------------------------------------------------
classic       60            60/60          60/60          34327
coloured      50            50/50          50/50          29706
grid          80            80/80          80/80          24824
```

Difficulty is **measured, not asserted**: a board's band comes from how many
nodes the solver has to visit to prove it unique. A nine-post board that takes
three thousand nodes is a harder puzzle than a thirty-post board that takes
three hundred, and telling a player otherwise because one has more dots on it
would be a lie the ladder tells itself.

One to Nine goes further and measures the *deduction* rather than the search,
because a computer finds a board hard for reasons no person shares: it works
out every triple that could fill each line, crosses out what the other lines
rule out, and repeats. The measurement reordered the game's whole ladder.
Plus and minus look like the easy end and are the hard end — `a + b + c = 15`
allows twenty-five triples and tells you almost nothing, so only one board in a
hundred falls to crossing-out alone, while `a x b x c = 336` allows one and two
in three of those boards come out by pure deduction. So the ladder opens on
multiplication and ends on addition, and nothing on it gets harder by making
the sums bigger.

## Five hundred levels, and a ladder that climbs

Every game ships 500 puzzles in 17 chapters — sixteen of thirty and a last of
twenty. None of them is authored; all 3,000 are generated and proven, and the
order they are in is a measurement rather than an opinion.

**The ramp is built the same way in all six.** Each chapter is one recipe. The
boards it makes are scored by that game's own analyser — the same one the bands
come from, which counts DEDUCTION rather than board size — and then sorted, so
the thirty levels inside a chapter climb. Where two chapters share a recipe,
because the recipes have run out before the chapters have, they are generated
as one pool and split by score: the earlier chapter takes the easier half. No
difficulty window is ever chosen by eye.

What actually makes each game harder is different, and worth stating, because
in three of the six it is not the thing you would reach for:

- **Thread** — posts, then colours. Sixteen posts to fifty-six, and two strings
  to six. Colour count matters more than size: a board with six strings on it
  has six sets of ends to keep apart.
- **Zigzag** — diagonals first, then how many numbers, then size. Measured, the
  diagonal lever dwarfs the other two: the same board with corners closed
  scores 47 where open it scores 90. So **the whole first half of the ladder is
  boards the line can only be drawn on straight**, which is also the half where
  a player can follow it with a finger. How many numbers runs backwards from
  how it looks — five numbers is EASIER than four, because a longer run means a
  smaller share of the neighbours carry the next one — and two numbers is not a
  difficulty at all but a broken puzzle, with half of every neighbourhood legal
  and no unique answer at any size.
- **One to Nine** — which operators are allowed, and it runs backwards too.
  Multiplication says the most (`a x b x c = 336` allows one triple), addition
  says the least (`a + b + c = 15` allows twenty-five), so the ladder opens on
  all four operators and ends on addition alone.
- **Shape Up** — size and how many shapes. Eleven recipes is every one there
  is: the board must be square (see below) and the glyph set holds five shapes,
  so four sizes by three shape counts, less the one that does not fit.
- **Hexagony** — how many spaces, then how many numbers the sectors draw on.
  More numbers is easier: a sector that could be any of three matches far more
  neighbours than one that could be any of eight.
- **Isolate** — the grid, then the largest room allowed. A bigger room is a
  longer thing to have to see.

Two impossibilities were found while laddering, and both are now refused in a
line rather than searched for:

- **Zigzag cannot go corner to corner without diagonals when both sides are
  even.** Colour the grid like a chessboard: an orthogonal step changes colour,
  so a path over all `w*h` cells has endpoints of the same colour when `w*h` is
  odd and opposite colours when it is even. Work both cases through and exactly
  one shape fails. Six by six has no answer, and the designer used to spend its
  entire budget proving it.
- **Shape Up's board has to be square.** Every row holds one of each shape, so
  an `h`-row board carries `shapes * h` marks; every column does too, so it
  carries `shapes * w`. Both count the same marks. A five by four would need
  fifteen and twelve at once.

## The path, and the levels

The path carries the seventeen CHAPTERS, not the five hundred levels. Five
hundred tiles on a meander is not a journey, it is a scroll bar with pictures
on it: nobody can find level 314 on it and nobody wants to. Seventeen is a
length a thumb can walk. Pressing one opens its thirty levels as a grid, which
is a shape you take in at a glance and a path is the wrong shape for.

The level grid is coloured by BAND, which is measured rather than asserted. A
band is an ordered thing — gentle, steady, tricky, severe — so it gets a ramp
mixed from the game's own accent and not four unrelated hues: four hues would
say "four kinds", a ramp says "more of the same thing". A level you have not
solved shows its band mixed back towards the paper and one you have shows it at
full strength, so the grid says how hard and how far at once without either
needing a second ink. Colour is never the only carrier: every tile has its
number, a tick when it is solved, and its band in the name a screen reader
reads. And because the thirty are sorted by score, the grid is a picture of the
chapter's shape — pale at the top, dark at the bottom.

A game's whole ladder is a path you climb, not a grid you scan: puzzles sit on
isometric tiles along a meandering ribbon, with a band across it at each
chapter and a rail down the right to jump between them. The ribbon is inked in
behind you, so progress needs no separate read-out. The geometry is authored in
ground coordinates and projected through a camera, so the drawing is one
projection of one scene rather than a pile of diamond arithmetic.

Three things there are constructions rather than adjustments, because a number
placed by hand goes wrong the moment a size changes:

- **The ends.** The ribbon never ends. It is drawn well past both ends of the
  ladder and the *scroll* stops early, so at either limit the clip line sits
  exactly on the edge of the screen: the path is cut by the edge of the phone
  rather than by anything of ours. Both numbers are ratios of the drawing's own
  width, so the browser works them out from whatever width the screen turns out
  to be and nothing has to be measured or recomputed on a resize.
- **The chapter bands.** A band is a row of the ladder like any other. It takes
  a slot on the meander, so the space it needs exists in the layout instead of
  being made by pushing tiles about.
- **The road is a road.** Its width is a real width on the GROUND — the
  centreline offset either side and then projected — so it foreshortens as it
  turns like everything else in the scene. Stroked instead, a line is given its
  width on the screen, and the same road comes out fat where it runs across the
  view and thin where it runs into it.
- **A tile is drawn in two passes and the road goes between them.** Skirts,
  then the road, then the faces. This is the whole of why the two used to look
  like separate objects: a tile's skirt was painted after the road, straight
  across the place the road ran into the tile, so the one thing you had to see
  to believe they were joined was the one thing covered up. Matching their
  heights could never fix that, because the skirt was in front either way.
  Painted in the right order, the order IS the occlusion — nothing is clipped
  and nothing is nudged.
- **The road stops at the tile, exactly.** It is cut where the centreline
  crosses the tile's own square, by slab clipping, so the end lands on the edge
  the tile draws rather than within some tolerance of it. Sampling the line and
  dropping what fell inside — the first attempt — stopped the road up to a step
  short, and looked exactly like what it was. A cut end on an extruded slab is
  a vertical face, which is what makes the road arrive at a tile rather than
  fade into it.
- **The tile stands slightly proud.** The road's surface is a fixed fraction of
  the tile's height, so a tile's own side shows above it as a step. Level with
  it, the two are one flat sheet and a tile is only a wider part of the road.
- **There is a 2D version, and it is one function.** `flatCam()` is the same
  camera at pitch zero, where the projection has no height term at all: every
  extrusion collapses onto the ground and what comes out is the same meander
  with the same tiles in the same places, seen from above. Not a second drawing
  to keep in step with the first — the same drawing, differently projected.
- **The tap targets.** A tile is 144 by 88 in the drawing's units, which on the
  narrowest phone still in use is about thirty pixels tall. Each tile carries a
  rectangle sized so it clears 44px at the smallest width the drawing is ever
  shown at, and stays under the 259 units between one slot and the next so two
  targets cannot overlap.

The rail is a scrubber rather than one button per chapter: nineteen buttons on
a phone are either under 44px or taller than the screen. Its marks sit at each
band's fraction of the drawing's height — a ratio of view units, and therefore
the same number at every screen width.

## Perfect by construction, not by tuning

The project's rule. Both of the failures below were invisible on a laptop and
wrong on a phone, which is why they are constructions now and not numbers
somebody once got right.

Exactly one element owns each safe-area inset. `--safe-b` is zero in every
desktop browser, so a layout that applies it twice looks perfect on a laptop
and sits thirty-four pixels wrong on the phone most people will use. There is
one owner, and a unit test reads the stylesheets and says so.

The row of controls under a board has five slots and always has five. Hiding a
control the moment it becomes useful — Redo, the first time you undo — moves
the others sideways under a thumb already reaching for one of them. The slots
are equal width, so what has to fit is five of the WIDEST button and never the
sum of five different ones: the row drops to words alone at 444 pixels and to
glyphs alone at 319. Both are measured — set the buttons to `width: max-content`
and take the largest — and the second drop reverses the first on purpose. Below
319 a word does not shrink, it truncates, and "Restar…" says no more than the
glyph did while taking its place. Only the 320-pixel phone gets that far down;
every larger handset keeps its words, which is what the row's padding is for —
the slots are equal and the labels centred, so that padding is never seen and
is only the width below which a word starts being cut off.

`scripts/fit-audit.mjs` walks every route at eight handset sizes in two skins —
flat, and with a notch and a home indicator simulated — and fails on anything
running off the edge, anything smaller than 44px to press, anything covered by
something else, and any board that is not within a pixel of the centre of the
space it was given.

## What a board gives back

Shape Up is the one with a move loop rather than a single gesture, so it is
where this is worked out. Three things, and none of them is decoration: each is
a fact the model already knew, drawn.

**A blank is the player's notation, not part of the answer.** A dot means "I
have settled this and nothing goes here", and people write one where the
deduction needed it and nowhere else. The board used to wait for every cell to
be decided before it would say "solved", which is tidying up after winning. A
line holds exactly as many shapes as the board has, so the moment they are all
down the rest of that line *is* blank whether anyone wrote it or not — which is
also why a clue can now be answered as soon as its line has its shapes, instead
of waiting for dots it is not owed.

**A finished line says so and keeps saying so.** It lights once as it completes
and its cells settle into deeper paper, so the board fills in behind you and
the last cells to change colour are the ones that were hardest. Not the washes:
those mean the same three things on every board here — where the keyboard is,
where a drag would land, where the hint points — and a fourth meaning borrowed
from them would make all four unreadable.

**The palette hands over.** There are exactly as many of each shape as there
are rows, so when the last one goes down the chip in your hand has nothing left
to give and the next unfinished shape is chosen for you. Only between gestures,
never during one — a drag that changed what it was painting halfway along would
be a gesture whose result depended on how far it happened to get.

And the palette is draggable now: press a chip and carry the mark onto the
board in the same press, or let go over the palette and it was the tap that
chose a mark, which is what it always was. Nothing had to decide which of the
two it was at the start.

## Showing the answer

Every puzzle has a Reveal, because a board nobody can finish needs a way out of
it that is not the back button. It is a slot in the row rather than something
buried in a sheet, and it asks once before it does anything.

Three things make it honest. It is never a solver run at play time: every game
here is built answer-first, so what goes onto the board is the filling, the
route or the arrangement of tiles that existed before the puzzle did. It takes
an undo step, so it is not a one-way door. And **a revealed board is not
recorded as solved** — no time, no streak, nothing written to the history. A
personal best you were handed is not one.

The animation belongs to the platform and works for all six games because it
knows nothing about any of them: a bar of light crosses the board and the
answer is written in underneath it, at the moment it is over the middle. One
duration, read both by the stylesheet and by the code that waits half of it, so
the light cannot drift out of step with the change it is hiding.

`tests/unit/reveal.test.ts` reveals every board of every game and checks that
the game's own judge calls it solved — 256 boards, and the only place a reveal
that laid a path backwards would be caught.

## Testing

Every end-to-end test drives the app through **real pointer events**. Solving a
board by calling into it would prove the rules work and nothing at all about
whether the game is playable, and those are different questions. All 56 Thread
boards, all 44 Zigzag boards, all 64 One to Nine boards and all 66 Shape Up
boards are solved by dragging.

The read-only handle the harness reads is exactly that — read-only, and in the
game's own terms. Thread answers questions about runs, Zigzag about cells. A
harness with board geometry copied into it is how a test comes to tap somewhere
no player taps and still go green.

## Accessibility

Full keyboard play in every game — arrows move, Enter acts.
`prefers-reduced-motion` is honoured: durations collapse and nothing that
carries meaning is removed. Focus is visible and never removed; the keyboard is
a supported way to play. On the path, every state is told by shape and fill as
well as by colour, and each tile carries its own number.

Colour is never the only carrier, and where it has to be one it is measured.
Thread pairs its strings by colour alone; twelve inks could not do that — the
worst pair of that palette measured 2.1 in colour difference under simulated
deuteranopia and protanopia, which is the same ink twice, and every pinned end
had to carry a number to make up for it. The palette is Okabe and Ito's six
now, whose worst pair measures 19 the same way, and no board needs more than
five of them. Hexagony says every sector twice over — a colour and the numeral
on it — so a board where two of the eight cannot be told apart is still a board
that can be played.

No icon in the interface is a text character. A gear or an arrow typed as a
glyph changes shape between platforms, ignores the stroke weight around it and
depends on whatever fallback font the device reaches for. Every mark is drawn
in `src/platform/ui/icons.ts`.

## Typefaces

The New York Times Games visual system is the reference for layout and
restraint. Their wordmarks, logos and the Franklin and Karnak typefaces are
licensed and trademarked, so this uses free stand-ins — Libre Franklin for UI,
Zilla Slab for display — and an original mark. Both are self-hosted: the
request to a font service was once being blocked, the wordmark had been quietly
falling back to Times, and the design being looked at was not the design that
had been written.

**Numerals are set in the text face, never the display one.** Zilla Slab's
figures are old-style: 3, 4, 5, 7 and 9 hang below the baseline while 6 and 8
rise to cap height. That is what old-style figures are for and it is lovely in
running prose — it is also wrong everywhere a number has to sit centred in a
box or line up under another number, and no amount of centring fixes it,
because the two halves of 48 disagree with each other. The fit audit measures
the ink of all ten digits wherever a number is the whole of an element's text
and fails if they do not share a baseline, so the rule is checked rather than
remembered. Numbers inside a sentence are left alone: mixing with lowercase is
the one place those figures belong.

## What is not here, and why

- **A leaderboard.** Ranking players against each other needs a server to hold
  the scores. Everything here lives on the device, and there is no switch
  pretending otherwise.
- **A daily reminder.** Real push needs a service worker talking to a push
  service.
- **A twelve-by-twelve Grid.** It was asked for and it is not deliverable: a
  lattice that size needs more than twenty-five colour-distinguishable pairs of
  ends against a twelve-ink palette, so two strands would be the same colour
  and the board would be unreadable rather than hard. The ladder stops at
  eight-by-seven, which is the largest size that still reads.
- **Tutorials.** Both games declare an empty one. The contract for them exists;
  the steps do not.
