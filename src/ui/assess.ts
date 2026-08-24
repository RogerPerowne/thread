/**
 * Assessment — the only mode that produces a score.
 *
 * A puzzle game cannot measure IQ. IQ tests are norm-referenced instruments
 * standardised on thousands of people across many item types, and their
 * validity rests entirely on that norming. So this reports the most
 * statistically defensible ability estimate the game can make, on a familiar
 * 100/15 scale, and calls it a Thread Score with the subtitle
 * "an IQ-style scale — not a clinical IQ test".
 *
 * Never from casual play: casual play silently updates a hidden estimate, and
 * the badge only ever comes from this deliberate ritual. One per seven days,
 * because repeated testing inflates scores through practice effects.
 */

import { h, clear } from './dom.js';
import { topBar, pill, modal, toast, radar, sparkline, statGrid } from './components.js';
import { type App, MODE_ACCENT } from './app.js';
import { Engine, type PlayResult } from '../game/engine.js';
import { deriveTarget, mechanicsOf, type Level } from '../core/level.js';
import { estimateDifficulty } from '../core/difficulty.js';
import {
  nextItem, scoreAssessment, estimateTheta, DISCLAIMER,
  type ItemParams, type ItemResult,
} from '../core/rating.js';
import { ticker } from '../render/tween.js';

const ITEM_COUNT = 12;
const ITEM_CAP_MS = 120_000;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function assessScreen(app: App): { el: HTMLElement; dispose?: () => void } {
  const el = h('div', { class: 'screen', style: `--accent:${MODE_ACCENT.assess};--accent-ink:#fff` });
  const bodyEl = h('div', { class: 'playwrap' });
  el.append(topBar('Assessment', { onBack: () => app.go({ name: 'home' }) }), bodyEl);

  const since = Date.now() - app.save.assess.lastAt;
  if (app.save.assess.lastAt > 0 && since < COOLDOWN_MS) {
    bodyEl.appendChild(cooldownCard(app, COOLDOWN_MS - since));
    return { el };
  }
  bodyEl.appendChild(introCard(app, () => {
    clear(bodyEl);
    runAssessment(app, bodyEl);
  }));
  return { el, dispose: () => ticker.cancelAll() };
}

function introCard(app: App, start: () => void): HTMLElement {
  const last = app.save.assess.history.at(-1);
  return h('div', { class: 'scroll', style: 'padding:22px 18px' },
    h('h2', { class: 'display', style: 'font-size:26px;margin:0 0 8px', text: 'Thread Score' }),
    h('p', { style: 'color:var(--mute);font-size:14px;margin:0 0 4px', text: 'an IQ-style scale — not a clinical IQ test' }),
    h('p', { text: `${ITEM_COUNT} puzzles, about ten minutes. They get harder or easier as you go. No hints, and only your first closed loop on each one is scored.` }),
    h('p', { text: 'Correctness counts for roughly four times as much as speed, so there is no reward for rushing. Taking a long look before your first peg and then solving it cleanly is the strongest thing you can do.' }),
    last ? h('div', {},
      h('div', { class: 'label', text: 'Last time' }),
      statGrid([[last.score, 'Score'], [`±${last.margin}`, 'Margin'], [`${last.percentile}`, 'Percentile'], [app.save.assess.history.length, 'Taken']]),
      sparkline(app.save.assess.history.map((x) => x.score), MODE_ACCENT.assess),
    ) : null,
    h('div', { class: 'actions', style: 'margin-top:22px' },
      (() => {
        const b = pill('Begin', start, 'accent');
        b.classList.add('block');
        return b;
      })()),
  );
}

function cooldownCard(app: App, remaining: number): HTMLElement {
  const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  const last = app.save.assess.history.at(-1);
  return h('div', { class: 'scroll', style: 'padding:22px 18px' },
    h('h2', { class: 'display', style: 'font-size:26px;margin:0 0 6px', text: last ? `${last.score} ± ${last.margin}` : 'Not yet' }),
    h('p', { style: 'color:var(--mute);font-size:14px;margin:0 0 14px', text: 'an IQ-style scale — not a clinical IQ test' }),
    last ? radar([
      ['Planning', last.profile.planning],
      ['Precision', last.profile.precision],
      ['Speed', last.profile.speed],
      ['Spatial', last.profile.spatial],
      ['Learning', last.profile.learning],
    ], MODE_ACCENT.assess) : null,
    h('p', { text: `You can take it again in ${days} day${days === 1 ? '' : 's'}. The wait is deliberate: taking the same kind of test repeatedly inflates the score through practice, and an inflated number would tell you nothing.` }),
    h('div', { class: 'actions' }, pill('Back', () => history.back(), 'ghost')),
  );
}

