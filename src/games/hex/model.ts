/**
 * Hexagony: fit the tiles together so every touching pair agrees.
 *
 * Each tile is a hexagon cut into six triangular sectors, and each sector
 * carries a number. Wherever two tiles end up side by side, the sectors that
 * touch have to hold the same number. Every tile goes somewhere and every
 * space gets a tile.
 *
 * Rotation is not allowed. That is the rule the original puzzle is built on
 * and it is what makes the puzzle a puzzle rather than a fiddle: a tile has
 * six values in a fixed order, so the question is only ever WHERE it goes,
 * never which way round — and a tile with a five on its west face can only sit
 * where a five is wanted on the west.
 *
 * The board is a graph of positions, not a shape. It is a list of axial
 * coordinates and the adjacency falls out of them, so a honeycomb, a rhombus
 * and a ragged cluster are all the same engine.
 */

/** Axial coordinates: q across, r down-right. */
export type Cell = readonly [number, number];

/**
 * The six directions, in the order a tile's sectors are written.
 *
 * East first, then anticlockwise. Sector `i` faces direction `i`, and the
 * sector facing back at it from the neighbour is `i + 3` — which is the whole
 * of the matching rule, and the reason nothing here needs a table.
 */
export const DIRS: readonly Cell[] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export const opposite = (dir: number): number => (dir + 3) % 6;

export type Hex = {
  /** Where the spaces are. */
  readonly cells: readonly Cell[];
  /** Six numbers per tile, in direction order. */
  readonly tiles: readonly (readonly number[])[];
  /** Which tile belongs in which space: `answer[position] = tile`. */
  readonly answer: readonly number[];
  /** How many distinct numbers the board draws on. */
  readonly values: number;
};

/** Every touching pair of positions, with the direction from the first. */
export type Join = { readonly a: number; readonly b: number; readonly dir: number };

/**
 * The joins of a board, worked out once.
 *
 * Each pair appears once, from the lower position to the higher, so a rule
 * applied to every join is applied to every touching pair exactly once.
 */
export function joinsOf(hex: Hex): Join[] {
  const index = new Map<string, number>();
  hex.cells.forEach(([q, r], i) => index.set(`${q},${r}`, i));
  const out: Join[] = [];
  hex.cells.forEach(([q, r], a) => {
    DIRS.forEach(([dq, dr], dir) => {
      const b = index.get(`${q + dq},${r + dr}`);
      if (b === undefined || b < a) return;
      out.push({ a, b, dir });
    });
  });
  return out;
}

/** Which positions touch which, as lists of (position, direction). */
export function neighboursOf(hex: Hex): { at: number; dir: number }[][] {
  const out: { at: number; dir: number }[][] = hex.cells.map(() => []);
  for (const j of joinsOf(hex)) {
    out[j.a].push({ at: j.b, dir: j.dir });
    out[j.b].push({ at: j.a, dir: opposite(j.dir) });
  }
  return out;
}

/** Do these two tiles agree across a join in direction `dir`? */
export function agree(
  tiles: Hex['tiles'], a: number, b: number, dir: number,
): boolean {
  return tiles[a][dir] === tiles[b][opposite(dir)];
}

export type Fault = 'clash';

export type Judgement = {
  readonly solved: boolean;
  readonly faults: readonly Fault[];
  readonly progress: number;
  /** Joins where both tiles are down and their numbers differ. */
  readonly clashes: readonly Join[];
  /** Joins where both tiles are down and they agree. */
  readonly agreed: readonly Join[];
};

/**
 * Judge a board. `placed[position]` is a tile, or -1 for an empty space.
 *
 * A clash is only ever reported where BOTH tiles are down. An empty space
 * beside a tile is not a mismatch, it is an empty space — and a board that
 * complains about the tiles you have not laid yet is a board complaining about
 * everything from the first move to the last.
 */
export function judge(hex: Hex, placed: readonly number[]): Judgement {
  const clashes: Join[] = [];
  const agreed: Join[] = [];
  for (const j of joinsOf(hex)) {
    const a = placed[j.a];
    const b = placed[j.b];
    if (a < 0 || b < 0) continue;
    if (agree(hex.tiles, a, b, j.dir)) agreed.push(j);
    else clashes.push(j);
  }
  let down = 0;
  for (const t of placed) if (t >= 0) down++;
  return {
    solved: down === hex.cells.length && clashes.length === 0,
    faults: clashes.length > 0 ? ['clash'] : [],
    progress: hex.cells.length === 0 ? 1 : down / hex.cells.length,
    clashes,
    agreed,
  };
}

export const FAULT_TEXT: Record<Fault, string> = {
  clash: 'Two tiles are touching on numbers that do not match',
};

export function firstFault(j: Judgement): string {
  return j.faults.includes('clash') ? FAULT_TEXT.clash : '';
}

export function whatIsLeft(hex: Hex, j: Judgement): string {
  if (firstFault(j) !== '') return '';
  const total = hex.cells.length;
  const left = total - Math.round(j.progress * total);
  if (left === 0) return '';
  if (left === total) return 'Every tile has a place, and every place a tile';
  return left === 1 ? 'One tile to place' : `${left} tiles to place`;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Where a position's middle sits, for a pointy-top hexagon of circumradius 1.
 *
 * Pointy-top, so the flat sides face east and west and the six neighbours sit
 * at the six directions above. Multiply by the size you want.
 */
export function centreOf([q, r]: Cell): { x: number; y: number } {
  return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
}

/**
 * The angle of sector `i`'s outward normal, in radians, with y pointing down.
 *
 * Direction 0 is east at zero, and each one after it is sixty degrees
 * anticlockwise — which on a screen, where y grows downward, is negative.
 */
export const normalOf = (dir: number): number => (-Math.PI / 3) * dir;

/** The two corners of sector `dir`, at circumradius `r`. */
export function edgeCorners(dir: number, r: number): [number, number][] {
  const a = normalOf(dir);
  const half = Math.PI / 6;
  return [
    [Math.cos(a - half) * r, Math.sin(a - half) * r],
    [Math.cos(a + half) * r, Math.sin(a + half) * r],
  ];
}

/** The whole hexagon, as a path, centred on the origin. */
export function hexPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = normalOf(i) - Math.PI / 6;
    pts.push(`${(Math.cos(a) * r).toFixed(3)} ${(Math.sin(a) * r).toFixed(3)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** One sector, as a path from the middle out to its two corners. */
export function sectorPath(dir: number, r: number): string {
  const [p, q] = edgeCorners(dir, r);
  return `M0 0L${p[0].toFixed(3)} ${p[1].toFixed(3)}L${q[0].toFixed(3)} ${q[1].toFixed(3)}Z`;
}

/** Where a sector's number is written: out along the normal, but not to the edge. */
export function labelSpot(dir: number, r: number): { x: number; y: number } {
  const a = normalOf(dir);
  const d = r * 0.62;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d };
}

/** Does a hint's claim hold in the answer? "cell:3=tile:5", or "cell:3!=tile:5". */
export function claimHolds(hex: Hex, claim: string): boolean {
  const m = /^cell:(\d+)(!?=)tile:(\d+)$/.exec(claim);
  if (!m) return false;
  const at = Number(m[1]);
  const tile = Number(m[3]);
  if (at < 0 || at >= hex.answer.length) return false;
  return m[2] === '=' ? hex.answer[at] === tile : hex.answer[at] !== tile;
}
