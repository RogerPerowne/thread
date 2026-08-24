import { describe, it, expect } from 'vitest';
import { pitchFor } from '../../src/render/audio.js';

describe('the board sings', () => {
  it('pitch rises as the segment shortens — the real string relationship', () => {
    const long = pitchFor(80);
    const mid = pitchFor(40);
    const short = pitchFor(12);
    expect(mid).toBeGreaterThan(long);
    expect(short).toBeGreaterThan(mid);
  });
  it('is deterministic, so a shape always plays the same melody', () => {
    expect(pitchFor(37.5)).toBe(pitchFor(37.5));
  });
  it('stays inside a musical range', () => {
    for (let l = 1; l <= 140; l += 0.5) {
      const f = pitchFor(l);
      expect(f).toBeGreaterThan(100);
      expect(f).toBeLessThan(2000);
    }
  });
  it('two different shapes give different melodies', () => {
    const square = [50, 50, 50, 50].map(pitchFor);
    const star = [76, 76, 76, 76, 76].map(pitchFor);
    expect(square.join()).not.toBe(star.join());
  });
});
