import * as THREE from 'three';
import { RNG, clamp, lerp, TAU } from './utils.js';

export const MAP = (() => {
  const N = 4, BLOCK = 56, ROAD = 16, SW = 4, CURB = 0.15;
  const PITCH = BLOCK + ROAD;
  const SIZE = N * PITCH + ROAD;
  return { N, BLOCK, ROAD, SW, CURB, PITCH, SIZE, HALF: SIZE / 2 };
})();

const _c = new THREE.Color();
export const lin = (hex) => {
  _c.set(hex);
  return [_c.r, _c.g, _c.b];
};
const WHITE = [1, 1, 1];

const PASTEL = ['#f2cfc2', '#f5e4c3', '#cde3d3', '#d8d2ec', '#f2c6a0', '#ebe4d6', '#c6dde8', '#f3d3db', '#e9d9a6'];
const BRICK_T = ['#ffffff', '#ead6c8', '#d9c7ba', '#f2e1d1', '#c9b6aa'];
const OFFICE_T = ['#c3dbea', '#acd3cb', '#dccaa8', '#cbd3e3', '#a3bdd4', '#e0e6ea'];
const CONCW_T = ['#ffffff', '#ece3d6', '#dadfe4', '#efe0cc'];
const SIGN = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#8338ec', '#ff006e', '#3a86ff', '#06d6a0', '#fb5607'];
const CAR_C = ['#b3121f', '#0b3954', '#f1f2f4', '#141414', '#6c757d', '#ffb703', '#1f8a70', '#8d99ae', '#5e548e', '#e85d04', '#0077b6', '#d4d4d4', '#7a0019', '#2b2d42'];

// ---------------------------------------------------------------------------
// Collision: axis-aligned boxes in a uniform XZ grid, with DDA raycasting.
// ---------------------------------------------------------------------------
export class Colliders {
  constructor(half, cell = 8) {
    this.cell = cell;
    this.min = -half;
    this.n = Math.ceil((half * 2) / cell);
    this.cells = Array.from({ length: this.n * this.n }, () => []);
    this.list = [];
    this.stamp = 1;
    this._q = [];
  }

  add(x0, y0, z0, x1, y1, z1, surf = 'concrete') {
    const c = {
      x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1),
      x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1),
      surf, s: 0,
    };
    this.list.push(c);
    const n = this.n;
    const ia = clamp(Math.floor((c.x0 - this.min) / this.cell), 0, n - 1);
    const ib = clamp(Math.floor((c.x1 - this.min) / this.cell), 0, n - 1);
    const ja = clamp(Math.floor((c.z0 - this.min) / this.cell), 0, n - 1);
    const jb = clamp(Math.floor((c.z1 - this.min) / this.cell), 0, n - 1);
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) this.cells[j * n + i].push(c);
    return c;
  }

  query(x0, z0, x1, z1, out) {
    out.length = 0;
    const s = ++this.stamp;
    const n = this.n;
    const ia = clamp(Math.floor((x0 - this.min) / this.cell), 0, n - 1);
    const ib = clamp(Math.floor((x1 - this.min) / this.cell), 0, n - 1);
    const ja = clamp(Math.floor((z0 - this.min) / this.cell), 0, n - 1);
    const jb = clamp(Math.floor((z1 - this.min) / this.cell), 0, n - 1);
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const arr = this.cells[j * n + i];
        for (let k = 0; k < arr.length; k++) {
          const c = arr[k];
          if (c.s === s) continue;
          c.s = s;
          if (c.x1 > x0 && c.x0 < x1 && c.z1 > z0 && c.z0 < z1) out.push(c);
        }
      }
    }
    return out;
  }

  // Highest collider top at or below maxTop under a square footprint. Base ground is y=0.
  groundHeight(x, z, r, maxTop) {
    const q = this.query(x - r, z - r, x + r, z + r, this._q);
    let g = 0;
    for (let i = 0; i < q.length; i++) {
      const t = q[i].y1;
      if (t <= maxTop && t > g) g = t;
    }
    return g;
  }

  surfaceAt(x, z, y) {
    const q = this.query(x - 0.2, z - 0.2, x + 0.2, z + 0.2, this._q);
    for (let i = 0; i < q.length; i++) if (Math.abs(q[i].y1 - y) < 0.05) return q[i].surf;
    return 'concrete';
  }

  // Ray (unit dir) vs boxes. Fills hit {t, nx, ny, nz, c}. Ignores boxes containing the origin.
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    const cell = this.cell, n = this.n, mn = this.min, mx = mn + n * cell;
    let t0 = 0, t1 = maxT;
    if (Math.abs(dx) < 1e-9) {
      if (ox < mn || ox > mx) return false;
    } else {
      let a = (mn - ox) / dx, b = (mx - ox) / dx;
      if (a > b) { const q = a; a = b; b = q; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < mn || oz > mx) return false;
    } else {
      let a = (mn - oz) / dz, b = (mx - oz) / dz;
      if (a > b) { const q = a; a = b; b = q; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    if (t0 > t1) return false;
    const s = ++this.stamp;
    let best = maxT, found = null, bnx = 0, bny = 0, bnz = 0;
    const px = ox + dx * t0, pz = oz + dz * t0;
    let ix = clamp(Math.floor((px - mn) / cell), 0, n - 1);
    let iz = clamp(Math.floor((pz - mn) / cell), 0, n - 1);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) < 1e-9 ? Infinity : cell / Math.abs(dx);
    const tdz = Math.abs(dz) < 1e-9 ? Infinity : cell / Math.abs(dz);
    let tmx = Math.abs(dx) < 1e-9 ? Infinity : (mn + (ix + (dx > 0 ? 1 : 0)) * cell - ox) / dx;
    let tmz = Math.abs(dz) < 1e-9 ? Infinity : (mn + (iz + (dz > 0 ? 1 : 0)) * cell - oz) / dz;
    for (let iter = 0; iter < n * 2 + 4; iter++) {
      const arr = this.cells[iz * n + ix];
      for (let k = 0; k < arr.length; k++) {
        const c = arr[k];
        if (c.s === s) continue;
        c.s = s;
        const t = rayBox(ox, oy, oz, dx, dy, dz, c);
        if (t >= 0 && t < best) {
          best = t;
          found = c;
          bnx = RB.nx; bny = RB.ny; bnz = RB.nz;
        }
      }
      const tExit = Math.min(tmx, tmz);
      if (best <= tExit || tExit > t1) break;
      if (tmx < tmz) {
        ix += sx;
        tmx += tdx;
        if (ix < 0 || ix >= n) break;
      } else {
        iz += sz;
        tmz += tdz;
        if (iz < 0 || iz >= n) break;
      }
    }
    if (!found) return false;
    hit.t = best;
    hit.nx = bnx; hit.ny = bny; hit.nz = bnz;
    hit.c = found;
    return true;
  }
}

const RB = { nx: 0, ny: 0, nz: 0 };
export function rayBox(ox, oy, oz, dx, dy, dz, c) {
  let tmin = -Infinity, tmax = Infinity, nx = 0, ny = 0, nz = 0;
  if (Math.abs(dx) < 1e-12) {
    if (ox < c.x0 || ox > c.x1) return -1;
  } else {
    const inv = 1 / dx;
    let a = (c.x0 - ox) * inv, b = (c.x1 - ox) * inv, sg = -1;
    if (a > b) { const q = a; a = b; b = q; sg = 1; }
    if (a > tmin) { tmin = a; nx = sg; ny = 0; nz = 0; }
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < c.y0 || oy > c.y1) return -1;
  } else {
    const inv = 1 / dy;
    let a = (c.y0 - oy) * inv, b = (c.y1 - oy) * inv, sg = -1;
    if (a > b) { const q = a; a = b; b = q; sg = 1; }
    if (a > tmin) { tmin = a; nx = 0; ny = sg; nz = 0; }
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < c.z0 || oz > c.z1) return -1;
  } else {
    const inv = 1 / dz;
    let a = (c.z0 - oz) * inv, b = (c.z1 - oz) * inv, sg = -1;
    if (a > b) { const q = a; a = b; b = q; sg = 1; }
    if (a > tmin) { tmin = a; nx = 0; ny = 0; nz = sg; }
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0 || tmin < 0) return -1;
  RB.nx = nx; RB.ny = ny; RB.nz = nz;
  return tmin;
}

// ---------------------------------------------------------------------------
// Geometry batching: everything static is merged per (material, chunk).
// ---------------------------------------------------------------------------
class Bucket {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0;
  }
}

export class GeometryBuilder {
  constructor() { this.buckets = new Map(); }

  key(k, x, z, chunk) {
    const c = chunk || `${Math.floor((x + 420) / 120)}_${Math.floor((z + 420) / 120)}`;
    return k + '|' + c;
  }

  bucket(key) {
    let b = this.buckets.get(key);
    if (!b) { b = new Bucket(); this.buckets.set(key, b); }
    return b;
  }

