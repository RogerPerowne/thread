/**
 * The board sings.
 *
 * Each segment plucks a note whose pitch rises as the segment shortens — the
 * real relationship for a vibrating string, f proportional to 1/L. Every shape
 * therefore has its own melody, and tying off strums the loop in order.
 * Completing a chapter plays its levels' melodies as one piece.
 */

import type { Theme } from './theme.js';

/** Board-space length of the longest sensible segment, mapped to the low note. */
const LONGEST = 100;
const BASE_HZ = 174.61; // F3

/** Quantise to a pentatonic scale so no shape can sound wrong. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

export function pitchFor(length: number): number {
  // f ∝ 1/L, then snapped to the nearest scale degree.
  const ratio = LONGEST / Math.max(length, 4);
  const semis = 12 * Math.log2(ratio);
  let best = SCALE[0];
  let bestD = Infinity;
  for (const s of SCALE) {
    const d = Math.abs(s - semis);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return BASE_HZ * Math.pow(2, best / 12);
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  private theme: Theme | null = null;

  setTheme(t: Theme): void {
    this.theme = t;
  }

  /** Created lazily on the first gesture — browsers require that. */
  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
      return this.ctx;
    } catch {
      return null; // audio is a nicety; never let it break play
    }
  }

  /** One note. `when` is an offset in seconds from now. */
  note(freq: number, when = 0, dur = 0.5, gain = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = this.theme?.instrument ?? 'triangle';
    osc.frequency.setValueAtTime(freq, t0);

    const timbre = this.theme?.timbre ?? 0.3;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain * (0.5 + timbre * 0.5), t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env);
    env.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Pluck for a segment of the given board-space length. */
  pluck(length: number, gain = 1): void {
    this.note(pitchFor(length), 0, 0.42, gain);
  }

  /** Tying off strums the loop, in order — every shape has its own melody. */
  strum(lengths: number[]): void {
    lengths.forEach((l, i) => this.note(pitchFor(l), i * 0.055, 0.5, 0.85));
  }

  /** A chapter's levels played as one piece. */
  suite(melodies: number[][]): void {
    let t = 0;
    for (const m of melodies) {
      m.forEach((l, i) => this.note(pitchFor(l), t + i * 0.07, 0.45, 0.7));
      t += m.length * 0.07 + 0.25;
    }
  }

  /** A soft descending pair for a wrong loop. Never harsh. */
  miss(): void {
    this.note(220, 0, 0.22, 0.5);
    this.note(174.61, 0.09, 0.32, 0.45);
  }

  win(): void {
    [0, 4, 7, 12].forEach((s, i) => this.note(BASE_HZ * 2 * Math.pow(2, s / 12), i * 0.07, 0.6, 0.9));
  }

  /** Tapping the home-screen wordmark plays a pluck. */
  pluckIdle(): void {
    this.note(pitchFor(48), 0, 0.7, 0.6);
  }
}

export const audio = new Audio();
