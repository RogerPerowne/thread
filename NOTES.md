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

## Measured, and it changed the design

**One to Nine's ladder runs backwards from the obvious order.** Plus and minus
look like the easy end. They are the hard end: `a + b + c = 15` allows
twenty-five triples and says almost nothing, so only 1% of plus/minus boards
fall to crossing-out alone, against 66% with multiplication and 75% with all
four operators. The ladder opens on multiplication and ends on addition
because that is what the measurement says, and the brief asked for difficulty
from deduction complexity rather than harder arithmetic — which is exactly
what this is.

The evaluation convention is `precedence` on every shipped board, chosen
because it is the one nobody has to be told. `leftToRight` is implemented and
unit-tested; it travels in the puzzle data, so a future family can use it
without the engine guessing.

## Isolate, and what a clue costs

**The designer adds clues blindly and then takes them back off.** Reaching one
answer that can also be reasoned out took, on a six by six, every corner
crossed and a couple of dozen walls drawn — a board so pre-solved there was
nothing to do on it. Adding clues cannot be done knowing which one did the
work, so each is lifted afterwards and put back only if the board stops having
one answer or stops being reasonable without it. That took the six by six from
twenty-five crosses and twenty-six walls to two and eight.

**A clue that rules nothing out is worse than no clue**: it is a promise that
there was something to see there. That is the whole argument for paying for
the thinning pass.

## Refused, with the measurement

**A twelve-by-twelve Grid.** Asked for; not deliverable. A 144-cell lattice
needs more than twenty-five pairs of pinned ends before the answer is unique,
and the palette has twelve inks — so two strands would wear the same colour and
the board would be unreadable rather than hard. The ladder stops at eight by
seven, which is the largest size that still reads. Raising the ink count is not
the fix either: twenty-five hues that a person can tell apart at post size do
not exist.

## Thread is one ladder now, and the measurement is why

**Free-form boards could not be reasoned out.** Thread had three ladders —
Classic and Coloured on shaken posts, Grid on a lattice. Playing the deduction
on all 190 shipped boards (`reason.ts`, the same crossing-out a player does)
says: the lattice boards fall to reasoning alone in 19 cases out of 20, and the
free-form ones in about 1 in 20. A board that only a search can settle is not a
hard puzzle, it is a maze — so the free-form ladders are gone and every board
is a lattice board, laddered by measured deduction like every other game here.
Fifty-six boards where there were a hundred and ninety.

**Obstacles are walls on the lattice**, placed by the designer across a run a
rival answer wanted and the intended one does not. A wall costs nothing; a cut
costs a colour. So the designer reaches for a wall first and only cuts when no
wall will fit, which is what keeps the colour count down.

**The numbers on pinned ends are gone, and six inks is why.** Colour alone
could not pair twelve strands: measured as colour difference across ordinary
vision, deuteranopia and protanopia, the worst pair of that palette came to
2.1 — the same ink twice. The number was the patch. The palette is Okabe and
Ito's six now, whose worst pair measures 19 the same way, and a board needs at
most five of them. So colour carries the instruction on its own again.

**One string per colour, always.** A strand used to be able to exist as several
loose pieces — start at both pinned ends, join them in the middle. It made the
state something the player had to keep track of and the drawing something that
could disagree with it. A strand is now one array of posts that always starts
at one of its own pins, so "point at a post the string already passes through"
is the only way back and there is nothing else to explain.

## Done since, worth remembering

- **"One answer" and "one so far" are different things.** A search that runs
  out of budget has found one answer and stopped looking. Shape Up's clue
  minimiser treated them alike and removed clues the board needed; the gate
  caught it because it re-checked from a smaller clue set where the search
  exploded. `isUnique()` now means one answer AND an exhausted search. Any new
  engine with a bounded solver needs the same distinction.
- **Shape Up's ring is gone, and a palette replaced it.** The ring was a good
  menu and the wrong idea: every mark cost a press, a pause and an aimed second
  press at a target that had just appeared under the thumb already covering it,
  and where an option sat depended on where you pressed, because the ring had
  to dodge the edges of the board. A palette costs one tap to choose and one
  per cell after that, it does not move, and a drag paints a run. Tapping a
  cell that already holds the chosen mark takes it off, so there is no eraser
  to find. Chips are sized so that the narrowest phone still gives forty-four
  pixels — and when six chips want more room than the grid does, the palette
  sets the width of the drawing rather than shrinking to fit.
- **A harness must read the geometry, not recompute it.** The Shape Up e2e
  carried its own copy of the ring's clamping arithmetic and broke the moment
  the ring started sizing itself. It asks the board where the option is.
