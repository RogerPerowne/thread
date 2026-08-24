/**
 * Input interpretation. There is no Tie off button; closing is part of the
 * gesture, and this file is the whole of that decision.
 *
 * Two rules, both button-free:
 *   - drag-and-release: a drag that moved past threshold and added at least one
 *     peg, with 3+ pegs on the path, ties the loop when you lift your finger;
 *   - tap mode: tapping the peg you are currently on ties the loop. On levels
 *     where the string may not cross itself, returning to the START peg ties it
 *     too, because that is the instinctive gesture.
 *
 * The ambiguity that matters: on crossing levels the solution often revisits
 * the start peg mid-loop — that is how a keyhole is cut — so start-peg-tap must
 * NOT auto-close there. Double-tap on the loose end is the universal fallback
 * and works on every level.
 *
 * This machine is pure: it reads state and returns actions. Pointer handlers
 * never draw, and the DOM is nowhere in this file.
 */

import type { Pt } from '../core/geometry.js';
import { dist } from '../core/geometry.js';
import type { Level } from '../core/level.js';
import { canAdd, canClose, startTapCloses, type PlayState, type Reject } from '../core/rules.js';

/** Board units the pointer must travel before a press counts as a drag. */
export const DRAG_THRESHOLD = 2.2;
/** After an auto-close, touching the loose end re-opens it for this long. */
export const REOPEN_GRACE_MS = 500;

export type PointerInput =
  | { type: 'down'; p: Pt; t: number }
  | { type: 'move'; p: Pt; t: number }
  | { type: 'up'; p: Pt; t: number }
  | { type: 'cancel'; t: number }
  /** Keyboard play: Enter/Space on a focused peg. */
  | { type: 'activate'; peg: number; t: number };

export type Action =
  | { type: 'add'; peg: number }
  | { type: 'retract' }
  | { type: 'close'; via: 'release' | 'tap' | 'start-peg' | 'key' }
  | { type: 'reopen' }
  | { type: 'reject'; peg: number; reason: Reject }
  | { type: 'cursor'; p: Pt | null }
  /** A rail peg is being slid along its rail. */
  | { type: 'slide'; peg: number; p: Pt };

export type GestureCtx = {
  level: Level;
  state: PlayState;
  /** Nearest peg to a board point within the hit radius, or -1. */
  pegAt(p: Pt): number;
  /** When the active loop was auto-closed, for the grace period. */
  closedAt: number;
};

export class GestureMachine {
  private down = false;
  private downAt = 0;
  private downPoint: Pt = [0, 0];
  private movedPastThreshold = false;
  private addedWhileDown = 0;
  private slidingRail = -1;

  /** True while the player is mid-drag — the UI dims the target a little. */
  get dragging(): boolean {
    return this.down && this.movedPastThreshold;
  }

  reset(): void {
    this.down = false;
    this.movedPastThreshold = false;
    this.addedWhileDown = 0;
    this.slidingRail = -1;
  }

  handle(input: PointerInput, ctx: GestureCtx): Action[] {
    switch (input.type) {
      case 'down': return this.onDown(input.p, input.t, ctx);
      case 'move': return this.onMove(input.p, ctx);
      case 'up': return this.onUp(input.t, ctx);
      case 'cancel': this.reset(); return [{ type: 'cursor', p: null }];
      case 'activate': return this.onActivate(input.peg, input.t, ctx);
    }
  }

  private active(ctx: GestureCtx) {
    return ctx.state.threads[ctx.state.active];
  }

  private onDown(p: Pt, t: number, ctx: GestureCtx): Action[] {
    this.down = true;
    this.downAt = t;
    this.downPoint = p;
    this.movedPastThreshold = false;
    this.addedWhileDown = 0;
    this.slidingRail = -1;

    const peg = ctx.pegAt(p);
    if (peg < 0) return [{ type: 'cursor', p }];

    const st = this.active(ctx);

    // Grace: an accidental lift must not be punished. Touching the loose end
    // shortly after an auto-close re-opens the loop and costs no undo.
    if (st.closed) {
      const loose = st.pegs[st.pegs.length - 1];
      if (peg === loose && t - ctx.closedAt <= REOPEN_GRACE_MS) {
        return [{ type: 'reopen' }, { type: 'cursor', p }];
      }
      return [];
    }

    // A peg sitting on a rail can be slid before the string reaches it.
    const rail = ctx.level.rails?.find((r) => r.peg === peg);
    if (rail && !st.pegs.includes(peg)) {
      this.slidingRail = peg;
      return [{ type: 'cursor', p }];
    }

    return [...this.press(peg, t, ctx), { type: 'cursor', p }];
  }