function runAssessment(app: App, mount: HTMLElement): void {
  const pool: ItemParams[] = app.assess.map((l) => {
    const d = estimateDifficulty(l, deriveTarget(l).raster);
    return { id: l.id, b: d.b, a: d.a, family: l.name ?? mechanicsOf(l)[0] };
  });
  const byId = new Map(app.assess.map((l) => [l.id, l]));

  const played = new Set<string>();
  const families = new Set<string>();
  const items: ItemParams[] = [];
  const results: ItemResult[] = [];
  let theta = app.save.hiddenTheta;

  const progress = h('div', { class: 'hud' });
  const board = h('div', { class: 'board' });
  mount.append(progress, board);

  const engine = new Engine(board, {
    themeId: app.save.settings.theme,
    skinId: app.save.settings.skin,
    reducedMotion: app.reducedMotion,
    autoAdvance: false,
  }, {
    onWin: (r) => record(r, true),
    onMiss: (r) => record(r, false),
  });

  let capFired = false;

  function nextOne(): void {
    if (results.length >= ITEM_COUNT) {
      finish();
      return;
    }
    const item = nextItem(pool, played, families, theta);
    if (!item) {
      finish();
      return;
    }
    played.add(item.id);
    families.add(item.family);
    items.push(item);
    const level = byId.get(item.id)!;
    capFired = false;

    clear(progress);
    progress.append(
      h('span', { class: 'chapter num', text: `${results.length + 1} of ${ITEM_COUNT}` }),
      h('div', { class: 'spool' }, h('i', { style: `width:${((results.length) / ITEM_COUNT) * 100}%` })),
    );
    engine.load(level);
    engine.resize();

    // 120 s cap per item, driven by the ticker like everything else.
    ticker.schedule(ITEM_CAP_MS, () => {
      if (capFired || results.length >= items.length) return;
      capFired = true;
      recordTimeout(level);
    });
    ticker.requestFrame();
  }

  function record(r: PlayResult, win: boolean): void {
    // Only the FIRST closed loop counts. A second attempt is data about
    // persistence, not about the ability being measured.
    if (results.length >= items.length) return;
    if (capFired) return;
    const item = items[items.length - 1];
    results.push({
      id: item.id,
      firstTry: win && r.attempt === 1,
      optimality: Math.min(1, r.par / Math.max(r.lengthUsed, 1e-6)),
      planningMs: r.planningMs,
      executionMs: r.executionMs,
      searchOps: r.searchOps,
      novel: !app.save.seenMechanics.includes(mechanicsOf(r.level)[0]),
      timedOut: false,
    });
    theta = estimateTheta(items, results.map((x) => x.firstTry));
    ticker.schedule(win ? 520 : 900, nextOne);
    ticker.requestFrame();
  }

  function recordTimeout(level: Level): void {
    const item = items[items.length - 1];
    results.push({
      id: item.id, firstTry: false, optimality: 0, planningMs: ITEM_CAP_MS,
      executionMs: ITEM_CAP_MS, searchOps: 0,
      novel: !app.save.seenMechanics.includes(mechanicsOf(level)[0]), timedOut: true,
    });
    theta = estimateTheta(items, results.map((x) => x.firstTry));
    toast('Time on that one');
    nextOne();
  }

  function finish(): void {
    engine.destroy();
    const report = scoreAssessment(items, results);
    const first = app.save.assess.history.length === 0;
    app.save.assess.lastAt = Date.now();
    app.save.assess.history.push({
      at: Date.now(),
      score: report.score,
      margin: report.margin,
      percentile: report.percentile,
      theta: report.theta,
      profile: report.profile,
    });
    app.save.hiddenTheta = report.theta;
    app.persist();

    clear(mount);
    mount.appendChild(h('div', { class: 'scroll', style: 'padding:22px 18px' },
      h('div', { class: 'label', text: 'Thread Score' }),
      h('h2', { class: 'display num', style: 'font-size:46px;margin:2px 0 0', text: `${report.score} ± ${report.margin}` }),
      h('p', { style: 'color:var(--mute);margin:2px 0 14px', text: `around the ${report.percentile}th percentile of Thread players` }),
      radar([
        ['Planning', report.profile.planning],
        ['Precision', report.profile.precision],
        ['Speed', report.profile.speed],
        ['Spatial', report.profile.spatial],
        ['Learning', report.profile.learning],
      ], MODE_ACCENT.assess),
      app.save.assess.history.length > 1
        ? sparkline(app.save.assess.history.map((x) => x.score), MODE_ACCENT.assess)
        : null,
      h('p', { style: 'font-size:13px;color:var(--mute);line-height:1.5' },
        'The margin is a confidence interval, not decoration: it narrows each time you take the test. '
        + 'The percentile is where the model places you among Thread players — an estimate from the '
        + 'ability model, not a count of real people, because Thread keeps everything on your device '
        + 'and has no one to compare you against.'),
      h('div', { class: 'actions', style: 'margin-top:16px' },
        pill('Home', () => app.go({ name: 'home' }), 'primary')),
    ));

    // Say it once, on the first reveal, and then never nag again.
    if (first) {
      modal((close) => [
        h('h2', { class: 'display', text: 'One thing first' }),
        h('p', { text: DISCLAIMER }),
        h('div', { class: 'actions' }, pill('Understood', close, 'primary')),
      ]);
    }
  }

  nextOne();
}
