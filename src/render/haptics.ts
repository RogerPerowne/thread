/**
 * Haptics. On a phone a short tick under the thumb is worth more than any
 * amount of animation — it is what makes a peg feel like it clicked into
 * place rather than like a picture changed.
 *
 * Silent and harmless everywhere it is not supported, and switched off
 * entirely under reduced motion, since the setting is about sensory load as
 * much as about movement.
 */

let enabled = true;

export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}

function buzz(pattern: number | number[]): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported, or blocked; a tick is never worth an exception */
  }
}

/** A peg joins the loop. */
export const tick = (): void => buzz(8);
/** A move was refused. */
export const bump = (): void => buzz([14, 30, 14]);
/** The loop tied off. */
export const tie = (): void => buzz([10, 24, 18]);
/** Solved. */
export const win = (): void => buzz([12, 28, 12, 28, 26]);
/** A wrong loop. */
export const miss = (): void => buzz(26);
/** A rail peg dropped into a notch. */
export const notch = (): void => buzz(6);
