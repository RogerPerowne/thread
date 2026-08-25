import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/ui/styles.css', 'utf8');

/**
 * The bug this holds: the bottom of the play screen sat underneath Safari's
 * search bar.
 *
 * On iOS, `100vh` is the LARGE viewport — the page as it would be with the bar
 * hidden — so anything sized to it runs under the bar the whole time the bar is
 * showing. `100dvh` is the viewport as it currently is. Both are needed, since
 * dvh is not everywhere, but the order decides which one wins: the static unit
 * has to come first as the fallback, and the dynamic one after it.
 *
 * Written the wrong way round it still looks correct, and still works on every
 * desktop browser, because there the two are the same number.
 */
describe('viewport height, and Safari', () => {
  const rules = css.split('}');

  it('never lets 100vh override 100dvh in the same rule', () => {
    for (const rule of rules) {
      const vh = rule.lastIndexOf('100vh');
      const dvh = rule.lastIndexOf('100dvh');
      if (vh < 0 || dvh < 0) continue;
      // lastIndexOf('100vh') also matches inside '100dvh', so only a match
      // that is not part of a dvh counts.
      const bareVh = [...rule.matchAll(/100vh/g)]
        .map((m) => m.index ?? -1)
        .filter((i) => rule.slice(Math.max(0, i - 1), i) !== 'd');
      if (bareVh.length === 0) continue;
      const head = (rule.split('{')[0] ?? '').trim().split('\n').pop();
      expect(
        Math.max(...bareVh) < dvh,
        `${head}: 100vh comes after 100dvh, so it wins and the page runs under Safari's bar`,
      ).toBe(true);
    }
  });

  it('sizes the play screen to the viewport as it actually is', () => {
    const rule = rules.find((r) => /\.screen\.play\s*\{/.test(r + '}'));
    expect(rule, 'no .screen.play rule at all').toBeTruthy();
    expect(rule).toContain('100dvh');
  });

  it('keeps the play screen toolbar clear of the home indicator', () => {
    const rule = rules.find((r) => /\.screen\.play \.toolbar\s*\{/.test(r + '}'));
    expect(rule, 'the toolbar does not clear the safe area').toBeTruthy();
    expect(rule).toContain('--safe-b');
  });
});