- **Shape Up's clues look one shape in or two, and never deeper.** The engine
  was written for an arbitrary ordinal on the argument that a two-value
  encoding stops short of a thing with no reason to stop. That was true about
  the encoding and wrong about the reading: a clue about the fourth shape along
  can only be used by counting shapes that are not on the board yet. The cap is
  nearly free and the reason is not obvious — every line holds exactly `shapes`
  shapes, so the kth from one end is the (shapes + 1 - k)th from the other, and
  at four shapes or fewer every reading survives on one side or the other. Five
  loses only its middle clue. Rebuilt from the same seed, the difficulty spread
  and the band counts barely moved.
- **A blank in Shape Up is notation, not part of the answer.** The board used
  to wait for every cell to be decided before it would say "solved", which
  meant tidying up after winning: people dot the gaps the deduction needed and
  no others. A line holds exactly `shapes` shapes, so the moment they are all
  down the rest of that line IS blank whether it was written or not. `judge`
  reads it that way, which also made every clue answerable earlier — a clue can
  be settled as soon as its line has all its shapes, rather than waiting for
  dots nobody owes it.
- **Every game can show its answer, and it is never recorded as a solve.** The
  Reveal control is in the platform's row and knows nothing about any board:
  `Session.reveal()` writes back the answer the designer built the puzzle from,
  which is why it can never fail and never needs a solver at play time. It
  takes an undo step. It writes nothing to the history — `gaveUp` is kept apart
  from `finished` for exactly that reason, because the two want the same things
  from the clock and opposite things from the record.
- **The path's ribbon and its tiles are one slab.** The ribbon was extruded
  three quarters as far as a tile was tall and the tile straddled it, so the
  two met at a step halfway up the side face and every tile read as a block
  dropped onto a strip. Both are now swept between the same two heights, so no
  later change can pull them apart.

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
- **The path's tiles looked detached because of PAINTING ORDER, not height.**
  Three goes at it moved heights around and none of them worked, because the
  problem was that a tile's skirt was painted after the road and laid straight
  across the join. Skirts, then the road, then the faces — and the order is the
  occlusion, so the mistake is no longer expressible. The road is also a real
  ground-space width now rather than a screen-space stroke, and it is cut at
  each tile's square by slab clipping, exactly, so its end face lands on the
  tile's edge rather than within a sample step of it.
- **Five hundred levels a game, and the ladder is ordered by the measurement.**
  Chapters are generated, their medians read off the boards, and the chapters
  then PUT IN THAT ORDER — `.shots/reorder.mjs` did it once and the source
  records the answer. Hand-ordering by "bigger board must be harder" was wrong
  in every game: Hexagony's flower with five numbers is easier than its three
  by two with three, and One to Nine's whole ladder runs backwards.
- **Shape Up's board has to be square, and Zigzag's cannot always go corner to
  corner.** Both were found by a generator burning its entire budget on
  something arithmetic already ruled out. Both are refused in a line now, and
  both are stated in the README because they are facts about the puzzles rather
  than facts about the code.
- **The e2e suite samples the ladder rather than solving all three thousand
  boards.** What only a browser can tell you is whether a board can be filled
  in with a thumb, which is a question about the view and the sizes of things
  and does not change from one board of a chapter to the next. Every board is
  still re-solved from the shipped bytes by the unit gate, in seconds.
- **The fit audit's routes were a hand-written list claiming to be built from
  the register.** It named `shape-66` as Shape Up's last board long after that
  had stopped being true, so the audit was checking a middling board and
  calling it the biggest. Asked of the running app now — 37 routes instead of
  20 — and it immediately found a real fault the stale list had been hiding.
- **"No. 500" wraps, and the whole board jumped once a second.** The bar's
  subtitle is a flex row, but the text inside a span still breaks: squeezed to
  320 pixels "No. 500" broke after "No." and the bar grew a second line, then
  lost it again as the clock ticked to a slightly narrower reading. Three
  pixels, once a second, under the player's thumb. It could only appear once
  the ladders reached three digits. `white-space: nowrap` fixes the height by
  construction rather than by the labels happening to stay short.
- **A pulsing tile must not move its own tap target.** The tile you are up to
  breathes sixteen units every few seconds, and the animation was on the group
  holding the hit rectangle — so the target drifted while a thumb was reaching
  for it. It is on the ink now. Found because Playwright will not click a
  moving element, which is the same complaint a person would have.
