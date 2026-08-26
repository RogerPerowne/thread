# Working notes: from one game to a puzzle platform

## What is here now

Thread is one game with a hand-built shell around it. Roughly 4,900 lines.

    src/core/     board.ts    model, geometry, compile-once conflict tables
                  check.ts    validator — judges an attempt, names the fault
                  search.ts   solver — exhaustive, counts answers, reports cost
                  make.ts     generator — builds the answer, then constrains it
                  rng.ts      seeded PRNG
    src/ui/       shell.ts    app state, routing, persistence
                  screens.ts  home / chapters / path
                  playscreen.ts  interaction
                  render.ts   board renderer
                  path.ts, enter.ts, camera.ts   the isometric level path
                  components.ts, dom.ts, icons.ts, palette.ts
                  styles.css  one stylesheet, ~1400 lines
    src/render/   haptics.ts, tween.ts
    scripts/      build-boards, validate (the gate), fit-audit, verify-deployed

## What is genuinely reusable

Already game-agnostic, moves to the platform as-is:
  rng.ts, haptics.ts, tween.ts, dom.ts

Nearly game-agnostic, generalises:
  shell.ts routing and persistence, components.ts, the gate script's shape
  (generate → re-prove from the shipped bytes → refuse to ship otherwise)

Thread-specific, becomes games/thread/:
  board, check, search, make, render, playscreen, path, enter, camera, mini

The stylesheet is the awkward one. It is one file with tokens, layout, and
Thread's board styling mixed together. It splits into design tokens + shared
components on the platform side, and a board stylesheet per game.

## The shape to aim for

    src/platform/   types, registry, store, router, shell, ui/, design/
    src/games/<id>/ model, validate, solve, generate, render, play, tutorial
    src/library/    the catalogue screen and the animated miniatures

A game registers a package. Nothing global knows any game's name.

## Two things the brief assumes that are not true here

1. "GAME 1 — SHAPE UP: this is the existing game already built." It is not.
   The existing game is Thread: string routed through posts on a plain board,
   no grid of symbols, no directional clues. Shape Up as described is a
   different game. The brief also says not to throw the existing game away, so
   Thread stays as a registered game and Shape Up is built fresh alongside it.
   That makes six entries, not five.

2. The photographs referenced ("the uploaded Hexagony puzzle", "the
   photographed puzzle") did not arrive. The written rules are complete enough
   to build from and that is what the engines follow. Anywhere the text leaves
   a choice open, the choice is recorded in the game's own metadata rather
   than guessed at silently — the evaluation mode for One to Nine is the
   clearest case, and the brief already calls for exactly that.
