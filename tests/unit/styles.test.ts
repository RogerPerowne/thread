import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Things about the stylesheets that no rendered page can catch.
 *
 * A test that renders the app and measures it runs in a desktop browser, where
 * `100vh` and `100dvh` are the same number and every rule below therefore
 * looks fine. The bug these exist for only appears on a phone, in Safari, with
 * the address bar showing — which is to say, on the device most people will
 * use. So the source is read instead.
 */

const dir = 'src/platform/design';
const sheets = readdirSync(dir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ name: f, css: readFileSync(`${dir}/${f}`, 'utf8') }));

const gameSheets = readdirSync('src/games', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(`src/games/${d.name}`)
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ game: d.name, name: f, css: readFileSync(`src/games/${d.name}/${f}`, 'utf8') })));

describe('the viewport units', () => {
  /**
   * Every rule, as its selector and its declarations.
   */
  function rules(css: string): { at: string; body: string }[] {
    const out: { at: string; body: string }[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) out.push({ at: m[1].trim(), body: m[2] });
    return out;
  }

  it('never lets a bare vh win over a dvh', () => {
    /*
     * On iOS `100vh` is the LARGE viewport: the page as it would be with the
     * browser's bars hidden. A page sized to it runs underneath the address
     * bar the whole time the bar is showing. Both units belong in the source —
     * the static one as a fallback — but the dynamic one has to come second,
     * because the later declaration is the one that applies.
     */
    for (const sheet of sheets) {
      for (const rule of rules(sheet.css)) {
        for (const prop of ['height', 'min-height', 'max-height']) {
          const decls: string[] = [...rule.body.matchAll(new RegExp(`${prop}\\s*:([^;]*)`, 'g'))]
            .map((d) => d[1]);
          // `findLastIndex` would read better and needs a newer lib than this
          // project targets; a loop costs nothing and keeps the target honest.
          const lastOf = (test: RegExp): number => {
            let at = -1;
            for (let i = 0; i < decls.length; i++) if (test.test(decls[i])) at = i;
            return at;
          };
          const lastVh = lastOf(/\d\s*vh\b/);
          const lastDvh = lastOf(/\d\s*dvh\b/);
          if (lastVh === -1 || lastDvh === -1) continue;
          expect(
            lastVh,
            `${sheet.name} — ${rule.at}: ${prop} sets vh after dvh, so vh wins and the page runs under Safari's bar`,
          ).toBeLessThan(lastDvh);
        }
      }
    }
  });

  it('leaves room for the notch and the home indicator', () => {
    const all = sheets.map((s) => s.css).join('\n');
    expect(all).toMatch(/safe-area-inset-top/);
    expect(all).toMatch(/safe-area-inset-bottom/);
    /*
     * And exactly one thing under a board owns the bottom inset.
     *
     * Two owners is the bug this catches, and it is invisible on a desktop:
     * `--safe-b` is zero there, so a layout that adds it twice looks perfect
     * and pushes the controls thirty-four pixels off the bottom of a phone.
     * The wrapper owns it; the rows inside it do not.
     */
    const play = sheets.find((s) => s.name === 'play.css')!.css;
    const components = sheets.find((s) => s.name === 'components.css')!.css;
    expect(play).toMatch(/\.playwrap\s*\{[^}]*--safe-b/s);
    expect(components).not.toMatch(/\.controls\s*\{[^}]*--safe-b/s);
  });
});

describe('what a game may style', () => {
  it('keeps every game inside its own board', () => {
    /*
     * The one rule a game's stylesheet must obey. A game that styles `.btn` or
     * `.gamebar` is a game that has reached out of its box, and the next game
     * to be added inherits whatever it did — which is how a design system
     * stops being one.
     */
    const platformOnly = [
      '.gamebar', '.btn', '.icon', '.controls', '.card', '.sheet', '.scrim',
      '.masthead', '.chip', '.deck', '.note', '.meter', 'body', '#app',
    ];
    for (const sheet of gameSheets) {
      for (const owned of platformOnly) {
        const re = new RegExp(`(^|[,{}\\s])${owned.replace('.', '\\.')}([\\s,{:]|$)`, 'm');
        expect(
          re.test(sheet.css),
          `${sheet.game}/${sheet.name} styles ${owned}, which belongs to the platform`,
        ).toBe(false);
      }
    }
  });

  it('gives every game a stylesheet of its own', () => {
    const games = readdirSync('src/games', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const game of games) {
      expect(
        gameSheets.some((s) => s.game === game),
        `${game} has no stylesheet, so its board is styled from somewhere it should not be`,
      ).toBe(true);
    }
  });
});

describe('the palette', () => {
  const tokens = sheets.find((s) => s.name === 'tokens.css')!.css;

  it('gives every game an accent, a tint and a card colour from the one family', () => {
    const accents = [...tokens.matchAll(/--a-([a-z]+):/g)].map((m) => m[1]);
    const tints = [...tokens.matchAll(/--t-([a-z]+):/g)].map((m) => m[1]);
    const cards = [...tokens.matchAll(/--c-([a-z]+):/g)].map((m) => m[1]);
    expect(accents.length).toBeGreaterThan(0);
    for (const a of accents) {
      expect(tints, `--a-${a} has no matching tint`).toContain(a);
      expect(cards, `--a-${a} has no matching card colour`).toContain(a);
    }
  });

  it('keeps charcoal readable on every card colour', () => {
    /*
     * The card colours carry black type, so this is not a preference — it is
     * whether the name of the game can be read. Measured rather than eyeballed,
     * because "looks fine on my screen" is how a 3:1 card ships.
     */
    const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const lum = (h: string): number => {
      const [r, g, b] = hex(h).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ink = lum(/--ink:\s*(#[0-9a-f]{6})/.exec(tokens)![1]);
    const cards = [...tokens.matchAll(/--c-([a-z]+):\s*(#[0-9a-f]{6})/g)];
    expect(cards.length).toBeGreaterThan(0);
    for (const [, name, value] of cards) {
      const l = lum(value);
      const ratio = (Math.max(l, ink) + 0.05) / (Math.min(l, ink) + 0.05);
      expect(ratio, `ink on --c-${name} is only ${ratio.toFixed(1)}:1`).toBeGreaterThan(7);
    }
  });

  it('honours a request for less movement', () => {
    expect(tokens).toMatch(/prefers-reduced-motion/);
    // Durations collapse; nothing that carries meaning is removed.
    expect(tokens).toMatch(/--fast:\s*1ms/);
  });
});