- **CI had never run.** `ci.yml` carried a step named `Board gate: every board
  has exactly one answer`, unquoted — and a plain YAML scalar cannot hold a
  colon followed by a space, so GitHub could not read the file. Every run from
  the first commit on failed instantly with no jobs, which on the runs page
  looks exactly like a red test suite. Seventy-five red runs and the gate had
  never once been stood up. `tests/unit/workflows.test.ts` reads the workflow
  files and fails a value that needs quotes and has not got them.
- **A keyframe with only a `to` starts from black.** It is meant to take its
  implicit start from the element's own computed value; for SVG `fill` it takes
  the initial one instead, so every cell of a finished Shape Up line flashed
  from black before settling. It read as a rendering fault and it was a
  one-word omission. `tests/unit/styles.test.ts` now reads every keyframe block
  in the project and fails one without a starting stop.
- **`pkill -f "vite preview"` kills its own shell**, because the pattern
  matches the command line it is running in. Kill by pid.

## Outstanding

- **Tutorials.** Every game declares `tutorial: []`. The `TutorialStep`
  contract exists; no steps do.
- **On a lattice, two runs can never lie across each other.** Every run is one
  step long, so two of them either share a post or are a whole cell apart. The
  `touch` fault therefore cannot fire on any shipped board; the check stays
  because it is cheap and it is the engine's guarantee, but the rules card no
  longer claims it, because a rule nobody can break is not a rule.
- **No entry animation into a puzzle.** The path used to fly the camera down
  onto the tile you pressed and turn its face into the board. `camera.ts` still
  carries everything that needs — `lerpCam`, the pitch and yaw — but the flight
  and the card it hands over to are not wired up.

## Hints, and the way they went wrong

**Every hint reasoned forward from the board as it stood.** That is correct
on a board that is right and confidently wrong on one that is not, and a board
is wrong long before it breaks a rule: a shape in a cell the answer gives to
another, a string along a legal run the answer never uses. Zigzag's "only one
cell carries a 3 next to the end of the line, so that step is forced" was true
of the line as drawn and false of the puzzle. The fix is not cleverer
reasoning; it is checking against the answer first, which every session
already held. See "Hints that cannot lie" in the README and the gate in
`tests/unit/hints.test.ts`.

**A hint with no third rung reads as a hint that does not work.** Several
games gave a reason and no move where nothing was forced, so the third press
repeated the second. Now every hint names a move — from the answer, at the
third rung, which is what the rung is for.

## Gestures that had to be taken back

**Shape Up painted.** A drag across the grid wrote the chosen mark into every
cell it crossed. Efficient on paper; in the hand, a board that fills itself in
whenever a thumb rests on it to look. One mark per gesture now, where it ends.

**A Thread string could never change ends.** Once it had left one pin, the
other pin refused every press, and the only way to lay it the other way round
was Restart, which cleared every other string too. A press on a string's
unused pin now winds it off and starts it there — one undo step.

**Zigzag never said what the run was.** "1, 2, 3, 4, then 1 again" lived in
the rules sheet, so a refused step was refused for a reason you had to
remember. The run strip under the grid says it once and lights the number
wanted next; the cells the line can legally enter are marked, which is the
rule applied and not the answer.

## Hints reasoned forward from wrong boards

Every game's hint took the board as a premise. That is exactly right until the
player lays one legal move the answer does not contain — a string along a run
that breaks nothing, a shape in a cell where a different shape goes — and from
then on every deduction is sound and wrong. The fix is not cleverer deduction,
it is the answer: every session has it, so the first thing a hint does is check
what is down against it, and a wrong move is named as a `fix` before any step
is proposed. `tests/unit/hints.test.ts` builds those wrong boards on purpose.

## Zigzag shipped two games and called them one

Half the ladder allowed only straight steps, because the measurement said
diagonals were the biggest lever there was. True — and it meant the rule
changed from board to board with nothing on the board to say so, and the
marked moves left out the diagonals on one board and not the next. The lever
survives as how straight the ANSWER is, which the designer is told rather than
the player; the rule is eight ways out, everywhere. What it cost: a board with
a straight route is much harder to make unique under the eight-way rule (a
straight route has too many wandering rivals), so the big boards wander and the
small ones are the ones that can afford to be straight.

## A drag that painted

Shape Up's drag wrote the chosen mark into every cell it crossed. Efficient on
paper; in the hand it was a board that filled itself in whenever a thumb rested
on it to think. One mark per gesture, where the gesture ends. Nine and Hexagony
already worked that way, which should have been the hint.

## A string stuck with its first end

Once a Thread string had left one pin, pressing the other pin was refused for
good — `reach` selected the strand and then had nothing it could do. Restart
was the only way to lay the string the other way round, and it took every
other string with it. A press on the unused pin now winds the string off and
starts it there.
