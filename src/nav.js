import { MAP } from './world.js';
import { clamp } from './utils.js';

// Street-level flow field. Rebuilt (BFS) whenever the target cell changes, then every
// ground enemy just walks downhill — O(1) per agent per frame.
export class NavGrid {
  constructor(col, cell = 2) {
    this.cell = cell;
    this.min = -MAP.HALF;
    this.n = Math.ceil(MAP.SIZE / cell);
    const N = this.n * this.n;
    this.walk = new Uint8Array(N);
    this.gy = new Float32Array(N);
    this.dist = new Int16Array(N).fill(-1);
    this.queue = new Int32Array(N);
    this.target = -1;
    this.walkList = [];
    this.build(col);
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
      let best = -1;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = ix + dx, z = iz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const j = z * n + x;
          if (this.walk[j]) { best = j; break; }
        }
        if (best >= 0) break;
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  update(x, z) {
    let start = this.nearestWalkable(this.cellOf(x, z), 14);
    if (start < 0 || start === this.target) return;
    this.target = start;
    const n = this.n, dist = this.dist, walk = this.walk, q = this.queue;
    dist.fill(-1);
    let head = 0, tail = 0;
    dist[start] = 0;
    q[tail++] = start;
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

  // Writes the next waypoint (cell center) into out. Returns false if no path.
  next(x, z, out) {
    const n = this.n;
    let idx = this.cellOf(x, z);
    if (this.dist[idx] < 0) {
      const alt = this.nearestReached(idx);
      if (alt < 0) return false;
      this.center(alt, out);
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
          if (dx && dz && (!this.walk[cz * n + xx] || !this.walk[zz * n + cx])) continue;
          bd = d;
          best = j;
        }
      }
    }
    if (best < 0) return false;
    this.center(best, out);
    return true;
  }

  nearestReached(idx) {
    const n = this.n, ix = idx % n, iz = Math.floor(idx / n);
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

  // Random reachable street cell between minD and maxD BFS steps from the target.
  randomCell(minD, maxD, out) {
    const list = this.walkList;
    for (let tries = 0; tries < 400; tries++) {
      const idx = list[(Math.random() * list.length) | 0];
      const d = this.dist[idx];
      if (d >= minD && d <= maxD) return this.center(idx, out);
    }
    for (let tries = 0; tries < 400; tries++) {
      const idx = list[(Math.random() * list.length) | 0];
      if (this.dist[idx] >= Math.min(minD, 8)) return this.center(idx, out);
    }
    return null;
  }

  pathDist(x, z) {
    return this.dist[this.cellOf(x, z)];
  }
}