  _quad(B, a, b, c, d, n, uv, ca, cb, nl) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const s = B.n;
    B.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    if (nl) for (let i = 0; i < 4; i++) B.nor.push(nl[i][0], nl[i][1], nl[i][2]);
    else for (let i = 0; i < 4; i++) B.nor.push(n[0], n[1], n[2]);
    B.uv.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]);
    B.col.push(ca[0], ca[1], ca[2], ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cb[0], cb[1], cb[2]);
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) B.idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
    else B.idx.push(s, s + 2, s + 1, s, s + 3, s + 2);
    B.n += 4;
  }

  _tri(B, a, b, c, n, uv, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const s = B.n;
    B.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) B.nor.push(n[0], n[1], n[2]);
    B.uv.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]);
    for (let i = 0; i < 3; i++) B.col.push(col[0], col[1], col[2]);
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) B.idx.push(s, s + 1, s + 2);
    else B.idx.push(s, s + 2, s + 1);
    B.n += 3;
  }

  // o: side, top, bottom, tile, topTile, color, ao, uvY, worldU, faces ('xXzZYy'), chunk, topColor
  box(x0, y0, z0, x1, y1, z1, o = {}) {
    const faces = o.faces || 'xXzZY';
    const col = o.color || WHITE;
    const ao = o.ao ?? 0.8;
    const bot = [col[0] * ao, col[1] * ao, col[2] * ao];
    const tile = o.tile ?? 2;
    const tw = Array.isArray(tile) ? tile[0] : tile, th = Array.isArray(tile) ? tile[1] : tile;
    const tt = o.topTile ?? tile;
    const ttw = Array.isArray(tt) ? tt[0] : tt, tth = Array.isArray(tt) ? tt[1] : tt;
    const oy = o.uvY ?? y0;
    const v0 = (y0 - oy) / th, v1 = (y1 - oy) / th;
    const wu = o.worldU;
    const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
    if (o.side) {
      const B = this.bucket(this.key(o.side, cxm, czm, o.chunk));
      if (faces.includes('X')) {
        const uL = wu ? -z1 / tw : 0, uR = wu ? -z0 / tw : (z1 - z0) / tw;
        this._quad(B, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [uL, v0, uR, v0, uR, v1, uL, v1], bot, col);
      }
      if (faces.includes('x')) {
        const uL = wu ? z0 / tw : 0, uR = wu ? z1 / tw : (z1 - z0) / tw;
        this._quad(B, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [uL, v0, uR, v0, uR, v1, uL, v1], bot, col);
      }
      if (faces.includes('Z')) {
        const uL = wu ? x0 / tw : 0, uR = wu ? x1 / tw : (x1 - x0) / tw;
        this._quad(B, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [uL, v0, uR, v0, uR, v1, uL, v1], bot, col);
      }
      if (faces.includes('z')) {
        const uL = wu ? -x1 / tw : 0, uR = wu ? -x0 / tw : (x1 - x0) / tw;
        this._quad(B, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [uL, v0, uR, v0, uR, v1, uL, v1], bot, col);
      }
    }
    const top = o.top === undefined ? o.side : o.top;
    if (top && faces.includes('Y')) {
      const B = this.bucket(this.key(top, cxm, czm, o.chunk));
      const tc = o.topColor || col;
      this._quad(B, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0],
        [x0 / ttw, -z1 / tth, x1 / ttw, -z1 / tth, x1 / ttw, -z0 / tth, x0 / ttw, -z0 / tth], tc, tc);
    }
    if (o.bottom && faces.includes('y')) {
      const B = this.bucket(this.key(o.bottom, cxm, czm, o.chunk));
      this._quad(B, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0],
        [x0 / ttw, z0 / tth, x1 / ttw, z0 / tth, x1 / ttw, z1 / tth, x0 / ttw, z1 / tth], bot, bot);
    }
  }

  // Cylinder prism centered on (cx,cy,cz) along an axis.
  prism(k, cx, cy, cz, r, len, seg, axis, color, o = {}) {
    const B = this.bucket(this.key(k, cx, cz, o.chunk));
    const P = (a, u, v) => (axis === 'y' ? [cx + u, cy + a, cz + v] : axis === 'x' ? [cx + a, cy + u, cz + v] : [cx + u, cy + v, cz + a]);
    const N = (a, u, v) => (axis === 'y' ? [u, a, v] : axis === 'x' ? [a, u, v] : [u, v, a]);
    const h = len / 2, ao = o.ao ?? 0.85;
    const ca = [color[0] * ao, color[1] * ao, color[2] * ao];
    const r2 = o.r2 ?? r;
    const tile = o.tile ?? 1;
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * TAU, t1 = ((i + 1) / seg) * TAU, tm = (t0 + t1) / 2;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const u0 = ((i / seg) * TAU * r) / tile, u1 = (((i + 1) / seg) * TAU * r) / tile;
      this._quad(B, P(-h, c0 * r, s0 * r), P(-h, c1 * r, s1 * r), P(h, c1 * r2, s1 * r2), P(h, c0 * r2, s0 * r2),
        N(0, Math.cos(tm), Math.sin(tm)), [u0, 0, u1, 0, u1, len / tile, u0, len / tile], ca, color,
        [N(0, c0, s0), N(0, c1, s1), N(0, c1, s1), N(0, c0, s0)]);
      if (o.caps !== false) {
        this._tri(B, P(h, 0, 0), P(h, c0 * r2, s0 * r2), P(h, c1 * r2, s1 * r2), N(1, 0, 0), [0.5, 0.5, 0.5 + c0 * 0.5, 0.5 + s0 * 0.5, 0.5 + c1 * 0.5, 0.5 + s1 * 0.5], o.capColor || color);
        if (o.bottomCap !== false) this._tri(B, P(-h, 0, 0), P(-h, c1 * r, s1 * r), P(-h, c0 * r, s0 * r), N(-1, 0, 0), [0.5, 0.5, 0.5 + c1 * 0.5, 0.5 + s1 * 0.5, 0.5 + c0 * 0.5, 0.5 + s0 * 0.5], ca);
      }
    }
  }

  // Square beam between two points.
  bar3(k, ax, ay, az, bx, by, bz, w, color, o = {}) {
    const B = this.bucket(this.key(k, (ax + bx) / 2, (az + bz) / 2, o.chunk));
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    let upx = 0, upy = 1, upz = 0;
    if (Math.abs(dy) > 0.95) { upx = 1; upy = 0; }
    let ux = dy * upz - dz * upy, uy = dz * upx - dx * upz, uz = dx * upy - dy * upx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = uy * dz - uz * dy, vy = uz * dx - ux * dz, vz = ux * dy - uy * dx;
    const h = w / 2;
    const corner = (su, sv) => [ux * su * h + vx * sv * h, uy * su * h + vy * sv * h, uz * su * h + vz * sv * h];
    const sides = [
      [[ux, uy, uz], corner(1, -1), corner(1, 1)],
      [[vx, vy, vz], corner(1, 1), corner(-1, 1)],
      [[-ux, -uy, -uz], corner(-1, 1), corner(-1, -1)],
      [[-vx, -vy, -vz], corner(-1, -1), corner(1, -1)],
    ];
    const tile = o.tile ?? 1;
    const ca = o.bottomColor || color;
    for (const [n, p, q] of sides) {
      this._quad(B, [ax + p[0], ay + p[1], az + p[2]], [ax + q[0], ay + q[1], az + q[2]], [bx + q[0], by + q[1], bz + q[2]], [bx + p[0], by + p[1], bz + p[2]],
        n, [0, 0, w / tile, 0, w / tile, L / tile, 0, L / tile], ca, color);
    }
  }

  // Arbitrary quad with automatic triplanar UVs.
  poly4(k, a, b, c, d, nHint, color, tile = 2, o = {}) {
    const B = this.bucket(this.key(k, (a[0] + c[0]) / 2, (a[2] + c[2]) / 2, o.chunk));
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * nHint[0] + ny * nHint[1] + nz * nHint[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const uv = (p) => (ay >= ax && ay >= az ? [p[0] / tile, -p[2] / tile] : ax >= az ? [p[2] / tile, p[1] / tile] : [p[0] / tile, p[1] / tile]);
    const A = uv(a), Bv = uv(b), C = uv(c), D = uv(d);
    this._quad(B, a, b, c, d, [nx, ny, nz], [A[0], A[1], Bv[0], Bv[1], C[0], C[1], D[0], D[1]], o.colorA || color, color);
  }

  tri(k, a, b, c, nHint, color, o = {}) {
    const B = this.bucket(this.key(k, a[0], a[2], o.chunk));
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * nHint[0] + ny * nHint[1] + nz * nHint[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    this._tri(B, a, b, c, [nx, ny, nz], [0, 0, 1, 0, 0.5, 1], color);
  }

  build(mats) {
    const out = [];
    for (const [key, B] of this.buckets) {
      if (B.n === 0) continue;
      const [k, chunk] = key.split('|');
      const m = mats[k];
      if (!m) { console.warn('missing material', k); continue; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
      g.setIndex(B.n > 65535 ? new THREE.Uint32BufferAttribute(B.idx, 1) : new THREE.Uint16BufferAttribute(B.idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = chunk !== 'far' && !m.userData.noCast;
      mesh.receiveShadow = !m.userData.noRecv;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

// ---------------------------------------------------------------------------
// Palm tree geometry (instanced across the whole city).
// ---------------------------------------------------------------------------
function palmGeometries() {
  const H = 8.5, seg = 12, rad = 7;
  const center = (t) => [t * t * 1.4, t * H, 0];
  const pos = [], nor = [], col = [], idx = [];
  const bark = lin('#8a7356'), bark2 = lin('#6b5842');
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const [cx, cy, cz] = center(t);
    const r = lerp(0.27, 0.16, t);
    const c = i % 2 ? bark2 : bark;
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * TAU;
      const nx = Math.cos(a), nz = Math.sin(a);
      pos.push(cx + nx * r, cy, cz + nz * r);
      nor.push(nx, 0.15, nz);
      col.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j, b = a + rad + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  trunk.setIndex(idx);
  trunk.computeBoundingSphere();

  const top = center(1);
  const cp = [], cn = [], cu = [], ci = [];
  const fronds = 12, steps = 5, L = 3.8;
  let v = 0;
  for (let f = 0; f < fronds; f++) {
    const ang = (f / fronds) * TAU + (f % 3) * 0.21;
    const elev = f % 4 === 0 ? 0.55 : 0.12;
    const droop = f % 4 === 0 ? 1.0 : 2.1;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const px = -dz, pz = dx;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const w = 1.25 * (1 - 0.35 * t) * Math.min(1, 0.35 + t * 3);
      const x = top[0] + dx * L * t;
      const y = top[1] + elev * L * t - droop * t * t;
      const z = top[2] + dz * L * t;
      cp.push(x - px * w / 2, y, z - pz * w / 2, x + px * w / 2, y, z + pz * w / 2);
      cn.push(0, 1, 0, 0, 1, 0);
      cu.push(0, t, 1, t);
      if (s < steps) {
        const a = v + s * 2;
        ci.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    v += (steps + 1) * 2;
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  crown.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
  crown.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
  crown.setIndex(ci);
  crown.computeBoundingSphere();
  return { trunk, crown };
}

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------
export class World {
  constructor(scene, tex, envMap) {
    this.scene = scene;
    this.tex = tex;
    this.col = new Colliders(MAP.HALF + 60, 8);
    this.gb = new GeometryBuilder();
    this.roofSpots = [];
    this.pickupSpots = [];
    this.mapRects = [];
    this.palms = [];
    this.parapets = [];
    this.spawn = { x: 0, y: 0, z: 0, yaw: 0 };
    this.meshes = [];

    const L = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra });
    const noCast = (m) => { m.userData.noCast = true; return m; };
    this.mats = {
      asphalt: noCast(L(tex.asphalt)),
      sidewalk: L(tex.sidewalk),
      conc: L(tex.conc),
      roof: L(tex.roof),
      grass: L(tex.grass),
      paver: L(tex.paver),
      metal: L(tex.metal),
      wood: L(tex.wood),
      brick: L(tex.brick),
      stucco: L(tex.stucco),
      office: L(tex.office),
      concw: L(tex.concw),
      store: L(tex.store),
      paint: L(null),
      lines: noCast(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      glow: noCast(new THREE.MeshBasicMaterial({ vertexColors: true })),
      carpaint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.4, envMap, envMapIntensity: 1.0 }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.7, envMap, envMapIntensity: 1.5 }),
      ad0: L(tex.ads[0], { emissive: 0xffffff, emissiveMap: tex.ads[0], emissiveIntensity: 0.35 }),
      ad1: L(tex.ads[1], { emissive: 0xffffff, emissiveMap: tex.ads[1], emissiveIntensity: 0.35 }),
      ad2: L(tex.ads[2], { emissive: 0xffffff, emissiveMap: tex.ads[2], emissiveIntensity: 0.35 }),
    };
  }

  // Geometry + collider in one call.
  B(x0, y0, z0, x1, y1, z1, o = {}) {
    if (o.side || o.top) this.gb.box(x0, y0, z0, x1, y1, z1, o);
    if (o.collide !== false) this.col.add(x0, y0, z0, x1, y1, z1, o.surf || surfOf(o.side || o.top));
  }

  flat(x0, z0, x1, z1, y, color) {
    this.gb.box(x0, y - 0.01, z0, x1, y, z1, { top: 'lines', faces: 'Y', color });
  }

  mapRect(x0, z0, x1, z1, color, h) { this.mapRects.push({ x0, z0, x1, z1, color, h }); }

  inset(L, m) { return { x0: L.x0 + m, z0: L.z0 + m, x1: L.x1 - m, z1: L.z1 - m }; }

  cut(b, side, d) {
    if (side === 'X') b.x1 -= d;
    else if (side === 'x') b.x0 += d;
    else if (side === 'Z') b.z1 -= d;
    else if (side === 'z') b.z0 += d;
    return b;
  }

  generate(seed = 7) {
    this.rng = new RNG(seed);
    const { N, HALF, ROAD, PITCH } = MAP;
    this.ground();
    this.roadMarkings();
    const layout = [
      ['mixed', 'mixed', 'tower', 'mixed'],
      ['mixed', 'plaza', 'garage', 'mixed'],
      ['tower', 'park', 'mixed', 'mixed'],
      ['mixed', 'mixed', 'mixed', 'tower'],
    ];
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const bx0 = -HALF + ROAD + ix * PITCH, bz0 = -HALF + ROAD + iz * PITCH;
        this.blockBase(bx0, bz0);
        const t = layout[iz][ix];
        if (t === 'plaza') this.plaza(bx0, bz0);
        else if (t === 'garage') this.garage(bx0, bz0);
        else if (t === 'park') this.park(bx0, bz0);
        else this.mixed(bx0, bz0, t === 'tower');
        this.streetProps(bx0, bz0);
      }
    }
    this.boundary();
    this.skyline();
    this.build();
  }

  // ---------- Ground & roads ----------
  ground() {
    const E = MAP.HALF + 460;
    this.gb.box(-E, -1, -E, E, 0, E, { top: 'asphalt', faces: 'Y', topTile: 8, chunk: 'ground' });
  }

  roadMarkings() {
    const { N, HALF, ROAD, PITCH, BLOCK } = MAP;
    const Y = 0.014;
    const yellow = lin('#e8b730'), white = lin('#e9e7e1');
    for (let i = 0; i <= N; i++) {
      const c = -HALF + ROAD / 2 + i * PITCH;
      for (let j = 0; j < N; j++) {
        const s0 = -HALF + ROAD + j * PITCH, s1 = s0 + BLOCK;
        // Road running along Z at x = c.
        this.flat(c - 0.24, s0 + 3.6, c - 0.1, s1 - 3.6, Y, yellow);
        this.flat(c + 0.1, s0 + 3.6, c + 0.24, s1 - 3.6, Y, yellow);
        for (let s = s0 + 5; s < s1 - 6; s += 9) {
          this.flat(c - 4.1, s, c - 3.95, s + 3, Y, white);
          this.flat(c + 3.95, s, c + 4.1, s + 3, Y, white);
        }
        // Road running along X at z = c.
        this.flat(s0 + 3.6, c - 0.24, s1 - 3.6, c - 0.1, Y, yellow);
        this.flat(s0 + 3.6, c + 0.1, s1 - 3.6, c + 0.24, Y, yellow);
        for (let s = s0 + 5; s < s1 - 6; s += 9) {
          this.flat(s, c - 4.1, s + 3, c - 3.95, Y, white);
          this.flat(s, c + 3.95, s + 3, c + 4.1, Y, white);
        }
        // Crosswalks at both ends of each segment.
        for (const s of [s0 + 0.3, s1 - 3.3]) {
          for (let k = c - ROAD / 2 + 1; k < c + ROAD / 2 - 1; k += 1.4) {
            this.flat(k, s, k + 0.7, s + 3, Y, white);
            this.flat(s, k, s + 3, k + 0.7, Y, white);
          }
        }
      }
    }
  }

  blockBase(bx0, bz0) {
    const B = MAP.BLOCK;
    this.B(bx0, 0, bz0, bx0 + B, MAP.CURB, bz0 + B, {
      side: 'conc', top: 'sidewalk', tile: 1, topTile: 3, worldU: true, color: lin('#dcd7cd'), surf: 'concrete',
    });
    this.mapRect(bx0, bz0, bx0 + B, bz0 + B, '#7c7e83', 0);
  }

  // ---------- Building blocks ----------
  mixed(bx0, bz0, towerBias) {
    const r = this.rng, SW = MAP.SW;
    const ix0 = bx0 + SW, iz0 = bz0 + SW, IN = MAP.BLOCK - 2 * SW;
    const AL = 4;
    const wx = r.pick([16, 20, 24, 28]), wz = r.pick([16, 20, 24, 28]);
    const xs = [[ix0, ix0 + wx], [ix0 + wx + AL, ix0 + IN]];
    const zs = [[iz0, iz0 + wz], [iz0 + wz + AL, iz0 + IN]];
    const built = [];
    let accessible = 0;
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        const L = { x0: xs[a][0], x1: xs[a][1], z0: zs[b][0], z1: zs[b][1] };
        const side = r.pick([a === 0 ? 'x' : 'X', b === 0 ? 'z' : 'Z']);
        const roll = r.next();
        let res;
        const lastChance = a === 1 && b === 1 && accessible === 0;
        if (!lastChance && (towerBias ? roll < 0.5 : roll < 0.13)) res = this.tower(L, r.chance(0.5));
        else if (roll < (towerBias ? 0.72 : 0.55) || lastChance) res = this.lowrise(L, side);
        else if (roll < (towerBias ? 0.92 : 0.86)) res = this.midrise(L, side);
        else res = this.parkingLot(L);
        if (res.access) accessible++;
        built.push(res);
      }
    }
    this.bridges(built);
    // Alley clutter: dumpsters and crates for cover.
    const ax = xs[0][1] + AL / 2, az = zs[0][1] + AL / 2;
    this.dumpster(ax, MAP.CURB, iz0 + r.range(3, 10), 'z');
    this.dumpster(ix0 + r.range(3, 10), MAP.CURB, az, 'x');
    if (r.chance(0.6)) this.crateStack(ax + r.range(-0.4, 0.4), iz0 + IN - r.range(3, 8));
  }

  bridges(built) {
    const acc = built.filter((b) => b.access);
    for (let i = 0; i < acc.length; i++) {
      for (let j = 0; j < acc.length; j++) {
        if (i === j) continue;
        const A = acc[i], C = acc[j];
        if (Math.abs(A.top - C.top) > 0.01) continue;
        // A to the -x of C
        if (A.b.x1 < C.b.x0 && C.b.x0 - A.b.x1 <= 10 && A.side !== 'X' && C.side !== 'x') {
          const o0 = Math.max(A.b.z0, C.b.z0) + 1, o1 = Math.min(A.b.z1, C.b.z1) - 1;
          if (o1 - o0 >= 2) {
            const zm = (o0 + o1) / 2;
            this.B(A.b.x1, A.top - 0.22, zm - 0.7, C.b.x0, A.top, zm + 0.7, { side: 'wood', top: 'wood', tile: 1.2, worldU: true, surf: 'wood' });
            A.para.gaps.X = (A.para.gaps.X || []).concat([[zm - 0.8, zm + 0.8]]);
            C.para.gaps.x = (C.para.gaps.x || []).concat([[zm - 0.8, zm + 0.8]]);
          }
        }
        // A to the -z of C
        if (A.b.z1 < C.b.z0 && C.b.z0 - A.b.z1 <= 10 && A.side !== 'Z' && C.side !== 'z') {
          const o0 = Math.max(A.b.x0, C.b.x0) + 1, o1 = Math.min(A.b.x1, C.b.x1) - 1;
          if (o1 - o0 >= 2) {
            const xm = (o0 + o1) / 2;
            this.B(xm - 0.7, A.top - 0.22, A.b.z1, xm + 0.7, A.top, C.b.z0, { side: 'wood', top: 'wood', tile: 1.2, worldU: true, surf: 'wood' });
            A.para.gaps.Z = (A.para.gaps.Z || []).concat([[xm - 0.8, xm + 0.8]]);
            C.para.gaps.z = (C.para.gaps.z || []).concat([[xm - 0.8, xm + 0.8]]);
          }
        }
      }
    }
  }

  shell(b, base, top, fh, kind, color) {
    const e = 0.15, r = this.rng;
    this.gb.box(b.x0 - e, base, b.z0 - e, b.x1 + e, base + fh, b.z1 + e, { side: 'store', top: 'conc', tile: [8, 3.5], color: WHITE, ao: 0.85 });
    this.gb.box(b.x0 - e - 0.12, base + fh - 0.85, b.z0 - e - 0.12, b.x1 + e + 0.12, base + fh - 0.2, b.z1 + e + 0.12,
      { side: 'paint', top: 'paint', bottom: 'paint', color: lin(r.pick(SIGN)), ao: 0.92, faces: 'xXzZYy' });
    this.gb.box(b.x0, base + fh, b.z0, b.x1, top, b.z1, { side: kind, top: 'roof', tile: [8, 7], topTile: 4, color, uvY: base, ao: 0.9 });
    this.gb.box(b.x0 - 0.2, top - 0.4, b.z0 - 0.2, b.x1 + 0.2, top - 0.02, b.z1 + 0.2,
      { side: 'conc', bottom: 'conc', tile: 1, worldU: true, color: lin('#e7e0d3'), faces: 'xXzZy', ao: 0.7 });
    this.col.add(b.x0 - e, base, b.z0 - e, b.x1 + e, top, b.z1 + e, 'concrete');
  }

  lowrise(L, side) {
    const r = this.rng, fh = 3.5, Cb = MAP.CURB;
    const floors = r.int(2, 3), H = floors * fh, top = Cb + H;
    const b = this.cut(this.inset(L, 0.5), side, 4.4);
    const kind = r.chance(0.5) ? 'brick' : 'stucco';
    const color = lin(kind === 'brick' ? r.pick(BRICK_T) : r.pick(PASTEL));
    this.shell(b, Cb, top, fh, kind, color);
    const st = this.stairs(side, b, Cb, H, fh, {
      lane: 2.0, gap: 0.2, run: 0.32, maxRise: 0.26, landing: 2.0, mat: 'conc', color: lin('#d6d0c4'), surf: 'concrete', solidFirst: true,
    });
    const para = { b, top, color: lin('#e2dbcf'), gaps: { [side]: [st.gap] } };
    this.parapets.push(para);
    this.roofProps(b, top, side, { billboard: r.chance(0.3) });
    this.roofSpot(b, top);
    this.mapRect(b.x0, b.z0, b.x1, b.z1, '#c99b5c', H);
    return { b, top, side, access: true, para };
  }

  midrise(L, side) {
    const r = this.rng, fh = 3.5, Cb = MAP.CURB;
    const floors = r.int(4, 6), H = floors * fh, top = Cb + H;
    const b = this.cut(this.inset(L, 0.5), side, 3.2);
    const kind = r.pick(['concw', 'brick', 'stucco', 'concw']);
    const color = lin(kind === 'brick' ? r.pick(BRICK_T) : kind === 'stucco' ? r.pick(PASTEL) : r.pick(CONCW_T));
    this.shell(b, Cb, top, fh, kind, color);
    const st = this.stairs(side, b, Cb, H, fh, {
      lane: 1.3, gap: 0.1, run: 0.28, maxRise: 0.3, landing: 1.5, mat: 'metal', color: lin('#626a74'), surf: 'metal', thick: 0.32, solidFirst: false,
    });
    const para = { b, top, color: lin('#d9d2c6'), gaps: { [side]: [st.gap] } };
    this.parapets.push(para);
    this.roofProps(b, top, side, { water: r.chance(0.5), billboard: r.chance(0.2) });
    this.roofSpot(b, top);
    this.mapRect(b.x0, b.z0, b.x1, b.z1, '#b5874f', H);
    return { b, top, side, access: true, para };
  }

  tower(L, tall) {
    const r = this.rng, fh = 3.5, Cb = MAP.CURB;
    const floors = tall ? r.int(14, 22) : r.int(8, 13), H = floors * fh, top = Cb + H;
    const b = this.inset(L, 0.8);
    const kind = r.chance(0.65) ? 'office' : 'concw';
    const color = lin(kind === 'office' ? r.pick(OFFICE_T) : r.pick(CONCW_T));
    this.shell(b, Cb, top, fh, kind, color);
    const pw = (b.x1 - b.x0) * 0.25, pd = (b.z1 - b.z0) * 0.25;
    this.B(b.x0 + pw, top, b.z0 + pd, b.x1 - pw, top + 4, b.z1 - pd, { side: 'concw', top: 'roof', tile: [8, 7], topTile: 4, color, uvY: top });
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    this.gb.bar3('metal', cx, top + 4, cz, cx, top + 16, cz, 0.18, lin('#7d838a'));
    this.gb.box(cx - 0.2, top + 16, cz - 0.2, cx + 0.2, top + 16.4, cz + 0.2, { side: 'glow', top: 'glow', color: [6, 0.3, 0.2] });
    this.parapets.push({ b, top, color: lin('#d9d4ca'), gaps: {} });
    this.mapRect(b.x0, b.z0, b.x1, b.z1, '#4b5566', H);
    return { b, top, side: null, access: false };
  }

  parkingLot(L) {
    const r = this.rng, Cb = MAP.CURB, y = Cb + 0.012;
    this.gb.box(L.x0, Cb, L.z0, L.x1, y, L.z1, { top: 'asphalt', faces: 'Y', topTile: 8 });
    const white = lin('#e8e6df');
    const alongX = L.x1 - L.x0 >= L.z1 - L.z0;
    if (alongX) {
      for (let x = L.x0 + 1; x + 2.8 <= L.x1 - 1; x += 2.8) {
        this.flat(x, L.z0 + 0.5, x + 0.12, L.z0 + 5.4, y + 0.004, white);
        this.flat(x, L.z1 - 5.4, x + 0.12, L.z1 - 0.5, y + 0.004, white);
        if (x + 2.8 + 2.8 <= L.x1 - 1) {
          if (r.chance(0.5)) this.car(x + 1.46, Cb, L.z0 + 3, 'z');
          if (r.chance(0.5)) this.car(x + 1.46, Cb, L.z1 - 3, 'z');
        }
      }
    } else {
      for (let z = L.z0 + 1; z + 2.8 <= L.z1 - 1; z += 2.8) {
        this.flat(L.x0 + 0.5, z, L.x0 + 5.4, z + 0.12, y + 0.004, white);
        this.flat(L.x1 - 5.4, z, L.x1 - 0.5, z + 0.12, y + 0.004, white);
        if (z + 2.8 + 2.8 <= L.z1 - 1) {
          if (r.chance(0.5)) this.car(L.x0 + 3, Cb, z + 1.46, 'x');
          if (r.chance(0.5)) this.car(L.x1 - 3, Cb, z + 1.46, 'x');
        }
      }
    }
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    this.crateStack(cx + r.range(-1.5, 1.5), cz + r.range(-1.5, 1.5));
    this.barrier(cx + (alongX ? 5 : 0), Cb, cz + (alongX ? 0 : 5), alongX ? 'x' : 'z');
    this.mapRect(L.x0, L.z0, L.x1, L.z1, '#5a5d63', 0);
    return { b: L, top: Cb, access: false };
  }

  // Switchback exterior staircase hugging one wall: two lanes, landing every floor.
  stairs(side, b, base, H, fh, o) {
    const off = 0.15;
    let wall, sMin, sMax;
    if (side === 'X') { wall = b.x1 + off; sMin = b.z0; sMax = b.z1; }
    else if (side === 'x') { wall = b.x0 - off; sMin = b.z0; sMax = b.z1; }
    else if (side === 'Z') { wall = b.z1 + off; sMin = b.x0; sMax = b.x1; }
    else { wall = b.z0 - off; sMin = b.x0; sMax = b.x1; }
    const pt = (s, t) => (side === 'X' ? [wall + t, s] : side === 'x' ? [wall - t, s] : side === 'Z' ? [s, wall + t] : [s, wall - t]);
    const box = (s0, s1, t0, t1, y0, y1, opt) => {
      const p = pt(s0, t0), q = pt(s1, t1);
      this.B(Math.min(p[0], q[0]), y0, Math.min(p[1], q[1]), Math.max(p[0], q[0]), y1, Math.max(p[1], q[1]), opt);
    };
    const W = o.lane, G = o.gap, TW = 2 * W + G;
    const n = Math.ceil(fh / o.maxRise), rise = fh / n, run = o.run, FR = n * run, LL = o.landing;
    const total = FR + 2 * LL;
    const sA = (sMin + sMax) / 2 - total / 2 + LL, sB = sA + FR;
    const flights = Math.round(H / fh);
    const mo = { side: o.mat, top: o.mat, tile: 1, worldU: true, color: o.color, surf: o.surf };
    const railO = { side: 'metal', top: 'metal', tile: 1, worldU: true, color: lin('#3a3e44'), surf: 'metal' };
    const railC = lin('#2f3338');
    let gap = null;
    for (let k = 0; k < flights; k++) {
      const y0 = base + k * fh;
      const even = k % 2 === 0;
      const t0 = even ? W + G : 0, t1 = even ? TW : W;
      for (let i = 0; i < n; i++) {
        const yt = y0 + (i + 1) * rise;
        const s0 = even ? sA + i * run : sB - (i + 1) * run;
        const yb = k === 0 && o.solidFirst ? base : yt - (o.thick ?? rise + 0.14);
        box(s0, s0 + run, t0, t1, yb, yt, mo);
      }
      // Sloped handrail (visual) with end posts.
      const tr = even ? TW - 0.05 : W + G * 0.5;
      const sS = even ? sA : sB, sE = even ? sB : sA;
      const pS = pt(sS, tr), pE = pt(sE, tr);
      this.gb.bar3('metal', pS[0], y0 + 0.95, pS[1], pE[0], y0 + fh + 0.95, pE[1], 0.06, railC);
      this.gb.bar3('metal', pS[0], y0, pS[1], pS[0], y0 + 0.95, pS[1], 0.06, railC);
      const pM = pt((sS + sE) / 2, tr);
      this.gb.bar3('metal', pM[0], y0 + fh * 0.5, pM[1], pM[0], y0 + fh * 0.5 + 0.95, pM[1], 0.05, railC);
      // Landing.
      const ly = y0 + fh;
      const ls0 = even ? sB : sA - LL, ls1 = even ? sB + LL : sA;
      box(ls0, ls1, 0, TW, ly - 0.3, ly, mo);
      box(ls0 + 0.05, ls0 + 0.3, TW - 0.3, TW - 0.05, base, ly - 0.3, mo);
      box(ls1 - 0.3, ls1 - 0.05, TW - 0.3, TW - 0.05, base, ly - 0.3, mo);
      box(ls0, ls1, TW - 0.06, TW, ly, ly + 1.0, railO);
      if (even) box(ls1 - 0.06, ls1, 0, TW, ly, ly + 1.0, railO);
      else box(ls0, ls0 + 0.06, 0, TW, ly, ly + 1.0, railO);
      if (k === flights - 1) gap = [ls0, ls1];
    }
    return { gap };
  }

  buildParapet(p) {
    const { b, top } = p, h = 0.9, t = 0.3;
    const o = { side: 'conc', top: 'conc', tile: 1, worldU: true, color: p.color, surf: 'concrete' };
    const edges = {
      z: { fixed: b.z0, a0: b.x0, a1: b.x1, along: 'x' },
      Z: { fixed: b.z1 - t, a0: b.x0, a1: b.x1, along: 'x' },
      x: { fixed: b.x0, a0: b.z0 + t, a1: b.z1 - t, along: 'z' },
      X: { fixed: b.x1 - t, a0: b.z0 + t, a1: b.z1 - t, along: 'z' },
    };
    for (const key of Object.keys(edges)) {
      const e = edges[key];
      const gaps = (p.gaps[key] || []).filter(Boolean).slice().sort((u, v) => u[0] - v[0]);
      const segs = [];
      let cur = e.a0;
      for (const [g0, g1] of gaps) {
        if (g0 > cur) segs.push([cur, Math.min(g0, e.a1)]);
        cur = Math.max(cur, g1);
      }
      if (cur < e.a1) segs.push([cur, e.a1]);
      for (const [s0, s1] of segs) {
        if (s1 - s0 < 0.1) continue;
        if (e.along === 'x') this.B(s0, top, e.fixed, s1, top + h, e.fixed + t, o);
        else this.B(e.fixed, top, s0, e.fixed + t, top + h, s1, o);
      }
    }
  }

  roofProps(b, top, side, o = {}) {
    const r = this.rng;
    const c = this.cut({ x0: b.x0 + 1.6, x1: b.x1 - 1.6, z0: b.z0 + 1.6, z1: b.z1 - 1.6 }, side, 3);
    const n = r.int(1, 3);
    for (let i = 0; i < n; i++) {
      const sx = r.chance(0.5) ? 1.6 : 1.1, sz = sx === 1.6 ? 1.1 : 1.6;
      if (c.x1 - c.x0 < sx + 0.5 || c.z1 - c.z0 < sz + 0.5) break;
      const x = r.range(c.x0, c.x1 - sx), z = r.range(c.z0, c.z1 - sz);
      this.B(x, top, z, x + sx, top + 1.1, z + sz, { side: 'paint', top: 'metal', tile: 1, worldU: true, color: lin('#a7acb1'), surf: 'metal' });
      this.gb.box(x + 0.2, top + 1.1, z + 0.2, x + sx - 0.2, top + 1.15, z + sz - 0.2, { side: 'paint', top: 'paint', color: lin('#2c2f33') });
    }
    if (r.chance(0.6) && c.x1 > c.x0 && c.z1 > c.z0) {
      const x = r.range(c.x0, c.x1), z = r.range(c.z0, c.z1);
      this.gb.prism('paint', x, top + 0.6, z, 0.18, 1.2, 8, 'y', lin('#8f9398'));
      this.col.add(x - 0.18, top, z - 0.18, x + 0.18, top + 1.2, z + 0.18, 'metal');
    }
    if (o.water && c.x1 - c.x0 > 5 && c.z1 - c.z0 > 5) this.waterTower((c.x0 + c.x1) / 2 + r.range(-1, 1), top, (c.z0 + c.z1) / 2 + r.range(-1, 1));
    if (o.billboard) this.billboard(b, top, side);
  }

  waterTower(x, top, z) {
    const legC = lin('#4a4038');
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      this.gb.bar3('metal', x + dx, top, z + dz, x + dx * 0.9, top + 3.1, z + dz * 0.9, 0.16, legC);
      this.col.add(x + dx - 0.1, top, z + dz - 0.1, x + dx + 0.1, top + 3, z + dz + 0.1, 'metal');
    }
    this.gb.bar3('metal', x - 1.2, top + 1.4, z - 1.2, x + 1.2, top + 1.4, z + 1.2, 0.08, legC);
    this.gb.bar3('metal', x + 1.2, top + 1.4, z - 1.2, x - 1.2, top + 1.4, z + 1.2, 0.08, legC);
    this.gb.prism('wood', x, top + 3.1 + 1.6, z, 1.7, 3.2, 12, 'y', lin('#c7a37c'), { tile: 1.2, bottomCap: true });
    const apex = [x, top + 3.1 + 3.2 + 1.2, z];
    const roofC = lin('#6a5a4d');
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * TAU, a1 = ((i + 1) / 12) * TAU;
      const p0 = [x + Math.cos(a0) * 1.85, top + 6.3, z + Math.sin(a0) * 1.85];
      const p1 = [x + Math.cos(a1) * 1.85, top + 6.3, z + Math.sin(a1) * 1.85];
      this.gb.tri('paint', p0, p1, apex, [Math.cos((a0 + a1) / 2), 0.8, Math.sin((a0 + a1) / 2)], roofC);
    }
    this.col.add(x - 1.7, top + 3.1, z - 1.7, x + 1.7, top + 6.3, z + 1.7, 'wood');
  }

  billboard(b, top, side) {
    const r = this.rng;
    const opp = { X: 'x', x: 'X', Z: 'z', z: 'Z' }[side];
    const ad = 'ad' + r.int(0, 2);
    const y0 = top + 2.2, y1 = top + 6.2;
    const frame = lin('#34383e');
    const o = { side: 'paint', top: 'paint', color: frame, surf: 'metal' };
    if (opp === 'x' || opp === 'X') {
      const x = opp === 'x' ? b.x0 + 0.8 : b.x1 - 1.0;
      const zc = (b.z0 + b.z1) / 2, hw = Math.min(4, (b.z1 - b.z0) / 2 - 0.6);
      this.B(x, y0, zc - hw, x + 0.2, y1, zc + hw, o);
      this.gb.box(opp === 'x' ? x - 0.02 : x + 0.2, y0 + 0.15, zc - hw + 0.15, opp === 'x' ? x : x + 0.22, y1 - 0.15, zc + hw - 0.15,
        { side: ad, faces: opp, tile: [hw * 2 - 0.3, y1 - y0 - 0.3], uvY: y0 + 0.15 });
      for (const zz of [zc - hw + 0.6, zc + hw - 0.6]) this.B(x + 0.05, top, zz - 0.1, x + 0.15, y0, zz + 0.1, o);
    } else {
      const z = opp === 'z' ? b.z0 + 0.8 : b.z1 - 1.0;
      const xc = (b.x0 + b.x1) / 2, hw = Math.min(4, (b.x1 - b.x0) / 2 - 0.6);
      this.B(xc - hw, y0, z, xc + hw, y1, z + 0.2, o);
      this.gb.box(xc - hw + 0.15, y0 + 0.15, opp === 'z' ? z - 0.02 : z + 0.2, xc + hw - 0.15, y1 - 0.15, opp === 'z' ? z : z + 0.22,
        { side: ad, faces: opp, tile: [hw * 2 - 0.3, y1 - y0 - 0.3], uvY: y0 + 0.15 });
      for (const xx of [xc - hw + 0.6, xc + hw - 0.6]) this.B(xx - 0.1, top, z + 0.05, xx + 0.1, y0, z + 0.15, o);
    }
  }

  roofSpot(b, top) {
    const s = {
      x: (b.x0 + b.x1) / 2, y: top, z: (b.z0 + b.z1) / 2,
      rx: Math.max(0.5, (b.x1 - b.x0) / 2 - 1.6), rz: Math.max(0.5, (b.z1 - b.z0) / 2 - 1.6),
    };
    this.roofSpots.push(s);
    this.pickupSpots.push(s);
  }

  // ---------- Special blocks ----------
  plaza(bx0, bz0) {
    const Cb = MAP.CURB, cx = bx0 + MAP.BLOCK / 2, cz = bz0 + MAP.BLOCK / 2;
    const tiers = [{ s: 42, h: 2.0 }, { s: 28, h: 4.5 }, { s: 16, h: 7.0 }];
    const stoneO = { side: 'conc', top: 'paver', tile: 2, topTile: 4, worldU: true, color: lin('#f1e7d6') };
    const stepO = { side: 'conc', top: 'conc', tile: 2, worldU: true, color: lin('#ece3d3') };
    let prev = Cb;
    tiers.forEach((T, ti) => {
      const hs = T.s / 2, top = Cb + T.h;
      this.B(cx - hs, prev, cz - hs, cx + hs, top, cz + hs, stoneO);
      const rise = top - prev, n = Math.ceil(rise / 0.25), rr = rise / n, run = 0.42, SWd = ti === 0 ? 14 : 10;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let j = 0; j < n - 1; j++) {
          const yt = top - (j + 1) * rr;
          const d0 = hs + j * run, d1 = hs + (j + 1) * run;
          let x0, x1, z0, z1;
          if (dx !== 0) {
            x0 = dx > 0 ? cx + d0 : cx - d1; x1 = dx > 0 ? cx + d1 : cx - d0;
            z0 = cz - SWd / 2; z1 = cz + SWd / 2;
          } else {
            z0 = dz > 0 ? cz + d0 : cz - d1; z1 = dz > 0 ? cz + d1 : cz - d0;
            x0 = cx - SWd / 2; x1 = cx + SWd / 2;
          }
          this.B(x0, prev, z0, x1, yt, z1, stepO);
        }
        // Low cheek blocks flanking each stair run.
        const ext = run * (n - 1);
        for (const sgn of [-1, 1]) {
          if (dx !== 0) {
            const xa = dx > 0 ? cx + hs : cx - hs - ext, xb = dx > 0 ? cx + hs + ext : cx - hs;
            const zz = cz + sgn * (SWd / 2 + 0.3);
            this.B(xa, prev, zz - 0.3, xb, prev + 0.5, zz + 0.3, stepO);
          } else {
            const za = dz > 0 ? cz + hs : cz - hs - ext, zb = dz > 0 ? cz + hs + ext : cz - hs;
            const xx = cx + sgn * (SWd / 2 + 0.3);
            this.B(xx - 0.3, prev, za, xx + 0.3, prev + 0.5, zb, stepO);
          }
        }
      }
      this.mapRect(cx - hs, cz - hs, cx + hs, cz + hs, ['#cdb990', '#d8c6a0', '#e4d4b2'][ti], T.h);
      prev = top;
    });
    const t1 = Cb + 2.0, t2 = Cb + 4.5, t3 = Cb + 7.0;
    // Monument
    this.B(cx - 3, t3, cz - 3, cx + 3, t3 + 1.2, cz + 3, stoneO);
    const shaftC = lin('#f3dfc0');
    this.B(cx - 0.9, t3 + 1.2, cz - 0.9, cx + 0.9, t3 + 17, cz + 0.9, { side: 'conc', top: 'conc', tile: 2, worldU: true, color: shaftC });
    const apex = [cx, t3 + 19.5, cz];
    const c4 = [[cx - 0.9, cz - 0.9], [cx + 0.9, cz - 0.9], [cx + 0.9, cz + 0.9], [cx - 0.9, cz + 0.9]];
    for (let i = 0; i < 4; i++) {
      const a = c4[i], b = c4[(i + 1) % 4];
      const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
      this.gb.tri('paint', [a[0], t3 + 17, a[1]], [b[0], t3 + 17, b[1]], apex, [mx, 0.5, mz], lin('#e8b04a'));
    }
    // Planters with palms on tier 1 corners and cover walls.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = cx + sx * 18, pz = cz + sz * 18;
        this.B(px - 1.5, t1, pz - 1.5, px + 1.5, t1 + 0.8, pz + 1.5, { side: 'conc', top: 'grass', tile: 1, topTile: 4, worldU: true, color: lin('#e3d8c4') });
        this.palm(px, t1 + 0.8, pz);
        this.B(cx + sx * 17.5 - 0.3, t1, cz + sz * 10 - 2, cx + sx * 17.5 + 0.3, t1 + 1.15, cz + sz * 10 + 2, stepO);
        this.B(cx + sx * 10 - 2, t1, cz + sz * 17.5 - 0.3, cx + sx * 10 + 2, t1 + 1.15, cz + sz * 17.5 + 0.3, stepO);
        this.bench(cx + sx * 11, t2, cz + sz * 11.5, 'x');
        this.lamp(cx + sx * 20, t1, cz + sz * 14, sx, 0, false);
      }
    }
    this.roofSpots.push({ x: cx, y: t2, z: cz + 12, rx: 8, rz: 0.8 });
    this.roofSpots.push({ x: cx, y: t2, z: cz - 12, rx: 8, rz: 0.8 });
    this.roofSpots.push({ x: cx + 17.5, y: t1, z: cz, rx: 1.5, rz: 6 });
    this.pickupSpots.push({ x: cx - 5.5, y: t3, z: cz - 5.5, rx: 0.5, rz: 0.5 });
    this.spawn = { x: cx + 5.6, y: t3, z: cz + 5.6, yaw: Math.PI * 0.25 };
  }

  garage(bx0, bz0) {
    const r = this.rng, Cb = MAP.CURB, LH = 3.2, W = 48, D = 40;
    const gx0 = bx0 + MAP.SW, gz0 = bz0 + MAP.SW, gx1 = gx0 + W, gz1 = gz0 + D;
    const a = gx0 + 14, RL = 16, a1 = a + RL;
    const laneB = [gz0, gz0 + 4], laneA = [gz0 + 4, gz0 + 8], pz0 = gz0 + 8;
    const Y = (k) => Cb + k * LH;
    const sub = (j) => (j % 2 === 0 ? laneB : laneA);
    const slabO = { side: 'conc', top: 'conc', bottom: 'conc', faces: 'xXzZYy', tile: 2, topTile: 2, worldU: true, color: lin('#c2bdb4') };
    const paraO = { side: 'conc', top: 'conc', tile: 1, worldU: true, color: lin('#d2ccc1') };
    const colO = { side: 'conc', top: 'conc', tile: 1, worldU: true, color: lin('#b8b2a8') };
    const stripe = lin('#f0c419'), white = lin('#ecebe6');
    this.gb.box(gx0, Cb, gz0, gx1, Cb + 0.01, gz1, { top: 'conc', faces: 'Y', topTile: 2, color: lin('#a39e96') });
    const colXs = [gx0 + 0.3, gx0 + 8, gx0 + 16, gx0 + 24, gx0 + 32, gx0 + 40, gx1 - 0.3];
    const colZs = [pz0 + 0.3, (pz0 + gz1) / 2, gz1 - 0.3];
    for (let k = 0; k <= 4; k++) {
      const y = Y(k);
      if (k > 0) {
        this.B(gx0, y - 0.3, pz0, gx1, y, gz1, slabO);
        this.B(gx0, y - 0.3, gz0, a, y, pz0, slabO);
        this.B(a1, y - 0.3, gz0, gx1, y, pz0, slabO);
        const used = new Set([sub(k - 1)]);
        if (k <= 3) used.add(sub(k));
        let laneBCovered = false;
        for (const S of [laneB, laneA]) {
          if (!used.has(S)) {
            this.B(a, y - 0.3, S[0], a1, y, S[1], slabO);
            if (S === laneB) laneBCovered = true;
          }
        }
        this.B(gx0, y, gz1 - 0.25, gx1, y + 1.0, gz1, paraO);
        this.B(gx0, y, gz0, gx0 + 0.25, y + 1.0, gz1 - 0.25, paraO);
        this.B(gx1 - 0.25, y, gz0, gx1, y + 1.0, gz1 - 0.25, paraO);
        this.B(gx0 + 0.25, y, gz0, a, y + 1.0, gz0 + 0.25, paraO);
        this.B(a1, y, gz0, gx1 - 0.25, y + 1.0, gz0 + 0.25, paraO);
        if (laneBCovered) this.B(a, y, gz0, a1, y + 1.0, gz0 + 0.25, paraO);
        // Yellow safety stripe on the open slab edge facing the ramps.
        this.flat(gx0 + 0.3, pz0 + 0.02, a, pz0 + 0.2, y + 0.012, stripe);
        this.flat(a1, pz0 + 0.02, gx1 - 0.3, pz0 + 0.2, y + 0.012, stripe);
      }
      // Stall lines and parked cars on every level.
      for (let x = gx0 + 1.5; x + 2.9 <= gx1 - 1.5; x += 2.9) {
        this.flat(x, pz0 + 0.6, x + 0.12, pz0 + 5.4, y + 0.014, white);
        this.flat(x, gz1 - 5.4, x + 0.12, gz1 - 0.6, y + 0.014, white);
        const nearCol = colXs.some((cx) => Math.abs(cx - (x + 1.45)) < 1.6);
        if (!nearCol && x + 5.8 <= gx1 - 1.5) {
          if (r.chance(k === 4 ? 0.25 : 0.4)) this.car(x + 1.45, y, pz0 + 3, 'z');
          if (r.chance(k === 4 ? 0.25 : 0.4)) this.car(x + 1.45, y, gz1 - 3, 'z');
        }
      }
      if (k < 4) {
        for (const cx of colXs) for (const cz of colZs) this.B(cx - 0.3, y, cz - 0.3, cx + 0.3, Y(k + 1) - 0.3, cz + 0.3, colO);
        for (const cx of [gx0 + 0.3, gx0 + 7, gx1 - 7, gx1 - 0.3]) this.B(cx - 0.3, y, gz0, cx + 0.3, Y(k + 1) - 0.3, gz0 + 0.6, colO);
      }
    }
    // Ramps: sloped visual slab + fine stepped colliders.
    const rampC = lin('#b0aba2');
    for (let j = 0; j < 4; j++) {
      const S = sub(j), yA = Y(j), yB = Y(j + 1), pos = j % 2 === 0;
      const xs = pos ? a : a1, xe = pos ? a1 : a;
      const T = 0.3;
      this.gb.poly4('conc', [xs, yA, S[0]], [xe, yB, S[0]], [xe, yB, S[1]], [xs, yA, S[1]], [0, 1, 0], rampC, 2);
      this.gb.poly4('conc', [xs, yA - T, S[0]], [xe, yB - T, S[0]], [xe, yB - T, S[1]], [xs, yA - T, S[1]], [0, -1, 0], rampC, 2);
      this.gb.poly4('conc', [xs, yA - T, S[0]], [xe, yB - T, S[0]], [xe, yB, S[0]], [xs, yA, S[0]], [0, 0, -1], rampC, 2);
      this.gb.poly4('conc', [xs, yA - T, S[1]], [xe, yB - T, S[1]], [xe, yB, S[1]], [xs, yA, S[1]], [0, 0, 1], rampC, 2);
      const n = 32, run = RL / n, rise = LH / n;
      for (let i = 0; i < n; i++) {
        const yt = yA + (i + 1) * rise;
        const sx0 = pos ? a + i * run : a1 - (i + 1) * run;
        this.col.add(sx0, yt - 0.5, S[0], sx0 + run, yt, S[1], 'concrete');
      }
      if (S === laneB) {
        this.gb.bar3('metal', xs, yA + 1.0, gz0 + 0.1, xe, yB + 1.0, gz0 + 0.1, 0.08, lin('#3a3e44'));
      }
    }
    for (let k = 2; k <= 4; k++) this.roofSpots.push({ x: (gx0 + gx1) / 2, y: Y(k), z: (pz0 + gz1) / 2, rx: 18, rz: 9 });
    this.pickupSpots.push({ x: gx0 + 6, y: Y(4), z: (pz0 + gz1) / 2, rx: 0.5, rz: 0.5 });
    this.pickupSpots.push({ x: gx1 - 6, y: Y(2), z: (pz0 + gz1) / 2, rx: 0.5, rz: 0.5 });
    this.lamp(gx0 + 6, Y(4), gz1 - 3, 0, -1, false);
    this.lamp(gx1 - 6, Y(4), gz1 - 3, 0, -1, false);
    this.mapRect(gx0, gz0, gx1, gz1, '#8d9199', 4 * LH);
  }

  park(bx0, bz0) {
    const r = this.rng, Cb = MAP.CURB, ix0 = bx0 + MAP.SW, iz0 = bz0 + MAP.SW, IN = 48, y = Cb + 0.12;
    const ix1 = ix0 + IN, iz1 = iz0 + IN, cx = ix0 + IN / 2, cz = iz0 + IN / 2;
    this.B(ix0, Cb, iz0, ix1, y, iz1, { side: 'conc', top: 'grass', tile: 1, topTile: 4, worldU: true, color: WHITE });
    this.gb.box(ix0, y, cz - 1.5, ix1, y + 0.012, cz + 1.5, { top: 'paver', faces: 'Y', topTile: 4 });
    this.gb.box(cx - 1.5, y, iz0, cx + 1.5, y + 0.012, iz1, { top: 'paver', faces: 'Y', topTile: 4 });
    this.mapRect(ix0, iz0, ix1, iz1, '#4f7d33', 0);
    // Basketball court (NW quadrant).
    const qx = ix0 + 2, qz = iz0 + 6, cw = 19, cd = 11;
    this.gb.box(qx, y, qz, qx + cw, y + 0.02, qz + cd, { top: 'conc', faces: 'Y', topTile: 2, color: lin('#b4593b') });
    const lc = lin('#f2efe8'), ly = y + 0.032;
    this.flat(qx + 0.3, qz + 0.3, qx + cw - 0.3, qz + 0.42, ly, lc);
    this.flat(qx + 0.3, qz + cd - 0.42, qx + cw - 0.3, qz + cd - 0.3, ly, lc);
    this.flat(qx + 0.3, qz + 0.3, qx + 0.42, qz + cd - 0.3, ly, lc);
    this.flat(qx + cw - 0.42, qz + 0.3, qx + cw - 0.3, qz + cd - 0.3, ly, lc);
    this.flat(qx + cw / 2 - 0.06, qz + 0.3, qx + cw / 2 + 0.06, qz + cd - 0.3, ly, lc);
    for (const end of [0, 1]) {
      const hx = end ? qx + cw - 0.8 : qx + 0.8, dir = end ? -1 : 1, hz = qz + cd / 2;
      this.gb.bar3('metal', hx, y, hz, hx, y + 3.4, hz, 0.14, lin('#2d3136'));
      this.col.add(hx - 0.1, y, hz - 0.1, hx + 0.1, y + 3.4, hz + 0.1, 'metal');
      this.gb.box(hx + dir * 0.05 - 0.05, y + 2.9, hz - 0.9, hx + dir * 0.05 + 0.05, y + 3.95, hz + 0.9, { side: 'paint', top: 'paint', color: lin('#f4f4f2') });
      this.gb.prism('paint', hx + dir * 0.45, y + 3.05, hz, 0.23, 0.03, 10, 'y', lin('#ff6a00'), { caps: false });
    }
    this.crateStack(qx + cw + 0.6, qz - 3.5);
    // Stage (SE quadrant) with stairs and a big ad wall.
    const sx0 = cx + 6, sz0 = cz + 8, sx1 = sx0 + 14, sz1 = sz0 + 8, sh = 1.6;
    this.B(sx0, y, sz0, sx1, y + sh, sz1, { side: 'paint', top: 'wood', tile: 1.2, worldU: true, color: lin('#3c3f45'), topColor: WHITE, surf: 'wood' });
    const n = 6, rr = sh / n;
    for (let i = 0; i < n - 1; i++) {
      const yt = y + sh - (i + 1) * rr;
      this.B(sx0 + 4, y, sz0 - (i + 1) * 0.36, sx0 + 10, yt, sz0 - i * 0.36, { side: 'conc', top: 'wood', tile: 1.2, worldU: true, surf: 'wood' });
    }
    this.B(sx0, y + sh, sz1 - 0.4, sx1, y + sh + 5.5, sz1, { side: 'paint', top: 'paint', color: lin('#2a2d33'), surf: 'metal' });
    this.gb.box(sx0 + 0.4, y + sh + 0.6, sz1 - 0.42, sx1 - 0.4, y + sh + 5.2, sz1 - 0.4, { side: 'ad2', faces: 'z', tile: [sx1 - sx0 - 0.8, 4.6], uvY: y + sh + 0.6 });
    this.roofSpots.push({ x: (sx0 + sx1) / 2, y: y + sh, z: (sz0 + sz1) / 2 - 1, rx: 5, rz: 2 });
    this.pickupSpots.push({ x: sx0 + 1.5, y: y + sh, z: sz0 + 1.5, rx: 0.5, rz: 0.5 });
    // Palms and benches.
    const spots = [[ix0 + 4, cz + 6], [ix0 + 10, iz1 - 5], [cx - 6, iz1 - 4], [ix1 - 4, iz0 + 4], [ix1 - 10, cz - 6], [cx + 4, iz0 + 3], [ix0 + 4, cz - 4], [ix1 - 4, cz + 4]];
    for (const [px, pz] of spots) this.palm(px + r.range(-1, 1), y, pz + r.range(-1, 1));
    this.bench(cx - 4, y, cz + 2.6, 'x');
    this.bench(cx + 4, y, cz - 2.6, 'x');
    this.bench(cx - 2.6, y, cz - 6, 'z');
    this.barrier(cx + 10, y, cz - 12, 'x');
    this.barrier(cx - 12, y, cz + 12, 'z');
  }

  // ---------- Props ----------
  car(cx, y, cz, axis, color) {
    const r = this.rng;
    const L = 4.4, W = 1.9;
    const along = (a, b) => (axis === 'x' ? [a, b] : [b, a]);
    const f = r.chance(0.5) ? 1 : -1;
    const col = lin(color || r.pick(CAR_C));
    const box = (a0, a1, b0, b1, y0, y1, o) => {
      const p = along(a0, b0), q = along(a1, b1);
      this.gb.box(cx + Math.min(p[0], q[0]), y + y0, cz + Math.min(p[1], q[1]), cx + Math.max(p[0], q[0]), y + y1, cz + Math.max(p[1], q[1]), o);
    };
    box(-L / 2, L / 2, -W / 2, W / 2, 0.32, 0.98, { side: 'carpaint', top: 'carpaint', color: col, ao: 0.55 });
    const c0 = f > 0 ? -1.35 : -0.95, c1 = f > 0 ? 0.95 : 1.35;
    box(c0, c1, -W / 2 + 0.12, W / 2 - 0.12, 0.98, 1.44, { side: 'glass', top: null, color: lin('#1a2633'), ao: 1 });
    box(c0 + 0.08, c1 - 0.08, -W / 2 + 0.16, W / 2 - 0.16, 1.42, 1.5, { side: 'carpaint', top: 'carpaint', color: col, ao: 1 });
    const trim = lin('#1b1c1e');
    box(-L / 2 - 0.06, -L / 2 + 0.25, -W / 2 + 0.05, W / 2 - 0.05, 0.3, 0.56, { side: 'paint', top: 'paint', color: trim });
    box(L / 2 - 0.25, L / 2 + 0.06, -W / 2 + 0.05, W / 2 - 0.05, 0.3, 0.56, { side: 'paint', top: 'paint', color: trim });
    const front = (f * L) / 2;
    const head = [3.2, 3.0, 2.6], tail = [2.6, 0.12, 0.08];
    for (const s of [-1, 1]) {
      const hp = along(front, s * 0.62), tp = along(-front, s * 0.62);
      const ex = axis === 'x' ? 0.04 : 0.24, ez = axis === 'x' ? 0.24 : 0.04;
      this.gb.box(cx + hp[0] - ex, y + 0.66, cz + hp[1] - ez, cx + hp[0] + ex, y + 0.82, cz + hp[1] + ez, { side: 'glow', top: 'glow', color: head });
      this.gb.box(cx + tp[0] - ex, y + 0.68, cz + tp[1] - ez, cx + tp[0] + ex, y + 0.8, cz + tp[1] + ez, { side: 'glow', top: 'glow', color: tail });
    }
    const wheelAxis = axis === 'x' ? 'z' : 'x';
    for (const a of [-L / 2 + 0.85, L / 2 - 0.85]) {
      for (const s of [-1, 1]) {
        const p = along(a, s * (W / 2 - 0.12));
        this.gb.prism('paint', cx + p[0], y + 0.34, cz + p[1], 0.34, 0.26, 10, wheelAxis, lin('#141414'), { capColor: lin('#8c9096'), ao: 1 });
      }
    }
    const p = along(L / 2, W / 2), q = along((c1 - c0) / 2, W / 2 - 0.12);
    this.col.add(cx - p[0], y, cz - p[1], cx + p[0], y + 0.98, cz + p[1], 'metal');
    const cm = along((c0 + c1) / 2, 0);
    this.col.add(cx + cm[0] - q[0], y + 0.98, cz + cm[1] - q[1], cx + cm[0] + q[0], y + 1.5, cz + cm[1] + q[1], 'metal');
  }

  crateStack(x, z) {
    const r = this.rng, y = MAP.CURB, s = 1.2;
    const o = { side: 'wood', top: 'wood', tile: 1.2, surf: 'wood' };
    const rot = r.chance(0.5);
    const cells = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const [a, b, h] of cells) {
      const ox = rot ? b : a, oz = rot ? a : b;
      if (h === 1 && r.chance(0.3)) continue;
      this.B(x + ox * s - s, y + h * s, z + oz * s - s, x + ox * s, y + (h + 1) * s, z + oz * s, o);
    }
  }

  dumpster(x, y, z, axis) {
    const hw = axis === 'x' ? 0.95 : 0.7, hd = axis === 'x' ? 0.7 : 0.95;
    this.B(x - hw, y, z - hd, x + hw, y + 1.25, z + hd, { side: 'paint', top: 'metal', tile: 1, worldU: true, color: lin('#2f6b45'), surf: 'metal' });
    this.gb.box(x - hw - 0.05, y + 1.25, z - hd - 0.05, x + hw + 0.05, y + 1.32, z + hd + 0.05, { side: 'paint', top: 'paint', color: lin('#1e2a22') });
  }

  barrier(x, y, z, axis) {
    const c = lin('#d6d1c6');
    for (let i = -1; i <= 1; i++) {
      const ox = axis === 'x' ? i * 3.1 : 0, oz = axis === 'z' ? i * 3.1 : 0;
      const hx = axis === 'x' ? 1.5 : 0.3, hz = axis === 'x' ? 0.3 : 1.5;
      this.B(x + ox - hx, y, z + oz - hz, x + ox + hx, y + 0.9, z + oz + hz, { side: 'conc', top: 'conc', tile: 1, worldU: true, color: c });
      this.gb.box(x + ox - hx - 0.02, y + 0.55, z + oz - hz - 0.02, x + ox + hx + 0.02, y + 0.7, z + oz + hz + 0.02, { side: 'paint', top: null, color: lin('#e85d04'), faces: 'xXzZ' });
    }
  }

  bench(x, y, z, axis) {
    const hx = axis === 'x' ? 1.0 : 0.25, hz = axis === 'x' ? 0.25 : 1.0;
    this.B(x - hx, y + 0.42, z - hz, x + hx, y + 0.5, z + hz, { side: 'wood', top: 'wood', tile: 1.2, worldU: true, surf: 'wood' });
    for (const s of [-1, 1]) {
      const lx = axis === 'x' ? s * (hx - 0.15) : 0, lz = axis === 'z' ? s * (hz - 0.15) : 0;
      this.gb.box(x + lx - 0.05 - (axis === 'z' ? 0.2 : 0), y, z + lz - 0.05 - (axis === 'x' ? 0.2 : 0), x + lx + 0.05 + (axis === 'z' ? 0.2 : 0), y + 0.42, z + lz + 0.05 + (axis === 'x' ? 0.2 : 0), { side: 'paint', top: 'paint', color: lin('#2b2e33') });
    }
  }

  lamp(x, y, z, dx, dz, signal = true) {
    const pole = lin('#33373d');
    this.gb.bar3('metal', x, y, z, x, y + 6.6, z, 0.18, pole);
    const len = 1.8;
    const nx = dx === 0 && dz === 0 ? 1 : dx, nz = dz;
    const l = Math.hypot(nx, nz);
    const ex = x + (nx / l) * len, ez = z + (nz / l) * len;
    this.gb.bar3('metal', x, y + 6.5, z, ex, y + 6.75, ez, 0.1, pole);
    this.gb.box(ex - 0.3, y + 6.55, ez - 0.3, ex + 0.3, y + 6.8, ez + 0.3, { side: 'paint', top: 'paint', color: pole });
    this.gb.box(ex - 0.24, y + 6.5, ez - 0.24, ex + 0.24, y + 6.56, ez + 0.24, { side: 'glow', top: 'glow', bottom: 'glow', faces: 'xXzZYy', color: [1.6, 1.3, 0.9] });
    this.col.add(x - 0.13, y, z - 0.13, x + 0.13, y + 6.6, z + 0.13, 'metal');
    if (signal) {
      const sx = x - (nz / l) * 0.3, sz = z + (nx / l) * 0.3;
      this.gb.box(sx - 0.18, y + 3.0, sz - 0.18, sx + 0.18, y + 4.1, sz + 0.18, { side: 'paint', top: 'paint', color: lin('#d9a404') });
      const lights = [[y + 3.85, [3, 0.15, 0.1]], [y + 3.55, [0.25, 0.2, 0.05]], [y + 3.25, [0.05, 0.25, 0.1]]];
      for (const [ly, c] of lights) {
        this.gb.box(sx - 0.2, ly - 0.1, sz - 0.2, sx + 0.2, ly + 0.1, sz + 0.2, { side: 'glow', top: null, color: c });
      }
    }
  }

  trashBin(x, y, z) {
    this.gb.prism('paint', x, y + 0.5, z, 0.32, 1.0, 10, 'y', lin('#2f4f3f'), { capColor: lin('#1e2b23') });
    this.col.add(x - 0.32, y, z - 0.32, x + 0.32, y + 1.0, z + 0.32, 'metal');
  }

  hydrant(x, y, z) {
    this.gb.prism('paint', x, y + 0.35, z, 0.14, 0.7, 8, 'y', lin('#c1121f'), { capColor: lin('#e5e5e5') });
    this.gb.prism('paint', x, y + 0.45, z, 0.06, 0.4, 6, 'x', lin('#c1121f'));
    this.col.add(x - 0.16, y, z - 0.16, x + 0.16, y + 0.75, z + 0.16, 'metal');
  }

  palm(x, y, z) {
    const r = this.rng;
    this.palms.push({ x, y, z, s: r.range(0.85, 1.2), rot: r.range(0, TAU) });
    this.col.add(x - 0.24, y, z - 0.24, x + 0.24, y + 3.5, z + 0.24, 'wood');
  }

  streetProps(bx0, bz0) {
    const r = this.rng, B = MAP.BLOCK, Cb = MAP.CURB;
    const sides = [
      { axis: 'x', fixed: bz0 + 1.6, road: bz0 - 1.5, a0: bx0, a1: bx0 + B },
      { axis: 'x', fixed: bz0 + B - 1.6, road: bz0 + B + 1.5, a0: bx0, a1: bx0 + B },
      { axis: 'z', fixed: bx0 + 1.6, road: bx0 - 1.5, a0: bz0, a1: bz0 + B },
      { axis: 'z', fixed: bx0 + B - 1.6, road: bx0 + B + 1.5, a0: bz0, a1: bz0 + B },
    ];
    for (const s of sides) {
      for (let t = s.a0 + 8; t < s.a1 - 6; t += 11) {
        const [x, z] = s.axis === 'x' ? [t, s.fixed] : [s.fixed, t];
        const roll = r.next();
        if (roll < 0.45) this.palm(x, Cb, z);
        else if (roll < 0.55) this.trashBin(x, Cb, z);
        else if (roll < 0.62) this.hydrant(x, Cb, z);
      }
      for (let t = s.a0 + 5; t < s.a1 - 5; t += 6.4) {
        if (!r.chance(0.3)) continue;
        const [x, z] = s.axis === 'x' ? [t, s.road] : [s.road, t];
        this.car(x, 0, z, s.axis);
      }
    }
    this.lamp(bx0 + 1.0, Cb, bz0 + 1.0, -1, -1);
    this.lamp(bx0 + B - 1.0, Cb, bz0 + 1.0, 1, -1);
    this.lamp(bx0 + 1.0, Cb, bz0 + B - 1.0, -1, 1);
    this.lamp(bx0 + B - 1.0, Cb, bz0 + B - 1.0, 1, 1);
  }

  boundary() {
    const r = this.rng, H = MAP.HALF;
    // Invisible hard walls.
    this.col.add(-H - 40, -10, -H - 40, H + 40, 400, -H - 0.2, 'concrete');
    this.col.add(-H - 40, -10, H + 0.2, H + 40, 400, H + 40, 'concrete');
    this.col.add(-H - 40, -10, -H - 40, -H - 0.2, 400, H + 40, 'concrete');
    this.col.add(H + 0.2, -10, -H - 40, H + 40, 400, H + 40, 'concrete');
    // Backdrop buildings lining the outer roads.
    const kinds = ['office', 'concw', 'brick', 'stucco', 'office'];
    for (let edge = 0; edge < 4; edge++) {
      let s = -H - 30;
      while (s < H + 30) {
        const w = r.range(14, 30), d = r.range(16, 30), h = r.range(18, 75);
        const kind = r.pick(kinds);
        const color = lin(kind === 'office' ? r.pick(OFFICE_T) : kind === 'stucco' ? r.pick(PASTEL) : kind === 'brick' ? r.pick(BRICK_T) : r.pick(CONCW_T));
        const o = { side: kind, top: 'roof', tile: [8, 7], topTile: 4, color, faces: 'xXzZY' };
        if (edge === 0) this.gb.box(s, 0, -H - 1 - d, s + w, h, -H - 1, o);
        else if (edge === 1) this.gb.box(s, 0, H + 1, s + w, h, H + 1 + d, o);
        else if (edge === 2) this.gb.box(-H - 1 - d, 0, s, -H - 1, h, s + w, o);
        else this.gb.box(H + 1, 0, s, H + 1 + d, h, s + w, o);
        s += w + r.range(0, 2.5);
      }
    }
  }

  skyline() {
    const r = this.rng;
    const kinds = ['office', 'concw', 'office'];
    for (let i = 0; i < 110; i++) {
      const a = (i / 110) * TAU + r.range(-0.02, 0.02);
      const d = r.range(270, 470);
      const w = r.range(18, 46);
      const h = r.range(30, 140) * (r.chance(0.2) ? 1.7 : 1);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const kind = r.pick(kinds);
      const color = lin(kind === 'office' ? r.pick(OFFICE_T) : r.pick(CONCW_T));
      this.gb.box(x - w / 2, 0, z - w / 2, x + w / 2, h, z + w / 2, { side: kind, top: 'roof', tile: [8, 7], topTile: 4, color, chunk: 'far', faces: 'xXzZY' });
    }
  }

  build() {
    for (const p of this.parapets) this.buildParapet(p);
    this.meshes = this.gb.build(this.mats);
    for (const m of this.meshes) this.scene.add(m);
    this.buildPalms();
  }

  buildPalms() {
    const { trunk, crown } = palmGeometries();
    const n = this.palms.length;
    const trunkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const crownMat = new THREE.MeshLambertMaterial({ map: this.tex.leaf, alphaTest: 0.45, side: THREE.DoubleSide, color: 0xd9f0b0 });
    const tm = new THREE.InstancedMesh(trunk, trunkMat, n);
    const cm = new THREE.InstancedMesh(crown, crownMat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    this.palms.forEach((pl, i) => {
      p.set(pl.x, pl.y, pl.z);
      q.setFromAxisAngle(up, pl.rot);
      s.setScalar(pl.s);
      m.compose(p, q, s);
      tm.setMatrixAt(i, m);
      cm.setMatrixAt(i, m);
    });
    for (const im of [tm, cm]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.scene.add(im);
    }
  }
}

function surfOf(k) {
  if (!k) return 'concrete';
  if (k === 'metal' || k === 'paint' || k === 'carpaint') return 'metal';
  if (k === 'wood') return 'wood';
  if (k === 'glass') return 'glass';
  return 'concrete';
}
