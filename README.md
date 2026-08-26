# Puzzles

A small catalogue of logic puzzles that share a shell and share nothing else.
Three games are in it so far.

**Thread** — a board of posts and a piece of string. Use every post. The string
never lies on other string, or on itself, and it never crosses a block. The
drawing is the rule: what you see stroked on the board is exactly the set of
points the string occupies, so if it looks like it touches, it touches.

**Zigzag** — one line through every cell, in order. The numbers say which cell
the line may step to next, and exactly one route uses them all.

**One to Nine** — nine digits, six sums, one arrangement. Every digit from one
to nine used once, and all three rows and all three columns have to come out at
the number beside them.

```
pnpm install
pnpm dev        # play it
pnpm test       # unit tests
pnpm validate   # the board gate: every Thread board re-proven unique
pnpm boards     # regenerate boards/*.json from the designers
pnpm zigzag     # regenerate puzzles/zigzag.json
pnpm nine       # regenerate puzzles/nine.json
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
boards/            Thread's 190 boards, generated and proven, never authored
puzzles/           Zigzag's 44 and One to Nine's 64
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

Thread's designer draws a covering path, cuts it into strands, and then carves
blocks in one at a time for as long as the solver still finds rival answers —
up to thirty-two of them, which is what a six-by-five board actually needs. On
Grid boards there is nothing to carve with, so it pins one more pair of ends
instead, cutting at the first run a rival does not use.

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

## The path

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

The row of controls under a board has four slots and always has four. Hiding a
control the moment it becomes useful — Redo, the first time you undo — moves
the other three sideways under a thumb already reaching for one of them.

`scripts/fit-audit.mjs` walks every route at eight handset sizes in two skins —
flat, and with a notch and a home indicator simulated — and fails on anything
running off the edge, anything smaller than 44px to press, anything covered by
something else, and any board that is not within a pixel of the centre of the
space it was given.

## Testing

Every end-to-end test drives the app through **real pointer events**. Solving a
board by calling into it would prove the rules work and nothing at all about
whether the game is playable, and those are different questions. All 190 Thread
boards, all 44 Zigzag boards and all 64 One to Nine boards are solved by
dragging.

The read-only handle the harness reads is exactly that — read-only, and in the
game's own terms. Thread answers questions about runs, Zigzag about cells. A
harness with board geometry copied into it is how a test comes to tap somewhere
no player taps and still go green.

## Accessibility

Full keyboard play in both games — arrows move, Enter acts.
`prefers-reduced-motion` is honoured: durations collapse and nothing that
carries meaning is removed. Focus is visible and never removed; the keyboard is
a supported way to play. On the path, every state is told by shape and fill as
well as by colour, and each tile carries its own number.

Colour is never the only carrier. A Thread board with twelve strands needs
twelve pairs told apart, and twelve inks that separate cleanly for one player
collapse to two or three under dichromacy — the palette's worst pair differs by
1.02:1 in lightness, so hue was carrying all of it, and no re-ordering fixes
that. Every pinned end carries its strand's **number**. It is a number rather
than a dash pattern on the string, because a dashed string would break the one
promise the board makes: what is drawn is exactly the set of points the string
occupies. A board with a single strand has nothing to tell apart and is left
plain.

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
