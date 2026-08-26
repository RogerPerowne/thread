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
  let finished = false;

  const tick = (): number => {
    if (running && !finished) {
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
  const hintBtn = button('Hint', showHint, { glyph: 'hint' });
  const nextBtn = button('Next', () => hooks.onNext(), { kind: 'accent', glyph: 'next' });
  nextBtn.hidden = true;

  /*
   * Four slots, always. Next takes the hint's place when the board is solved
   * rather than arriving as a fifth control, because a row that grows a button
   * rewrites the width of the other three under a thumb that is reaching for
   * one of them. A row that never changes shape cannot do that.
   */
  const controls = h('div', { class: 'controls chrome' },
    undoBtn, redoBtn, restartBtn, hintBtn, nextBtn);

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

  // --- the game's own board ------------------------------------------------
  const host: ViewHost = {
    changed,
    solved: () => { /* the frame notices from the verdict; games need not tell it twice */ },
    buzz: (kind) => haptics[kind](),
    stillness: still(),
  };
  const view: View = game.mount(stage, session, host);

  // --- keeping up ----------------------------------------------------------
  function changed(): void {
    const v = session.verdict();
    note.textContent = v.solved ? 'Solved' : (v.fault || v.left);
    note.classList.toggle('bad', !v.solved && v.fault !== '');
    note.classList.toggle('good', v.solved);
    bar2.set(v.progress);

    /* Dimmed, never removed. Hiding Redo is what makes the row grow a button
       the first time you undo, and the three controls beside it move under a
       thumb that was already reaching for one of them. */
    undoBtn.disabled = !session.canUndo();
    redoBtn.disabled = !session.canRedo();
    hintBtn.hidden = v.solved;
    nextBtn.hidden = !v.solved || !hooks.next;

    /*
     * Written on a short delay rather than on every move: a drag across a
     * board is dozens of changes, and localStorage is synchronous.
     */
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (!finished) store.keep(game.meta.id, puzzle.id, session.save());
    }, 400);

    if (v.solved && !finished) finish();
  }

  // --- finishing -----------------------------------------------------------
  function finish(): void {
    finished = true;
    const took = tick();
    store.finish(game.meta.id, puzzle.id, took);
    haptics.win();
    el.classList.add('won');
    // A beat for the board's own confirmation before the result covers it.
    resultTimer = window.setTimeout(() => showResult(took), still() ? 0 : 620);
  }

  function showResult(took: number): void {
    const stats = store.statsOf(game.meta.id);
    const sig = session.signature();
    const line = `${game.meta.shareName} ${hooks.label}\n${store.clock(took)}\n${sig}`;

    const body = [
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
        ? button('Next puzzle', () => { close(); hooks.onNext(); }, { wide: true, kind: 'accent', glyph: 'next' })
        : button('Back to Games', () => { close(); hooks.onBack(); }, { wide: true, kind: 'accent' }),
    ];
    sheet('Solved', body);
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
  let rung = 0;
  let lastHint: Hint | null = null;

  function showHint(): void {
    const hint = session.hint();
    if (!hint) {
      note.textContent = 'Nothing to point at yet — lay some more string';
      return;
    }
    if (lastHint && hint.reason === lastHint.reason) rung = Math.min(rung + 1, 2);
    else rung = 0;
    lastHint = hint;

    view.spotlight(hint.focus);
    if (rung === 0) {
      note.textContent = 'Look here';
    } else if (rung === 1 || !hint.move) {
      note.textContent = hint.reason;
    } else {
      note.textContent = hint.move;
    }
    /*
     * Escalating rather than answering: press once and the board shows you
     * where to look, press again and it says why, press a third time and only
     * then does it name the move. A hint that reveals the answer on the first
     * press is not a hint, it is a quit button.
     */
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
      document.removeEventListener('visibilitychange', onHidden);
      if (!finished) store.keep(game.meta.id, puzzle.id, session.save());
      view.dispose();
    },
  };
}
