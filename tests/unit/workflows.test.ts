import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * The workflow files parse.
 *
 * The scar this exists for: a step written as
 *
 *     - name: Board gate: every board has exactly one answer
 *
 * is not valid YAML — a plain scalar cannot contain a colon followed by a
 * space — so GitHub could not read the file at all. Every run of it failed
 * INSTANTLY, with no jobs, from the first commit onwards. On the runs page
 * that looks exactly like a red test suite, so the gate everybody believed
 * was standing had never once been stood up.
 *
 * There is no YAML parser in this project and one is not worth adding for
 * this, so the one construct that broke it is checked directly. A value that
 * has to be quoted and is not is the whole failure.
 */
const dir = '.github/workflows';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ name: f, text: readFileSync(`${dir}/${f}`, 'utf8') }));

describe('the workflow files', () => {
  it('exist to be read at all', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('$name quotes any value holding a colon', ({ name, text }) => {
    text.split('\n').forEach((line, i) => {
      const m = /^\s*(?:-\s*)?[\w-]+:\s+(.*?)\s*$/.exec(line);
      if (!m) return;
      const value = m[1];
      // A comment, a block scalar, or a value already in quotes is fine.
      if (value === '' || value.startsWith('#')) return;
      if (value.startsWith('|') || value.startsWith('>')) return;
      if (/^'.*'$/.test(value) || /^".*"$/.test(value)) return;
      // So is a flow collection, whose own syntax carries the colons.
      if (value.startsWith('[') || value.startsWith('{')) return;
      expect(
        value.includes(': '),
        `${name}:${i + 1} needs quotes round "${value}"`,
      ).toBe(false);
    });
  });
});
