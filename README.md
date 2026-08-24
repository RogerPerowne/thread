# Thread

A pegboard. One string. Drag from peg to peg and the string pulls taut behind
you. Close the loop and the region it encloses — under the **even–odd fill
rule** — must match the target shape.

The even–odd rule is the whole game. Wrap five pegs in ring order and you get a
solid pentagon. Wrap the same five pegs in star order and the crossings carve
the pentagon *out of the middle*, leaving a pentagram. Crossing the string
flips inside to outside. Everything else — budgets, posts, multiple threads,
portals — is a lens on that one idea.

```
pnpm install
pnpm dev        # play it
pnpm test       # unit tests
pnpm validate   # the six-check level gate, with a table
pnpm levels     # regenerate levels/*.json from the designers
pnpm e2e        # solve every level through real pointer events
pnpm ci         # everything CI runs
```

## How it is put together

```
src/core      pure TypeScript, ZERO DOM imports — runs in plain Node
  geometry.ts    segment intersection, point-segment distance, path length
  region.ts      even-odd scanline rasterizer, IoU, symmetric difference
  rules.ts       canAdd / canClose / legality, per mechanic
  level.ts       the Level type, loader, runtime validation
  solver.ts      cycle search, optimality, uniqueness, near misses
  difficulty.ts  static difficulty estimator
  rating.ts      ability estimation (2PL IRT)
  gate.ts        the six quality checks
  design.ts      the level designers, shared with the runtime generators
  shapes.ts      shape and peg-layout families
  rng.ts         seeded, deterministic
src/game      state machine, input interpretation, progression, persistence
src/render    scene graph, tween engine, particles, audio, themes
src/ui        screens and components
  palette.ts     one saturated colour per chapter
  path.ts        the isometric level path
levels        JSON, one file per mode — generated, never hand-authored
reference     the screenshot the path layout is measured against, and a copy
tests         vitest unit tests + playwright end-to-end
```

`src/core` has no DOM imports at all. That is what makes the level validator
and the CI gate possible: the same code that decides whether a move is legal
during play is the code that proves, in Node, that every shipped level is fair.

## Three rules the code holds itself to

**The scene graph is built once per level.** After that, only attributes are
mutated. There is no `innerHTML` anywhere in the play loop. Pointer handlers
write to state and request a frame; they never draw.

**One `requestAnimationFrame` loop.** Every visual transition — segment settle,
fill fade, peg pop, win flourish, the strum — goes through one tween system,
and `cancelAll()` runs on every level change. Nothing schedules visual work
with `setTimeout`, because a stale timer writing into a new level's state is
the cause of most "glitchiness".

**A drag is more precise than a tap.** A tap gets a generous target — at least
44 px, because a finger is imprecise from a standing start. A sweep gets a
tighter one, because the finger is already down and tracking and the player is
aiming at the peg they mean. Using the tap radius for both makes the string
grab whatever the line happens to pass.

**Closing is part of the gesture.** There is no Tie off button. A drag that
moved past threshold and added a peg ties the loop when you lift your finger;
tapping the peg you are on ties it; and on levels where the string may not
cross itself, returning to the start peg ties it too. On crossing levels the
start peg is deliberately *not* a close, because revisiting it mid-loop is how
a keyhole gets cut. For 500 ms after an auto-close, touching the loose end
re-opens it without costing an undo.

## The level gate

No level ships without passing all six checks. `pnpm validate` runs them over
every level and prints a table.

1. **Solvable** — the authored solution is legal under every rule of its level,
   and playing it through really wins.
2. **Target derived from the solution** — targets are generated from the
   solution's region, never authored, so a level cannot be impossible by
   construction. The `Level` type has no field for a target.
3. **Uniqueness** — a bounded cycle search looks for anything *shorter* that
   makes the same shape. When it finds one, the build adopts it as the
   solution rather than shipping a puzzle whose intended answer is beaten by an
   obvious one.
4. **Threshold safety** — every near miss (drop a peg, swap two, substitute
   each peg for each unused one, insert one extra) is played out and must not
   be accepted as a win. In the prototype the worst near miss scored 0.9885
   against a 0.975 threshold, so a hexagonal hole and a pentagonal hole counted
   as the same shape. The threshold is **0.995**, and a correct solve scores
   exactly **1.000** because the player's polygon uses identical peg
   coordinates.

   The same check also rejects a peg sitting on a solution edge. Sweeping along
   that edge picks the peg up in passing, so the obvious gesture quietly makes
   a different loop from the one it looked like — on a weave that changes the
   crossings and the solve is refused for a reason the player cannot see. The
   end-to-end harness found this by dragging, which is exactly why it drags.
5. **Mechanics are load-bearing** — every declared mechanic must actually
   constrain the level. A post must block a real shortcut; a budget must be
   exceeded by a loop that looks like the answer; a gold peg must be skippable
   without changing the shape; a rail peg must not already sit where the answer
   needs it. An inert mechanic fails the build.
6. **Anti-repetition** — every level is compared with every other by target
   region similarity, mechanic tuple, and a topology signature (peg count,
   holes, crossings, symmetry group, loop shape). Any pair matching on all
   three fails, and no two levels sharing a signature may sit within five
   levels of each other.

## The Thread Score

**A puzzle game cannot measure IQ.** IQ tests are norm-referenced instruments
standardised on thousands of people across many item types, and their validity
rests entirely on that norming. A score derived from one visuospatial task, on
a self-selected population, with no supervision, is not an IQ.

