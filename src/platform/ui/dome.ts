/**
 * A UV hemisphere, as a mesh.
 *
 * Rings of latitude from the ground to the crown, segments of longitude round
 * each, every vertex made once and shared by every face that touches it. That
 * last part is the whole point of a mesh rather than a list of polygons: two
 * faces that share an edge share the two vertices that edge runs between, so
 * when they are projected they land on the same two points, exactly, and the
 * dome has no seams that are only nearly closed.
 *
 * Vertices are laid out ring by ring from the ground up, `segs` to a ring,
 * with the apex last. A face between two rings is a quad; a face touching the
 * apex is a triangle. Faces are listed with the corners running the same way
 * round every time, so a normal can be taken from any three of them — though
 * on a sphere the normal at a face is simply the direction of its middle, and
 * that is what the renderer uses.
 *
 * The frame is the dome's own: `x` and `y` on the ground, `z` up, the apex at
 * (0, 0, R). Segment zero is turned so that a FACE, not a seam, is centred on
 * the -y direction — which is where a road runs in.
 */

export type Vec3 = readonly [number, number, number];

export type DomeFace = {
  /** Indices into `verts`, in order round the face. */
  readonly idx: readonly number[];
  /** The ring the face stands on, 0 at the ground. */
  readonly ring: number;
  /** The segment, 0 .. segs - 1, counted from the front. */
  readonly seg: number;
  /** Unit normal: the direction of the face's middle from the centre. */
  readonly normal: Vec3;
};

export type Dome = {
  readonly verts: readonly Vec3[];
  readonly faces: readonly DomeFace[];
  readonly rings: number;
  readonly segs: number;
  readonly radius: number;
};

/** The angle round the dome at which segment `j` begins, front face centred. */
function longitude(j: number, segs: number): number {
  return ((j - 0.5) / segs) * Math.PI * 2 - Math.PI / 2;
}

export function uvDome(rings: number, segs: number, radius = 1): Dome {
  if (rings < 1 || segs < 3) throw new Error(`a dome needs rings and segments: ${rings}, ${segs}`);
  const verts: Vec3[] = [];
  /* Ring i sits at latitude i / rings of the way from the ground to the
     crown; the crown itself is one vertex and not a ring of them. */
  for (let i = 0; i < rings; i++) {
    const phi = (i / rings) * (Math.PI / 2);
    const r = Math.cos(phi) * radius;
    const z = Math.sin(phi) * radius;
    for (let j = 0; j < segs; j++) {
      const theta = longitude(j, segs);
      verts.push([Math.cos(theta) * r, Math.sin(theta) * r, z]);
    }
  }
  const apex = verts.length;
  verts.push([0, 0, radius]);

  const at = (i: number, j: number): number => i * segs + ((j % segs) + segs) % segs;
  const faces: DomeFace[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const idx = i === rings - 1
        ? [at(i, j), at(i, j + 1), apex]
        : [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)];
      const mid = idx.reduce<[number, number, number]>(
        (m, k) => [m[0] + verts[k][0], m[1] + verts[k][1], m[2] + verts[k][2]], [0, 0, 0],
      );
      const len = Math.hypot(mid[0], mid[1], mid[2]) || 1;
      faces.push({ idx, ring: i, seg: j, normal: [mid[0] / len, mid[1] / len, mid[2] / len] });
    }
  }
  return { verts, faces, rings, segs, radius };
}

/**
 * Every edge of the mesh, as a pair of vertex indices, with how many faces
 * use it. On a closed surface every edge is used by exactly two faces; on a
 * hemisphere the edges round the ground are used by one. This is what the
 * test holds the mesh to, and it is the definition of "the edges match up".
 */
export function edgeUse(dome: Dome): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of dome.faces) {
    for (let k = 0; k < f.idx.length; k++) {
      const a = f.idx[k];
      const b = f.idx[(k + 1) % f.idx.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}
