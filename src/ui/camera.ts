/**
 * The camera the chapter path is seen through.
 *
 * Everything on that screen lives on a ground plane in (u, v), with a height
 * z above it, and is projected to the screen here. That is the whole reason
 * the view can move: with the geometry authored in ground space rather than
 * baked into diamond arithmetic, tilting the camera up to look straight down
 * at a tile is a change of one number rather than a different drawing.
 *
 * The projection is a standard axonometric one — rotate about the vertical
 * axis by `yaw`, then tilt away from straight-down by `pitch`:
 *
 *     x = (u' - v') * scale
 *     y = (u' + v') * scale * cos(pitch) - z * scale * sin(pitch)
 *
 * where (u', v') is (u, v) turned by `yaw`. At pitch 0 nothing is
 * foreshortened and no height shows: you are directly above. The (u - v),
 * (u + v) pairing is itself a 45 degree turn, so a yaw of -45 degrees cancels
 * it and a ground square lands on the screen upright — which is what lets a
 * tile become a card.
 */

export interface Cam {
  /** Radians from straight down. 0 looks vertically at the ground. */
  pitch: number;
  /** Radians about the vertical axis. */
  yaw: number;
  /** Screen units per ground unit. */
  scale: number;
  /** Where ground (0, 0) lands. */
  ox: number;
  oy: number;
}

/**
 * The reference screenshot's tile is 144 wide and 88 tall, extruded 24. A
 * unit ground square seen at pitch p is `scale` wide and `scale * cos(p)`
 * tall, so the reference pitch falls straight out of that ratio, and the
 * tile's real height out of how far the extrusion travels at it.
 */
export const HALF_W = 72;
export const HALF_H = 44;
export const EXTRUDE_PX = 24;

export const ISO_PITCH = Math.acos(HALF_H / HALF_W);
export const TILE_H = EXTRUDE_PX / (HALF_W * Math.sin(ISO_PITCH));

/** The view the chapter path sits at when nothing is moving. */
export function isoCam(ox = 0, oy = 0): Cam {
  return { pitch: ISO_PITCH, yaw: 0, scale: HALF_W, ox, oy };
}

export type Pt2 = [number, number];

export function project(cam: Cam, u: number, v: number, z = 0): Pt2 {
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  const ru = u * c - v * s;
  const rv = u * s + v * c;
  return [
    cam.ox + (ru - rv) * cam.scale,
    cam.oy + (ru + rv) * cam.scale * Math.cos(cam.pitch) - z * cam.scale * Math.sin(cam.pitch),
  ];
}

/** How far up the screen one unit of height carries at this camera. */
export function lift(cam: Cam): number {
  return cam.scale * Math.sin(cam.pitch);
}

/**
 * Ground coordinates for a point authored in the reference's own screen
 * space. The measurements were taken off a photograph in screen units; this
 * is the one place they are converted, so the rest of the path can be written
 * in ground space and stay true whatever the camera does.
 */
export function groundOf(x: number, y: number): Pt2 {
  const d = x / HALF_W;
  const sum = y / HALF_H;
  return [(d + sum) / 2, (sum - d) / 2];
}

export function lerpCam(a: Cam, b: Cam, t: number): Cam {
  const m = (p: number, q: number) => p + (q - p) * t;
  return {
    pitch: m(a.pitch, b.pitch),
    yaw: m(a.yaw, b.yaw),
    scale: m(a.scale, b.scale),
    ox: m(a.ox, b.ox),
    oy: m(a.oy, b.oy),
  };
}
