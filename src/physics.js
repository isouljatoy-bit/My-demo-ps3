import * as THREE from 'three';

// Kinematic capsule-ish body (square footprint) moving through axis-aligned colliders.
// Supports auto step-up (stairs/curbs), step-down snapping, ceilings and landing detection.
export class Body {
  constructor(r = 0.35, h = 1.75) {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.r = r;
    this.h = h;
    this.grounded = false;
    this.stepH = 0.5;
    this.stepDown = 0.55;
    this.gravity = 24;
    this.blocked = null;
    this.landSpeed = 0;
    this.stepDelta = 0;
  }
}

const tmp = [];

function axisMove(b, axis, d, col) {
  if (d === 0) return;
  if (axis === 0) b.pos.x += d;
  else b.pos.z += d;
  const r = b.r;
  const q = col.query(b.pos.x - r, b.pos.z - r, b.pos.x + r, b.pos.z + r, tmp);
  const feet = b.pos.y;
  const tol = b.grounded ? b.stepH : 0.3;
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c.y1 <= feet + tol) continue;
    if (c.y0 >= feet + b.h) continue;
    if (axis === 0) {
      if (b.pos.x + r <= c.x0 || b.pos.x - r >= c.x1) continue;
      if (d > 0) b.pos.x = c.x0 - r - 1e-4;
      else b.pos.x = c.x1 + r + 1e-4;
      b.vel.x = 0;
    } else {
      if (b.pos.z + r <= c.z0 || b.pos.z - r >= c.z1) continue;
      if (d > 0) b.pos.z = c.z0 - r - 1e-4;
      else b.pos.z = c.z1 + r + 1e-4;
      b.vel.z = 0;
    }
    b.blocked = c;
  }
}

export function moveBody(b, dt, col) {
  b.blocked = null;
  b.landSpeed = 0;
  b.stepDelta = 0;
  const dx = b.vel.x * dt, dz = b.vel.z * dt;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (b.r * 0.8)));
  for (let i = 0; i < n; i++) {
    axisMove(b, 0, dx / n, col);
    axisMove(b, 2, dz / n, col);
  }

  b.vel.y -= b.gravity * dt;
  if (b.vel.y < -45) b.vel.y = -45;
  const feet = b.pos.y;
  let ny = feet + b.vel.y * dt;
  const fr = b.r * 0.85;

  if (b.vel.y > 0) {
    const q = col.query(b.pos.x - fr, b.pos.z - fr, b.pos.x + fr, b.pos.z + fr, tmp);
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      if (c.y0 >= feet + b.h - 0.05 && c.y0 < ny + b.h) {
        ny = c.y0 - b.h;
        b.vel.y = 0;
      }
    }
  }

  const tol = b.grounded ? b.stepH : 0.3;
  const gh = col.groundHeight(b.pos.x, b.pos.z, fr, feet + tol);
  if (b.vel.y <= 0 && ny <= gh) {
    if (!b.grounded) b.landSpeed = -b.vel.y;
    else if (gh > feet) b.stepDelta = gh - feet;
    ny = gh;
    b.vel.y = 0;
    b.grounded = true;
  } else if (b.grounded && b.vel.y <= 0 && feet - gh <= b.stepDown) {
    b.stepDelta = gh - feet;
    ny = gh;
    b.vel.y = 0;
    b.grounded = true;
  } else {
    b.grounded = false;
  }
  b.pos.y = ny;
}

// True if a vertical span is free of colliders at a footprint.
export function isClear(col, x, z, r, y0, y1) {
  const q = col.query(x - r, z - r, x + r, z + r, tmp);
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c.y0 < y1 && c.y1 > y0) return false;
  }
  return true;
}