So the Assessment builds the most statistically defensible ability estimate it
can — twelve adaptive items under a two-parameter logistic IRT model, with six
continuous signals folded in as a bounded residual — reports it on a familiar
100/15 scale with a confidence interval and an estimated percentile, and calls
it a **Thread Score**, subtitled *"an IQ-style scale — not a clinical IQ
test"*. The percentile is where the ability model places you, not a count of
real people: Thread keeps everything on the device and has no telemetry to
compare against, and the UI says so rather than implying otherwise. That sentence is shown once, on the first reveal, and then
never again.

Correctness outweighs speed roughly 4:1, deliberately, so frantic tapping
cannot beat careful thought. A long pause is only rewarded when the solve that
follows is first-try and near-optimal; a long pause followed by a bad loop
scores as hesitation, not planning.

Casual play never produces a score. It silently updates a hidden estimate; the
badge comes only from the Assessment, once every seven days, because repeated
testing inflates scores through practice effects.

## The chapter path

A chapter is a path you walk down, not a grid you scan: levels sit on isometric
tiles along a meandering ribbon, in the chapter's own colour edge to edge.
Solved tiles are solid ink, the tile you are up to is paper-white, locked tiles
are the chapter colour taken down a few steps. The ribbon is inked in behind
you, so progress needs no separate read-out.

The geometry is not invented. `reference/brilliant-source.png` is a screenshot
of a learning app's course map; every constant in `src/ui/path.ts` — the
meander's corner coordinates and its 1035px period, the 144x88x24 isometric
tile, the 0.675 inner-face inset — was measured off it.
`reference/brilliant-replica.html` is a bare copy of that screen carrying none
of Thread's styling, and `pnpm compare:reference` scores the copy against the
original on six metrics. That runs in CI, so the layout cannot drift.

Three things are derived rather than placed by hand, because hand-placed
numbers go wrong the moment a size changes:

- **The extruded side** is the top face swept down, built from the top face's
  own rounded outline. Rounding a six-sided silhouette separately pulls its
  side corners inside the top face's and leaves a notch of background showing.
- **The band and the light column** are sized to `HW * (1 - t/2)`, which is
  where the fillet actually puts the tile's widest point — not the un-rounded
  vertex at `HW`. The light runs down to the tile's widest row and is cut off
  by the tile, so it hugs the upper edges instead of stopping in mid-air.
- **Glyphs** are authored flat and upright in a 100x100 box and projected. The
  face map composed with the 45 degrees the diamond already carries reduces to
  a pure foreshorten, so an upright mark stays upright and lies down on the
  tile. Un-projecting the reference's own tick through that scale gives an
  ordinary upright tick, which is the proof the original was built the same way.

## Accessibility

Full keyboard play (arrows move between pegs, Enter threads).
`prefers-reduced-motion` is honoured — tweens land instantly and no particle is
ever emitted. Threads are distinguished by dash pattern and end-cap shape as
well as colour. Peg hit radius scales with the viewport, not with the drawn
radius, so a touch target is never smaller than 44 px.

`scripts/fit-audit.mjs` walks every route at six handset sizes and fails on
anything running off the edge, spilling out of its sheet, or smaller than 44 px
to press — hit-testing the area that actually responds rather than trusting the
box, so a small mark with a padded hit area counts as a fair target. It runs in
CI as `tests/e2e/fit.spec.ts`.

No icon in the interface is a text character. A gear, an arrow or a star typed
as a glyph changes shape between platforms, ignores the stroke weight around it
and depends on whatever fallback font the device reaches for; every mark is
drawn in `src/ui/icons.ts` instead.

## Typefaces

The New York Times Games visual system is the reference for layout and
restraint. Their wordmarks, logos and the Franklin and Karnak typefaces are
licensed and trademarked, so this uses free stand-ins — Libre Franklin for UI,
Zilla Slab for display — and an original mark.

## What is not here, and why

Two things the design called for cannot be built behind a static site, and are
absent rather than faked:

- **A weekly leaderboard.** Ranking players against each other needs a server
  to hold the scores. Blitz and One Life keep a personal best, and a seed link
  lets you hand a friend the exact same ladder, which is a fair contest with
  no account and no backend.
- **A daily reminder notification.** Real push needs a service worker talking
  to a push service. There is no switch in Settings pretending to do it.

Two more are honest approximations, and the UI says so where a player can see
it:

- The Daily reports **how hard today's puzzle is**, from the static difficulty
  estimator, rather than "% of players who solved it today" — that figure would
  be invented.
- The Thread Score's percentile is **where the ability model places you**, not
  a count of real people.

## Levels

The 322 levels are built by per-chapter *designers* — parameterised families of
shapes, one idea per chapter — and every candidate is vetted individually by
the six-check gate before it is accepted, then vetted again as a set for
repetition. `pnpm levels` regenerates them deterministically from a seed;
`scripts/probe.ts` and `scripts/probew.ts` report a chapter's acceptance rate
and why candidates are being rejected, which is how you tune one.

This is not the same thing as 322 levels placed peg by peg by a person. It is,
though, what the quality bar in the design actually asks for: every level earns
its place by passing checks a human eye would not catch, and the anti-repetition
audit is what stops a chapter becoming the same puzzle four times.
