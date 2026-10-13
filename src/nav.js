import { MAP } from './world.js';
import { clamp } from './utils.js';

// Street-level walkability grid shared by every flow field.
export class NavGrid {
  constructor(col, cell = 2) {
    this.cell = cell;
    this.min = -MAP.HALF;
    this.n = Math.ceil(MAP.SIZE / cell);
    const N = this.n * this.n;
    this.walk = new Uint8Array(N);
    this.gy = new Float32Array(N);
    this.walkList = [];
    this.build(col);
    // Default field (Waves mode: everyone hunts the player).
    this.main = new FlowField(this);
  }

  build(col) {
    const n = this.n, cell = this.cell, tmp = [];
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const cx = this.min + (ix + 0.5) * cell, cz = this.min + (iz + 0.5) * cell;
        const g = col.groundHeight(cx, cz, 0.45, 0.6);
        col.query(cx - 0.75, cz - 0.75, cx + 0.75, cz + 0.75, tmp);
        let blocked = false;
        for (let i = 0; i < tmp.length; i++) {
          const c = tmp[i];
          if (c.y0 < g + 1.7 && c.y1 > g + 0.45) { blocked = true; break; }
        }
        const idx = iz * n + ix;
        this.walk[idx] = blocked ? 0 : 1;
        this.gy[idx] = g;
        if (!blocked) this.walkList.push(idx);
      }
    }
  }

  field() { return new FlowField(this); }

  cellOf(x, z) {
    const ix = clamp(Math.floor((x - this.min) / this.cell), 0, this.n - 1);
    const iz = clamp(Math.floor((z - this.min) / this.cell), 0, this.n - 1);
    return iz * this.n + ix;
  }

  center(idx, out) {
    const n = this.n;
    out.x = this.min + ((idx % n) + 0.5) * this.cell;
    out.z = this.min + (Math.floor(idx / n) + 0.5) * this.cell;
    out.y = this.gy[idx];
    return out;
  }

  nearestWalkable(idx, radius) {
    if (this.walk[idx]) return idx;
    const n = this.n, ix = idx % n, iz = Math.floor(idx / n);
    for (let r = 1; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = ix + dx, z = iz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const j = z * n + x;
          if (this.walk[j]) return j;
        }
      }
    }
    return -1;
  }

  // Random walkable street cell satisfying a predicate on its center.
  randomWhere(pred, out, tries = 400) {
    const list = this.walkList;
    for (let t = 0; t < tries; t++) {
      const idx = list[(Math.random() * list.length) | 0];
      this.center(idx, out);
      if (pred(out.x, out.z)) return out;
    }
    return null;
  }

  // Back-compat wrappers on the main field.
  get target() { return this.main.key; }
  set target(v) { this.main.key = v; }
  update(x, z) { this.main.update(x, z); }
  next(x, z, out) { return this.main.next(x, z, out); }
  pathDist(x, z) { return this.main.pathDist(x, z); }
  randomCell(minD, maxD, out) { return this.main.randomCell(minD, maxD, out); }
}

// Breadth-first distance field from one or many source points. Agents walk downhill.
export class FlowField {
  constructor(grid) {
    this.g = grid;
    const N = grid.n * grid.n;
    this.dist = new Int16Array(N).fill(-1);
    this.queue = new Int32Array(N);
    this.key = -1;
    this._src = [];
  }

  update(x, z) {
    const start = this.g.nearestWalkable(this.g.cellOf(x, z), 14);
    if (start < 0 || start === this.key) return;
    this.key = start;
    this._src.length = 0;
    this._src.push(start);
    this.bfs(this._src);
  }

  // sources: array of {x, z} (or bodies with .pos) — e.g. every hostile unit.
  updateSources(points) {
    const src = this._src;
    src.length = 0;
    const seen = this.dist;
    seen.fill(-1);
    for (const p of points) {
      const c = this.g.nearestWalkable(this.g.cellOf(p.x, p.z), 8);
      if (c >= 0 && seen[c] !== 0) {
        seen[c] = 0;
        src.push(c);
      }
    }
    this.key = -2;
    this.bfs(src, true);
  }

  bfs(sources, preset = false) {
    const n = this.g.n, dist = this.dist, walk = this.g.walk, q = this.queue;
    if (!preset) dist.fill(-1);
    let head = 0, tail = 0;
    for (const s of sources) {
      dist[s] = 0;
      q[tail++] = s;
    }
    while (head < tail) {
      const cur = q[head++];
      const cx = cur % n, cz = (cur - cx) / n;
      const d = dist[cur] + 1;
      for (let dz = -1; dz <= 1; dz++) {
        const z = cz + dz;
        if (z < 0 || z >= n) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const x = cx + dx;
          if (x < 0 || x >= n) continue;
          const j = z * n + x;
          if (!walk[j] || dist[j] >= 0) continue;
          if (dx && dz && (!walk[cz * n + x] || !walk[z * n + cx])) continue;
          dist[j] = d;
          q[tail++] = j;
        }
      }
    }
  }

  next(x, z, out) {
    const g = this.g, n = g.n;
    const idx = g.cellOf(x, z);
    if (this.dist[idx] < 0) {
      const alt = this.nearestReached(idx);
      if (alt < 0) return false;
      g.center(alt, out);
      return true;
    }
    if (this.dist[idx] === 0) return false;
    const cx = idx % n, cz = (idx - cx) / n;
    let best = -1, bd = this.dist[idx];
    for (let dz = -1; dz <= 1; dz++) {
      const zz = cz + dz;
      if (zz < 0 || zz >= n) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const xx = cx + dx;
        if (xx < 0 || xx >= n) continue;
        const j = zz * n + xx;
        const d = this.dist[j];
        if (d >= 0 && d < bd) {
          if (dx && dz && (!g.walk[cz * n + xx] || !g.walk[zz * n + cx])) continue;
          bd = d;
          best = j;
        }
      }
    }
    if (best < 0) return false;
    g.center(best, out);
    return true;
  }

  nearestReached(idx) {
    const n = this.g.n, ix = idx % n, iz = Math.floor(idx / n);
    for (let r = 1; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = ix + dx, z = iz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const j = z * n + x;
          if (this.dist[j] >= 0) return j;
        }
      }
    }
    return -1;
  }

  randomCell(minD, maxD, out) {
    const list = this.g.walkList;
    for (let tries = 0; tries < 400; tries++) {
      const idx = list[(Math.random() * list.length) | 0];
      const d = this.dist[idx];
      if (d >= minD && d <= maxD) return this.g.center(idx, out);
    }
    for (let tries = 0; tries < 400; tries++) {
      const idx = list[(Math.random() * list.length) | 0];
      if (this.dist[idx] >= Math.min(minD, 8)) return this.g.center(idx, out);
    }
    return null;
  }

  pathDist(x, z) {
    return this.dist[this.g.cellOf(x, z)];
  }
}
