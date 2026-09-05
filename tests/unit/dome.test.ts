import { describe, it, expect } from 'vitest';
import { uvDome, edgeUse } from '../../src/platform/ui/dome.js';

/**
 * The dome at the foot of the path is a UV hemisphere, and this is what that
 * has to mean: every vertex exactly on the sphere, every vertex made once,
 * every edge between two rings shared by exactly two faces and every edge on
 * the ground by one. A dome that passes this cannot have a seam, because a
 * seam is two faces that were given two different copies of the same edge.
 */
describe('the UV dome', () => {
  const dome = uvDome(3, 12, 1.35);

  it('has every vertex on the sphere, and the apex on top', () => {
    for (const v of dome.verts) {
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1.35, 9);
      expect(v[2]).toBeGreaterThanOrEqual(-1e-12);
    }
    expect(dome.verts).toHaveLength(3 * 12 + 1);
    expect(dome.verts[dome.verts.length - 1]).toEqual([0, 0, 1.35]);
  });

  it('shares every edge between exactly two faces, except the ground', () => {
    const use = edgeUse(dome);
    let ground = 0;
    for (const [key, n] of use) {
      const [a, b] = key.split('-').map(Number);
      const onGround = a < 12 && b < 12;
      if (onGround) { ground++; expect(n, `ground edge ${key}`).toBe(1); }
      else expect(n, `edge ${key} is used ${n} times`).toBe(2);
    }
    expect(ground).toBe(12);
    /* Rings of quads and a crown of triangles, and nothing else. */
    expect(dome.faces).toHaveLength(3 * 12);
    expect(dome.faces.filter((f) => f.idx.length === 3)).toHaveLength(12);
  });

  it('centres a face, not a seam, on the front', () => {
    /* The front is -y. The front face of the ground ring straddles it: one
       corner either side, at the same distance. */
    const front = dome.faces.find((f) => f.ring === 0 && f.seg === 0)!;
    const [a, b] = front.idx;
    expect(dome.verts[a][0]).toBeCloseTo(-dome.verts[b][0], 9);
    expect(dome.verts[a][1]).toBeCloseTo(dome.verts[b][1], 9);
    expect(dome.verts[a][1]).toBeLessThan(0);
    expect(front.normal[1]).toBeLessThan(-0.9);
  });

  it('gives every face an outward unit normal', () => {
    for (const f of dome.faces) {
      expect(Math.hypot(...f.normal)).toBeCloseTo(1, 9);
      const mid = f.idx.reduce((m, k) => [m[0] + dome.verts[k][0], m[1] + dome.verts[k][1], m[2] + dome.verts[k][2]], [0, 0, 0]);
      expect(mid[0] * f.normal[0] + mid[1] * f.normal[1] + mid[2] * f.normal[2]).toBeGreaterThan(0);
    }
  });
});