  /** The decision shared by pointer-down and keyboard activation. */
  private press(peg: number, t: number, ctx: GestureCtx): Action[] {
    void t;
    const st = this.active(ctx);
    const n = st.pegs.length;

    if (n === 0) {
      this.addedWhileDown++;
      return [{ type: 'add', peg }];
    }

    const loose = st.pegs[n - 1];
    // Tap the peg you are already on: tie the loop. Works on every level.
    if (peg === loose) {
      const v = canClose(ctx.level, ctx.state);
      if (v.ok) return [{ type: 'close', via: 'tap' }];
      return [{ type: 'reject', peg, reason: v.reason }];
    }

    // Return to the start peg: the instinctive close, but only where the
    // string may not cross itself. On crossing levels this is a legal move.
    if (peg === st.pegs[0] && n >= 3 && startTapCloses(ctx.level)) {
      const v = canClose(ctx.level, ctx.state);
      if (v.ok) return [{ type: 'close', via: 'start-peg' }];
      return [{ type: 'reject', peg, reason: v.reason }];
    }

    // Pulling back onto the previous peg retracts the last segment. Going
    // straight back is never a legal move anyway, so this is unambiguous.
    if (n >= 2 && peg === st.pegs[n - 2]) return [{ type: 'retract' }];

    const v = canAdd(ctx.level, ctx.state, peg);
    if (!v.ok) return [{ type: 'reject', peg, reason: v.reason }];
    this.addedWhileDown++;
    return [{ type: 'add', peg }];
  }

  private onMove(p: Pt, ctx: GestureCtx): Action[] {
    if (!this.down) return [];
    if (!this.movedPastThreshold && dist(p, this.downPoint) > DRAG_THRESHOLD) {
      this.movedPastThreshold = true;
    }

    if (this.slidingRail >= 0) {
      return [{ type: 'slide', peg: this.slidingRail, p }];
    }

    const out: Action[] = [{ type: 'cursor', p }];
    if (!this.movedPastThreshold) return out;

    const st = this.active(ctx);
    if (st.closed) return out;

    const peg = ctx.pegAt(p);
    if (peg < 0) return out;
    const n = st.pegs.length;
    // Sweeping all the way round and back onto the start peg is the same
    // gesture as tapping it, and must tie the loop rather than stall.
    if (peg === st.pegs[0] && n >= 3 && startTapCloses(ctx.level)) {
      if (canClose(ctx.level, ctx.state).ok) {
        out.unshift({ type: 'close', via: 'start-peg' });
        return out;
      }
    }
    if (n === 0) {
      this.addedWhileDown++;
      out.unshift({ type: 'add', peg });
      return out;
    }
    if (peg === st.pegs[n - 1]) return out; // already there
    if (n >= 2 && peg === st.pegs[n - 2]) {
      out.unshift({ type: 'retract' });
      return out;
    }
    const v = canAdd(ctx.level, ctx.state, peg);
    if (!v.ok) {
      // Dragging over an illegal peg should feel like resistance, not an error.
      if (v.reason === 'thorn-peg' || v.reason === 'thorn-contact') {
        out.unshift({ type: 'reject', peg, reason: v.reason });
      }
      return out;
    }
    this.addedWhileDown++;
    out.unshift({ type: 'add', peg });
    return out;
  }

  private onUp(t: number, ctx: GestureCtx): Action[] {
    const wasDrag = this.movedPastThreshold;
    const added = this.addedWhileDown;
    const wasSliding = this.slidingRail >= 0;
    this.down = false;
    this.movedPastThreshold = false;
    this.addedWhileDown = 0;
    this.slidingRail = -1;
    void this.downAt;
    void t;

    const out: Action[] = [{ type: 'cursor', p: null }];
    if (wasSliding) return out;

    const st = this.active(ctx);
    if (st.closed) return out;

    // Lifting your finger after a real drag ties the loop.
    if (wasDrag && added >= 1 && st.pegs.length >= 3) {
      if (canClose(ctx.level, ctx.state).ok) {
        out.unshift({ type: 'close', via: 'release' });
      }
    }
    return out;
  }

  /** Keyboard play routes through exactly the same decision as a tap. */
  private onActivate(peg: number, t: number, ctx: GestureCtx): Action[] {
    const st = this.active(ctx);
    if (st.closed) {
      const loose = st.pegs[st.pegs.length - 1];
      if (peg === loose && t - ctx.closedAt <= REOPEN_GRACE_MS) return [{ type: 'reopen' }];
      return [];
    }
    const actions = this.press(peg, t, ctx);
    return actions.map((a) => (a.type === 'close' ? { type: 'close', via: 'key' as const } : a));
  }
}

/** Project a point onto a rail segment — used while sliding a rail peg. */
export function projectOnRail(p: Pt, a: Pt, b: Pt): Pt {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-9) return a;
  let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + t * vx, a[1] + t * vy];
}
