/**
 * The Workshop: a level editor and share codes.
 *
 * The gate runs client-side before a code can be produced, so a shared level
 * is guaranteed solvable — user-generated content that cannot waste anyone's
 * time is the cheapest infinite content there is.
 */

import { h, clear, copy } from './dom.js';
import { topBar, pill, modal, toast } from './components.js';
import { type App, MODE_ACCENT } from './app.js';
import { BoardScene } from '../render/scene.js';
import { type Level, validateLevel, deriveTarget, cycleLength } from '../core/level.js';
import { initialState, canAdd, canClose, type PlayState } from '../core/rules.js';
import { quickCheck, checkLevel } from '../core/gate.js';
import { encodeLevel, decodeLevel, shareUrl, ShareCodeError } from '../game/sharecode.js';
import { ticker } from '../render/tween.js';
import type { Pt } from '../core/geometry.js';

type Draft = {
  pegs: [number, number][];
  sol: number[];
  allowCross: boolean;
  posts: [number, number, number][];
  gold: number[];
  thorn: number[];
  budget: number | null;
};

type Tool = 'peg' | 'thread' | 'post' | 'gold' | 'thorn' | 'erase';

export function workshopScreen(app: App): { el: HTMLElement; dispose?: () => void } {
  const el = h('div', { class: 'screen playwrap', style: `--accent:${MODE_ACCENT.workshop}` });
  const boardEl = h('div', { class: 'board' });
  const surface = h('div', { class: 'boardsurface' });
  boardEl.appendChild(surface);
  const toolbar = h('div', { class: 'toolbar' });
  const controls = h('div', { class: 'controls scrollx' });
  const primary = h('div', { class: 'primarybar' });

  el.append(
    topBar('Workshop', {
      onBack: () => app.go({ name: 'home' }),
      right: [h('button', { class: 'iconbtn', title: 'Open a code', onclick: openCode }, '⌘')],
    }),
    toolbar, boardEl, h('div', { class: 'spacer below' }), controls, primary,
  );

  const draft: Draft = {
    pegs: defaultPegs(),
    sol: [],
    allowCross: false,
    posts: [],
    gold: [],
    thorn: [],
    budget: null,
  };
  let tool: Tool = 'thread';

  const scene = new BoardScene(surface);
  let state: PlayState = initialState(asLevel(draft, true));

  function rebuild(): void {
    const level = asLevel(draft, true);
    state = initialState(level);
    state.threads[0].pegs = [...draft.sol];
    state.threads[0].closed = draft.sol.length >= 3;
    scene.mount(level, { theme: app.theme, skin: app.skin, showTarget: false });
    scene.setHitRadius(Math.min(surface.clientWidth, surface.clientHeight) || 320);
    scene.fillOpacity = 1;
    scene.update(state);
  }

  function toBoard(ev: PointerEvent): Pt {
    const rect = scene.svg.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const ox = rect.left + (rect.width - size) / 2;
    const oy = rect.top + (rect.height - size) / 2;
    return [((ev.clientX - ox) / size) * 100, ((ev.clientY - oy) / size) * 100];
  }

  const onDown = (ev: PointerEvent): void => {
    ev.preventDefault();
    const p = toBoard(ev);
    const peg = nearestPeg(draft.pegs, p, 5);

    switch (tool) {
      case 'peg':
        if (peg >= 0) return;
        if (draft.pegs.length >= 24) {
          toast('That is enough pegs');
          return;
        }
        draft.pegs.push([round1(p[0]), round1(p[1])]);
        break;
      case 'thread': {
        if (peg < 0) return;
        const level = asLevel(draft, true);
        const st = initialState(level);
        st.threads[0].pegs = [...draft.sol];
        if (draft.sol.length && draft.sol[draft.sol.length - 1] === peg) {
          if (canClose(level, st).ok) toast('Looks closed. Save to check it.');
          return;
        }
        if (draft.sol.length && !canAdd(level, st, peg).ok) {
          toast('That move is not legal here');
          return;
        }
        draft.sol.push(peg);
        break;
      }
      case 'post':
        draft.posts.push([round1(p[0]), round1(p[1]), 6]);
        break;
      case 'gold':
        if (peg >= 0 && !draft.gold.includes(peg)) draft.gold.push(peg);
        break;
      case 'thorn':
        if (peg >= 0 && !draft.thorn.includes(peg)) draft.thorn.push(peg);
        break;
      case 'erase':
        if (peg >= 0) erasePeg(draft, peg);
        else {
          const pi = draft.posts.findIndex(([x, y, r]) => Math.hypot(x - p[0], y - p[1]) <= r);
          if (pi >= 0) draft.posts.splice(pi, 1);
        }
        break;
    }
    rebuild();
  };

  scene.svg.addEventListener('pointerdown', onDown);

  function refreshToolbar(): void {
    clear(toolbar);
    const mk = (t: Tool, label: string) =>
      h('button', {
        class: `pill${tool === t ? ' primary' : ' ghost'}`,
        onclick: () => { tool = t; refreshToolbar(); },
      }, label);
    toolbar.append(mk('peg', 'Peg'), mk('thread', 'Thread'), mk('post', 'Post'), mk('gold', 'Gold'), mk('thorn', 'Thorn'), mk('erase', 'Erase'));
  }

  function refreshControls(): void {
    clear(controls);
    controls.append(
      pill('Undo', () => {
        if (draft.sol.length) draft.sol.pop();
        else if (draft.pegs.length > 3) draft.pegs.pop();
        rebuild();
      }, 'ghost'),
      pill(draft.allowCross ? 'Crossing: on' : 'Crossing: off', () => {
        draft.allowCross = !draft.allowCross;
        refreshControls();
        rebuild();
      }, 'ghost'),
      pill(spoolLabel(), () => {
        cycleBudget();
        refreshControls();
        rebuild();
      }, 'ghost'),
    );
    clear(primary);
    // The one action that matters gets the full width, at the bottom.
    const share2 = pill('Check and share', () => share(), 'primary');
    share2.classList.add('block');
    primary.appendChild(share2);
  }

  function spoolLabel(): string {
    if (draft.budget === null) return 'Spool: off';
    return `Spool: ${draft.budget.toFixed(0)}`;
  }

  /** Off, then tight, then a little slack — measured from the drawn loop. */
  function cycleBudget(): void {
    if (draft.sol.length < 3) {
      toast('Thread a loop first, then the spool has something to measure');
      draft.budget = null;
      return;
    }
    const lvl = asLevel(draft, false);
    const par = cycleLength(lvl, draft.sol);
    if (draft.budget === null) draft.budget = Math.round(par * 1.03);
    else if (draft.budget < par * 1.1) draft.budget = Math.round(par * 1.2);
    else draft.budget = null;
  }

  function share(): void {
    let level: Level;
    try {
      level = validateLevel({ ...asLevel(draft, false), id: 'workshop', mode: 'classic', chapter: 0 });
    } catch (e) {
      toast((e as Error).message.replace(/^level [^:]*: /, ''));
      return;
    }
    const quick = quickCheck(level);
    if (!quick.ok) {
      modal((close) => [
        h('h2', { class: 'display', text: 'Not ready yet' }),
        h('p', { text: 'The gate found something. A shared level has to be solvable and fair, so this has to pass first.' }),
        h('ul', { style: 'font-size:13px;line-height:1.6;padding-left:18px' },
          ...quick.problems.map((p) => h('li', { text: p })),
        ),
        h('div', { class: 'actions' }, pill('Back to it', close, 'primary')),
      ]);
      return;
    }
    // The full gate, including the cycle search, before a code goes out.
    const full = checkLevel(level, { budgetMs: 800 });
    const code = encodeLevel(level);
    if (!app.save.workshop.includes(code)) {
      app.save.workshop.push(code);
      app.persist();
    }
    modal((close) => [
      h('h2', { class: 'display', text: 'Ready to share' }),
      h('p', { text: full.pass ? 'It passes every check.' : 'It is solvable and fair. The uniqueness search found something worth knowing:' }),
      full.pass ? null : h('p', { class: 'sub', style: 'font-size:12px;color:var(--mute)', text: full.checks.filter((c) => !c.pass).map((c) => c.detail).join('; ') }),
      h('pre', { class: 'share', text: code }),
      h('div', { class: 'actions' },
        pill('Close', close, 'ghost'),
        pill('Copy link', async () => {
          const ok = await copy(shareUrl(code));
          toast(ok ? 'Link copied' : 'Could not copy');
        }, 'ghost'),
        pill('Play it', () => { close(); app.go({ name: 'play', mode: 'shared', seed: code }); }, 'primary'),
      ),
    ]);
  }

  function openCode(): void {
    const input = h('input', { type: 'text', placeholder: 'Paste a code', 'aria-label': 'Level code' });
    modal((close) => [
      h('h2', { class: 'display', text: 'Open a level' }),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Code' }), input),
      h('div', { class: 'actions' },
        pill('Cancel', close, 'ghost'),
        pill('Open', () => {
          try {
            const level = decodeLevel(input.value);
            close();
            app.go({ name: 'play', mode: 'shared', seed: encodeLevel(level) });
          } catch (e) {
            toast(e instanceof ShareCodeError ? e.message : 'That code did not work');
          }
        }, 'primary'),
      ),
    ]);
  }

  refreshToolbar();
  refreshControls();
  rebuild();
  const onResize = () => rebuild();
  window.addEventListener('resize', onResize);
  ticker.after(16, rebuild);
  ticker.requestFrame();

  return {
    el,
    dispose: () => {
      window.removeEventListener('resize', onResize);
      scene.svg.removeEventListener('pointerdown', onDown);
      scene.destroy();
    },
  };
}

