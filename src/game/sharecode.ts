/**
 * Share codes. A level compresses to a short base64url string that carries the
 * whole puzzle, so a friend can play a Workshop level from a link with no
 * account, no server and no upload. The Workshop runs the gate client-side
 * before producing a code, so a shared level is guaranteed solvable.
 */

import type { Level, Mode } from '../core/level.js';
import { validateLevel } from '../core/level.js';

const VERSION = 1;

const F_CROSS = 1 << 0;
const F_APART = 1 << 1;
const F_WEAVE = 1 << 2;
const F_FOG = 1 << 3;
const F_MIRROR_X = 1 << 4;
const F_MIRROR_Y = 1 << 5;
const F_BUDGET = 1 << 6;
const F_EXTRAS = 1 << 7;

const T_POSTS = 1;
const T_GOLD = 2;
const T_THORN = 3;
const T_PORTALS = 4;
const T_RAILS = 5;
const T_ROTATE = 6;
const T_THREADS = 7;

export class ShareCodeError extends Error {}

/** Board coordinates are stored at half-unit precision: 0..100 -> 0..200. */
const enc = (v: number) => Math.max(0, Math.min(200, Math.round(v * 2)));
const dec = (b: number) => b / 2;

export function encodeLevel(level: Level): string {
  /*
   * The format carries a board and a solution, which is everything a shape
   * level is. It has no room for an objective or for wires, and the Workshop
   * cannot author either — so rather than let a corral quietly decode as a
   * shape level with a target derived from its fence, refuse outright.
   */
  if (level.objective && level.objective.kind !== 'shape') {
    throw new ShareCodeError(`a ${level.objective.kind} level cannot be shared as a code`);
  }
  if (level.wires?.length) throw new ShareCodeError('a wired board cannot be shared as a code');

  const out: number[] = [];
  out.push(VERSION);

  let flags = 0;
  if (level.allowCross) flags |= F_CROSS;
  if (level.apart) flags |= F_APART;
  if (level.weave) flags |= F_WEAVE;
  if (level.fog) flags |= F_FOG;
  if (level.mirror === 'x') flags |= F_MIRROR_X;
  if (level.mirror === 'y') flags |= F_MIRROR_Y;
  if (level.budget !== undefined) flags |= F_BUDGET;
  const hasExtras =
    !!level.posts?.length || !!level.gold?.length || !!level.thorn?.length ||
    !!level.portals?.length || !!level.rails?.length || !!level.rotateTarget ||
    level.threads.length > 1;
  if (hasExtras) flags |= F_EXTRAS;
  out.push(flags);

  out.push(level.pegs.length);
  for (const [x, y] of level.pegs) out.push(enc(x), enc(y));

  const sol = level.threads[0].sol;
  out.push(sol.length);
  for (const p of sol) out.push(p);

  if (level.budget !== undefined) {
    const b = Math.round(level.budget * 2);
    out.push((b >> 8) & 0xff, b & 0xff);
  }

  if (hasExtras) {
    if (level.posts?.length) {
      out.push(T_POSTS, level.posts.length);
      for (const [x, y, r] of level.posts) out.push(enc(x), enc(y), enc(r));
    }
    if (level.gold?.length) {
      out.push(T_GOLD, level.gold.length, ...level.gold);
    }
    if (level.thorn?.length) {
      out.push(T_THORN, level.thorn.length, ...level.thorn);
    }
    if (level.portals?.length) {
      out.push(T_PORTALS, level.portals.length);
      for (const [a, b] of level.portals) out.push(a, b);
    }
    if (level.rails?.length) {
      out.push(T_RAILS, level.rails.length);
      for (const r of level.rails) out.push(r.peg, enc(r.a[0]), enc(r.a[1]), enc(r.b[0]), enc(r.b[1]));
    }
    if (level.rotateTarget) {
      out.push(T_ROTATE, 1, level.rotateTarget / 90);
    }
    if (level.threads.length > 1) {
      out.push(T_THREADS, level.threads.length - 1);
      for (let t = 1; t < level.threads.length; t++) {
        const s = level.threads[t].sol;
        out.push(s.length, ...s);
      }
    }
    out.push(0); // end of extras
  }

  return toBase64Url(Uint8Array.from(out));
}


