/**
 * The screen a puzzle is played in.
 *
 * Every game gets exactly this: a bar, a board, a note, a row of controls, and
 * a result. The game supplies the board and nothing else — it never draws a
 * button, never reads the clock, never touches storage. That is the whole
 * point of the split, and it is why adding a sixth game is a matter of writing
 * an engine rather than a screen.
 *
 * Two things here are easy to get wrong and are worth stating.
 *
 * The clock stops when the tab does. A timer that runs while the phone is in a
 * pocket does not measure solving, it measures elapsed time, and a personal
 * best that includes lunch is not a personal best.
 *
 * The controls that are shown are the ones that can do something. Undo greys
 * out when there is nothing to undo, redo appears only once something has been
 * undone, and hint is absent entirely on a board with nothing left to deduce.
 * A dead control is worse than a missing one: it invites a press and then
 * refuses it.
 */

import { h } from '../dom.js';
import { iconButton, button, sheet, meter } from './components.js';
import { icon } from './icons.js';
import * as haptics from '../haptics.js';
import * as store from '../store.js';
import { BAND_NAME, type Band, type Hint, type Puzzle, type Session, type View, type ViewHost }
  from '../types.js';
import type { AnyGame } from '../registry.js';

export type FrameHooks = {
  onBack(): void;
  onNext(): void | null;
  /** The puzzle after this one, if there is one. */
  readonly next: Puzzle<unknown> | null;
  /** Where this puzzle sits, for the bar: "No. 14". */
  readonly label: string;
};

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function gameFrame(
  game: AnyGame, puzzle: Puzzle<unknown>, hooks: FrameHooks,
): { el: HTMLElement; dispose(): void } {
  const session: Session<unknown> = game.begin(puzzle);
  const accent = `var(--${game.meta.accent})`;

  /*
   * Resume before anything is drawn, so the board's first frame is the board
   * the player left rather than an empty one that fills in.
   */
  const saved = store.resumeOf(game.meta.id, puzzle.id);
  if (saved) session.load(saved);
  store.markOpened(game.meta.id, puzzle.id);

  // --- the clock -----------------------------------------------------------
  let elapsed = 0;
  let running = true;
  let since = performance.now();
  /*
   * Three facts about a board, and two of them used to be one — which is how
   * a board you revealed and then took back could never be completed at all.
   * You could draw the whole answer yourself, correctly, and the board would
   * sit there saying "The answer" and never say you had solved it.
   *
   * `resting` — the board is done being played for now: the clock is stopped
   *   and nothing is autosaved. True of a solved board and of a revealed one.
   *   NOT a latch. Undo a solved board, or take a reveal back, and the board
   *   is live again, because it is — and solving it then finishes it again.
   *   Completion is a fact about the board as it stands, checked every time
   *   anything changes, and never a door that shuts once.
   *
   * `saw` — the player has seen the answer to this puzzle. That one sticks,
   *   and it is what keeps the record honest: no time, no personal best, no
   *   day on the streak. Solving it yourself afterwards still COMPLETES the
   *   board, because a board that is right and will not say so is a dead end
   *   with nothing to do in it. It simply is not written down.
   *
   * `handed` — the board holds the answer because the reveal put it there.
   *   An EVENT, not a comparison: the answer is unique, so a player who draws
   *   it themselves reproduces the revealed board exactly, and any test that
   *   asks "is the board the answer?" can never tell the two apart. What can
   *   be told apart is who wrote it, so the reveal's own write sets this and
   *   the very next change to the board clears it.
   */
  let resting = false;
  let saw = false;
  let handed = false;
  /** True only while the reveal is writing, so that write can be told from a move. */
  let revealing = false;

  const tick = (): number => {
    if (running && !resting) {
      const now = performance.now();
      elapsed += (now - since) / 1000;
      since = now;
    }
    return elapsed;
  };
  const setRunning = (on: boolean) => {
    tick();
    running = on;
    since = performance.now();
    pauseBtn.replaceChildren(icon[on ? 'pause' : 'play']());
    pauseBtn.setAttribute('aria-label', on ? 'Pause' : 'Resume');
    el.classList.toggle('paused', !on);
  };

  // The tab going away is a pause. Nothing else needs to know.
  const onHidden = () => { if (document.hidden) setRunning(false); };
  document.addEventListener('visibilitychange', onHidden);

  // --- the bar -------------------------------------------------------------
  const clockEl = h('span', { class: 'num', text: '0:00' });
  const pauseBtn = iconButton('pause', 'Pause', () => setRunning(!running));

  const bar = h('div', { class: 'gamebar chrome' },
    iconButton('back', 'Back to Games', () => hooks.onBack()),
    h('div', { class: 'middle' },
      h('div', { class: 'title', text: game.meta.name }),
      h('div', { class: 'sub' },
        h('span', { text: hooks.label }),
        h('span', { class: 'dot', text: BAND_NAME[puzzle.band as Band] }),
        h('span', { class: 'dot' }, clockEl),
      ),
    ),
    h('div', { class: 'right' },
      iconButton('rules', 'Rules', showRules),
      pauseBtn,
    ),
  );

  // --- the board -----------------------------------------------------------
  const stage = h('div', { class: 'stage' });
  const note = h('div', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const bar2 = meter();

  const undoBtn = button('Undo', () => { session.undo(); view.refresh(); changed(); }, { glyph: 'undo' });
  const redoBtn = button('Redo', () => { session.redo(); view.refresh(); changed(); }, { glyph: 'redo' });
  const restartBtn = button('Restart', askRestart, { glyph: 'restart' });
  const revealBtn = button('Reveal', askReveal, {
    glyph: 'reveal', label: 'Cannot solve it — show the answer',
  });
  const hintBtn = button('Hint', showHint, { glyph: 'hint' });
  const nextBtn = button('Next', () => hooks.onNext(), { kind: 'accent', glyph: 'next' });
  nextBtn.hidden = true;

  /*
   * Five slots, always five. Next takes the hint's place when the board is
   * solved rather than arriving as a sixth control, because a row that grows a
   * button rewrites the width of the others under a thumb that is reaching for
   * one of them. A row that never changes shape cannot do that.
   *
   * Reveal is the only way out of a board nobody can finish, so it is a slot
   * and not a thing buried in a sheet — but it is the last slot before the
   * hint and it never looks like the way on: dimmed the moment the board is
   * solved, like Undo with nothing to undo.
   */
  const controls = h('div', { class: 'controls chrome' },
    undoBtn, redoBtn, restartBtn, revealBtn, hintBtn, nextBtn);

  const el = h('div', { class: 'screen fixed play' },
    bar,
    h('div', { class: 'playwrap' },
      h('div', { class: 'topline' }, note, bar2.el),
      stage,
      controls,
    ),
  );
  el.style.setProperty('--accent', accent);

  /*
   * Declared before the board is mounted, not after. A game paints itself as
   * it comes up and that first paint calls straight back into `changed` —
   * which reads this. Declared below the mount it is in its temporal dead
   * zone at exactly that moment, and the board never appears.
   */
  let saveTimer = 0;
  /*
   * The result is shown a beat after the solve, so the board's own
   * confirmation is seen before a sheet covers it. That beat has to be
   * cancellable: press Next inside it and the sheet would otherwise open over
   * the puzzle you have just moved to, and its scrim eats every touch — the
   * new board looks fine and simply does not respond.
   */
  let resultTimer = 0;
  /*
   * The hint and the board's own sentence, for the same reason as above: a
   * game's first paint calls `changed`, which reads all four of these, and a
   * `let` below the mount is in its temporal dead zone at exactly that moment.
   * Thread and Zigzag paint at mount; Shape Up does not, which is how the
   * dead zone shipped once and passed one game's tests.
   */
  let rung = 0;
  let lastHint: Hint | null = null;
  let lastState = '';
  /** Something the board asked to have read, standing until the next change. */
  let spoken = false;

  // --- the game's own board ------------------------------------------------
  const host: ViewHost = {
    changed,
    solved: () => { /* the frame notices from the verdict; games need not tell it twice */ },
    buzz: (kind) => haptics[kind](),
    say,
    stillness: still(),
  };
  const view: View = game.mount(stage, session, host);

  // --- keeping up ----------------------------------------------------------
  /*
   * What the board looked like at the last change, so a repaint can be told
   * from a change. A game paints on every pointer-up whether or not anything
   * moved, and a hint that vanished because the player rested a thumb on the
   * board would be a hint nobody could read to the end.
   */
  function say(text: string): void {
    if (lastHint) dropHint();
    spoken = true;
    note.replaceChildren(text);
    note.classList.add('said');
    note.classList.remove('bad', 'good');
  }

  function changed(): void {
    const v = session.verdict();
    const now = JSON.stringify(session.state);
    if (now !== lastState) {
      lastState = now;
      /* Who wrote this. Every change but the reveal's own is the player. */
      handed = revealing;
      /* The board moved on. A spotlight left standing would light up a place
         the hint was about on a board that no longer exists, and a sentence
         the board asked to have read was about that board too. */
      if (lastHint) dropHint();
      if (spoken) { spoken = false; note.classList.remove('said'); }
    }
    /* "The answer" only while the board is still the one the reveal wrote.
       Take it back and draw it yourself and the board says Solved, because
       that is what happened. */
    if (!lastHint && !spoken) {
      note.replaceChildren(handed ? 'The answer'
        : v.solved ? 'Solved' : (v.fault || v.left));
    }
    note.classList.toggle('bad', !lastHint && !spoken && !v.solved && v.fault !== '');
    note.classList.toggle('good', v.solved && !handed);
    bar2.set(v.progress);

    /* Dimmed, never removed. Hiding Redo is what makes the row grow a button
       the first time you undo, and the controls beside it move under a thumb
       that was already reaching for one of them. */
    undoBtn.disabled = !session.canUndo();
    redoBtn.disabled = !session.canRedo();
    revealBtn.disabled = v.solved;
    hintBtn.hidden = v.solved;
    nextBtn.hidden = !v.solved || !hooks.next;

    /*
     * Written on a short delay rather than on every move: a drag across a
     * board is dozens of changes, and localStorage is synchronous.
     */
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (!resting) store.keep(game.meta.id, puzzle.id, session.save());
    }, 400);

    /*
     * The board is asked whether it is solved on every change, and answers
     * for the board as it stands — so a board that becomes solved says so
     * whenever that happens, however it happened, and a board that stops
     * being solved goes back to being played.
     */
    if (v.solved && !resting) {
      resting = true;
      if (!handed) finish();
    } else if (!v.solved && resting) {
      resting = false;
      reopen();
    }
  }

  // --- finishing -----------------------------------------------------------
  function finish(): void {
    const took = tick();
    /* Recorded only if the answer was never shown. A time you were handed is
       not a time, and a streak a Reveal keeps alive means nothing. */
    if (!saw) store.finish(game.meta.id, puzzle.id, took);
    haptics.win();
    el.classList.add('won');
    // A beat for the board's own confirmation before the result covers it.
    resultTimer = window.setTimeout(() => showResult(took), still() ? 0 : 620);
  }

  /**
   * The board was finished and is not any more: undone, or a reveal taken
   * back. The celebration is called off and the clock picks up from now
   * rather than from the moment it stopped, which would otherwise hand the
   * player every second they spent looking at a finished board.
   */
  function reopen(): void {
    clearTimeout(resultTimer);
    el.classList.remove('won');
    since = performance.now();
  }

  function showResult(took: number): void {
    /*
     * Filled in by `sheet()` below, and referenced by the buttons built before
     * it. It was `close()` — which resolved to `window.close()`, a no-op in
     * any tab the script did not open, so the sheet was never actually shut by
     * its own buttons and only went away because the route change swept it up.
     */
    let shut = (): void => {};
    const stats = store.statsOf(game.meta.id);
    const sig = session.signature();
    const line = `${game.meta.shareName} ${hooks.label}\n${store.clock(took)}\n${sig}`;

    /*
     * A board finished after the answer was shown is finished — it says so,
     * and it offers the way on — but there is no time on it and nothing to
     * share. Saying "Solved in 0:12" over a board that was read off the
     * screen would be the one lie the whole record rests on not telling.
     */
    const body = saw
      ? [
        h('div', { class: 'result' },
          h('div', { class: 'label', text: 'Filled in' }),
          h('div', { class: 'big num', text: '—' }),
          h('div', { class: 'sig', text: 'Not timed: the answer was shown' }),
        ),
        hooks.next
          ? button('Next puzzle', () => { shut(); hooks.onNext(); }, { wide: true, kind: 'accent', glyph: 'next' })
          : button('Back to Games', () => { shut(); hooks.onBack(); }, { wide: true, kind: 'accent' }),
      ]
      : [
        h('div', { class: 'result' },
          h('div', { class: 'label', text: 'Solved in' }),
          h('div', { class: 'big num', text: store.clock(took) }),
          h('div', { class: 'sig', text: sig }),
          h('div', { class: 'row' },
            h('div', {}, h('div', { class: 'v num', text: String(stats.streak) }), h('div', { class: 'label', text: 'Day streak' })),
            h('div', {}, h('div', { class: 'v num', text: stats.best === null ? '—' : store.clock(stats.best) }), h('div', { class: 'label', text: 'Best' })),
            h('div', {}, h('div', { class: 'v num', text: String(stats.solved) }), h('div', { class: 'label', text: 'Solved' })),
          ),
        ),
        button('Share result', () => share(line), { wide: true, glyph: 'share' }),
        h('div', { style: 'height:8px' }),
        hooks.next
          ? button('Next puzzle', () => { shut(); hooks.onNext(); }, { wide: true, kind: 'accent', glyph: 'next' })
          : button('Back to Games', () => { shut(); hooks.onBack(); }, { wide: true, kind: 'accent' }),
      ];
    shut = sheet('Solved', body);
  }

  async function share(text: string): Promise<void> {
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      note.textContent = 'Result copied';
    } catch {
      // Refused, or dismissed. Saying nothing is the right answer: the player
      // either shared it or decided not to, and neither is a failure.
    }
  }

  // --- hints ---------------------------------------------------------------
  /*
   * Three rungs, climbed by pressing again: where to look, then why, then the
   * move. The rung is written on the note — "1 of 3" — because a hint that
   * says "Look here" and nothing about there being more to ask for is one
   * most people press once and give up on.
   *
   * The rung belongs to the board as it stands. Change anything and the hint
   * is dropped with its spotlight, so the next press starts again from where
   * to look on the board that is actually there.
   */
  function dropHint(): void {
    lastHint = null;
    rung = 0;
    note.classList.remove('hint');
    view.spotlight([]);
  }
  /* Pressing Hint while the board is still saying something: the hint wins,
     and the sentence goes with the next change like it always would. */

  function showHint(): void {
    if (spoken) { spoken = false; note.classList.remove('said'); }
    const hint = session.hint();
    if (!hint) {
      /* The shell does not know what this game is made of, so it cannot say
         what to put down next. It used to try, in Thread's words, on all six
         boards. */
      dropHint();
      note.replaceChildren('Nothing to point at from here');
      return;
    }
    rung = lastHint ? Math.min(rung + 1, 2) : 0;
    lastHint = hint;

    view.spotlight(hint.focus);
    const text = rung === 0 ? 'Look here'
      : rung === 1 || !hint.move ? hint.reason
      : hint.move;
    note.replaceChildren(
      h('b', { class: 'rung', text: `${Math.min(rung, hint.move ? 2 : 1) + 1} of ${hint.move ? 3 : 2}` }),
      text,
    );
    note.classList.add('hint');
    note.classList.toggle('bad', hint.kind === 'fix' && rung > 0);
    note.classList.remove('good');
  }

  // --- giving up ------------------------------------------------------------
  /*
   * The sweep, and why the platform owns it rather than each game.
   *
   * A bar of light crosses the board, and the answer is written in UNDER it —
   * at the moment the bar is over the middle, so what a player sees is the
   * light passing and the board being different behind it. Nothing here knows
   * what a cell, a post or a tile is: it dims the board, swaps the state at
   * the crossing, and brings it back. That is why one animation can serve six
   * games that share no geometry at all.
   *
   * The two halves are equal by construction — `--sweep` is the whole
   * duration and the swap happens at half of it, read back from the same
   * custom property the stylesheet animates — so the light cannot drift out of
   * step with the change it is meant to be hiding.
   */
  const SWEEP_MS = 1080;
  let sweepTimers: number[] = [];
  /* A sweep already crossing the board. The only thing a second press has to
     be stopped from doing: showing the answer twice is otherwise harmless, and
     a control that is lit and does nothing is worse than one that is dimmed. */
  let sweeping = false;

  function askReveal(): void {
    const close = sheet('Cannot solve it?', [
      h('p', {
        text: 'The answer goes on the board. This puzzle will not be counted as '
          + 'solved, and it will not add to your streak.',
      }),
      button('Show me the answer', () => { close(); doReveal(); },
        { wide: true, kind: 'solid', glyph: 'reveal' }),
      h('div', { style: 'height:8px' }),
      button('Keep trying', () => close(), { wide: true }),
    ]);
  }

  function doReveal(): void {
    if (sweeping) return;
    sweeping = true;
    /* Sticks. From here this board can be completed but never recorded. */
    saw = true;
    /* Bank the clock BEFORE the board goes to rest: `tick` only accumulates
       while it is being played, so the other order loses the last stretch. */
    tick();
    store.forget(game.meta.id, puzzle.id);

    const write = () => {
      /* The one write that is not a move. `changed` reads this to know that
         the board it is looking at was handed over rather than played. */
      revealing = true;
      session.reveal();
      view.refresh();
      changed();
      revealing = false;
      haptics.bump();
    };

    if (still()) { sweeping = false; write(); return; }

    const light = h('div', { class: 'sweep', 'aria-hidden': 'true' });
    light.style.setProperty('--sweep', `${SWEEP_MS}ms`);
    stage.appendChild(light);
    el.classList.add('revealing');
    sweepTimers.push(window.setTimeout(write, SWEEP_MS / 2));
    sweepTimers.push(window.setTimeout(() => {
      el.classList.remove('revealing');
      light.remove();
      sweeping = false;
    }, SWEEP_MS));
  }

  function askRestart(): void {
    const close = sheet('Start again?', [
      h('p', { text: 'This clears the board. The clock keeps running.' }),
      button('Clear the board', () => {
        close();
        session.restart();
        view.refresh();
        changed();
      }, { wide: true, kind: 'solid' }),
      h('div', { style: 'height:8px' }),
      button('Keep playing', () => close(), { wide: true }),
    ]);
  }

  function showRules(): void {
    sheet(`How ${game.meta.name} works`, [
      h('ul', {}, ...game.meta.rules.map((r) => h('li', { text: r }))),
    ]);
  }

  // --- the running clock ---------------------------------------------------
  const clockTimer = window.setInterval(() => {
    clockEl.textContent = store.clock(tick());
  }, 500);

  changed();

  return {
    el,
    dispose() {
      clearInterval(clockTimer);
      clearTimeout(saveTimer);
      clearTimeout(resultTimer);
      for (const t of sweepTimers) clearTimeout(t);
      sweepTimers = [];
      document.removeEventListener('visibilitychange', onHidden);
      if (!resting) store.keep(game.meta.id, puzzle.id, session.save());
      view.dispose();
    },
  };
}