function asLevel(d: Draft, lenient: boolean): Level {
  const sol = d.sol.length >= 3 ? d.sol : lenient ? [0, 1, 2] : d.sol;
  const level: Level = {
    id: 'draft', mode: 'classic', chapter: 0,
    pegs: d.pegs,
    threads: [{ color: '#7A4FBF', sol }],
  };
  if (d.allowCross) level.allowCross = true;
  if (d.posts.length) level.posts = d.posts;
  if (d.gold.length) level.gold = d.gold;
  if (d.thorn.length) level.thorn = d.thorn;
  if (d.budget !== null) level.budget = d.budget;
  return level;
}

function defaultPegs(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    out.push([round1(50 + 32 * Math.cos(a)), round1(50 + 32 * Math.sin(a))]);
  }
  return out;
}

function erasePeg(d: Draft, peg: number): void {
  if (d.pegs.length <= 3) return;
  d.pegs.splice(peg, 1);
  const remap = (i: number) => (i > peg ? i - 1 : i);
  d.sol = d.sol.filter((i) => i !== peg).map(remap);
  d.gold = d.gold.filter((i) => i !== peg).map(remap);
  d.thorn = d.thorn.filter((i) => i !== peg).map(remap);
  // Collapse any back-to-back repeat the removal created.
  d.sol = d.sol.filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
}

function nearestPeg(pegs: [number, number][], p: Pt, radius: number): number {
  let best = -1;
  let bd = radius * radius;
  pegs.forEach((q, i) => {
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export { deriveTarget };