export function decodeLevel(code: string, id = 'shared', mode: Mode = 'classic'): Level {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(code.trim());
  } catch {
    throw new ShareCodeError('That code is not readable');
  }
  let i = 0;
  const take = (): number => {
    if (i >= bytes.length) throw new ShareCodeError('That code is incomplete');
    return bytes[i++];
  };

  const version = take();
  if (version !== VERSION) throw new ShareCodeError(`Unknown code version ${version}`);
  const flags = take();
  const pegCount = take();
  if (pegCount < 3) throw new ShareCodeError('That code has too few pegs');
  const pegs: [number, number][] = [];
  for (let p = 0; p < pegCount; p++) pegs.push([dec(take()), dec(take())]);

  const solLen = take();
  const sol: number[] = [];
  for (let k = 0; k < solLen; k++) sol.push(take());

  const level: Level = {
    id,
    mode,
    chapter: 0,
    pegs,
    threads: [{ color: '#7A4FBF', sol }],
  };
  if (flags & F_CROSS) level.allowCross = true;
  if (flags & F_APART) level.apart = true;
  if (flags & F_WEAVE) level.weave = true;
  if (flags & F_FOG) level.fog = true;
  if (flags & F_MIRROR_X) level.mirror = 'x';
  if (flags & F_MIRROR_Y) level.mirror = 'y';
  if (flags & F_BUDGET) level.budget = ((take() << 8) | take()) / 2;

  if (flags & F_EXTRAS) {
    const palette = ['#7A4FBF', '#D98324', '#1F8A8A', '#C0392B'];
    for (;;) {
      const tag = take();
      if (tag === 0) break;
      const n = take();
      if (tag === T_POSTS) {
        level.posts = [];
        for (let k = 0; k < n; k++) level.posts.push([dec(take()), dec(take()), dec(take())]);
      } else if (tag === T_GOLD) {
        level.gold = [];
        for (let k = 0; k < n; k++) level.gold.push(take());
      } else if (tag === T_THORN) {
        level.thorn = [];
        for (let k = 0; k < n; k++) level.thorn.push(take());
      } else if (tag === T_PORTALS) {
        level.portals = [];
        for (let k = 0; k < n; k++) level.portals.push([take(), take()]);
      } else if (tag === T_RAILS) {
        level.rails = [];
        for (let k = 0; k < n; k++) {
          level.rails.push({
            peg: take(),
            a: [dec(take()), dec(take())],
            b: [dec(take()), dec(take())],
          });
        }
      } else if (tag === T_ROTATE) {
        const q = take();
        level.rotateTarget = ((q % 4) * 90) as 0 | 90 | 180 | 270;
      } else if (tag === T_THREADS) {
        for (let t = 0; t < n; t++) {
          const len = take();
          const s: number[] = [];
          for (let k = 0; k < len; k++) s.push(take());
          level.threads.push({ color: palette[(t + 1) % palette.length], sol: s });
        }
      } else {
        throw new ShareCodeError('That code uses a feature this version does not know');
      }
    }
  }

  // Runtime validation, so a hand-edited or truncated code fails loudly here
  // rather than half-loading a broken board.
  return validateLevel(level);
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): Uint8Array {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === 'function') {
    const s = atob(pad);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(pad, 'base64'));
}

/** A shareable URL for a level, with the code in the hash so it never hits a server. */
export function shareUrl(code: string): string {
  const base = typeof location !== 'undefined' ? location.href.split('#')[0] : '';
  return `${base}#level=${code}`;
}
