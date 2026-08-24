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
levels        JSON, one file per mode — generated, never hand-authored
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

## Accessibility

Full keyboard play (arrows move between pegs, Enter threads).
`prefers-reduced-motion` is honoured — tweens land instantly and no particle is
ever emitted. Threads are distinguished by dash pattern and end-cap shape as
well as colour. Peg hit radius scales with the viewport, not with the drawn
radius, so a touch target is never smaller than 44 px.

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
