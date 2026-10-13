import * as THREE from 'three';
import { rand, TAU } from './utils.js';

// ---------------------------------------------------------------------------
// Pooled GPU point particles. Zero allocations per frame; dead particles are
// swap-removed so the live set stays packed for drawRange.
// ---------------------------------------------------------------------------
const P_VERT = /* glsl */ `
attribute vec4 pcolor;
attribute float psize;
uniform float uScale;
varying vec4 vC;
void main() {
  vC = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(psize * uScale / max(-mv.z, 0.05), 1.0, 256.0);
}`;
const P_FRAG = /* glsl */ `
varying vec4 vC;
uniform float uSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = smoothstep(1.0, uSoft, d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vC.rgb, vC.a * a);
}`;

export class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('pcolor', this.aCol);
    g.setAttribute('psize', this.aSize);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, uSoft: { value: additive ? 0.0 : 0.35 } },
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 19;
    this.geo = g;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i4] = r; this.col[i4 + 1] = g; this.col[i4 + 2] = b; this.col[i4 + 3] = a;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.grav[i] = grav; this.drag[i] = drag;
    this.size[i] = s0;
  }

  kill(i) {
    const last = --this.count;
    if (i === last) return;
    const i3 = i * 3, l3 = last * 3, i4 = i * 4, l4 = last * 4;
    this.pos[i3] = this.pos[l3]; this.pos[i3 + 1] = this.pos[l3 + 1]; this.pos[i3 + 2] = this.pos[l3 + 2];
    this.vel[i3] = this.vel[l3]; this.vel[i3 + 1] = this.vel[l3 + 1]; this.vel[i3 + 2] = this.vel[l3 + 2];
    this.col[i4] = this.col[l4]; this.col[i4 + 1] = this.col[l4 + 1]; this.col[i4 + 2] = this.col[l4 + 2]; this.col[i4 + 3] = this.col[l4 + 3];
    this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
    this.s0[i] = this.s0[last]; this.s1[i] = this.s1[last]; this.a0[i] = this.a0[last];
    this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last]; this.size[i] = this.size[last];
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= k;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt;
      this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * (1 - t) * (1 - t * 0.3);
    }
    this.geo.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aSize.needsUpdate = true;
    }
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  setScale(px) { this.mat.uniforms.uScale.value = px; }
}

// ---------------------------------------------------------------------------
// Tracers: instanced glowing streaks flying at bullet speed.
// ---------------------------------------------------------------------------
export class Tracers {
  constructor(scene, max = 48) {
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    this.max = max;
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({ on: false, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 1, dist: 0, head: 0, skip: 0, speed: 0, len: 0, w: 0, r: 1, g: 1, b: 1 });
      this.mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    this.cursor = 0;
    this.dummy = new THREE.Object3D();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.zero);
    this.v = new THREE.Vector3();
    this.z = new THREE.Vector3(0, 0, 1);
    this.c = new THREE.Color();
    scene.add(this.mesh);
  }

  spawn(sx, sy, sz, ex, ey, ez, color, speed = 380, len = 7, w = 0.035, skip = 0) {
    const t = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    let dx = ex - sx, dy = ey - sy, dz = ez - sz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.5) return;
    dx /= d; dy /= d; dz /= d;
    t.on = true;
    t.sx = sx; t.sy = sy; t.sz = sz;
    t.dx = dx; t.dy = dy; t.dz = dz;
    t.dist = d; t.head = skip; t.skip = skip; t.speed = speed; t.len = len; t.w = w;
    t.r = color[0]; t.g = color[1]; t.b = color[2];
  }

  update(dt) {
    const dm = this.dummy;
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      const t = this.items[i];
      if (!t.on) continue;
      dirty = true;
      t.head += t.speed * dt;
      const tail = Math.max(t.skip, t.head - t.len);
      if (tail >= t.dist) {
        t.on = false;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      const h = Math.min(t.head, t.dist);
      dm.position.set(t.sx + t.dx * tail, t.sy + t.dy * tail, t.sz + t.dz * tail);
      this.v.set(t.dx, t.dy, t.dz);
      dm.quaternion.setFromUnitVectors(this.z, this.v);
      dm.scale.set(t.w, t.w, Math.max(0.01, h - tail));
      dm.updateMatrix();
      this.mesh.setMatrixAt(i, dm.matrix);
      const fade = 1 - (tail / t.dist) * 0.6;
      this.c.setRGB(t.r * fade, t.g * fade, t.b * fade);
      this.mesh.setColorAt(i, this.c);
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    for (let i = 0; i < this.max; i++) {
      this.items[i].on = false;
      this.mesh.setMatrixAt(i, this.zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Bullet-hole decals: ring buffer of instanced quads.
// ---------------------------------------------------------------------------
export class Decals {
  constructor(scene, tex, max = 140) {
    const m = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.max = max;
    this.cursor = 0;
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.zero);
    this.dummy = new THREE.Object3D();
    this.t = new THREE.Vector3();
    scene.add(this.mesh);
  }

  add(x, y, z, nx, ny, nz, size) {
    const d = this.dummy;
    d.position.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
    this.t.set(d.position.x + nx, d.position.y + ny, d.position.z + nz);
    d.up.set(Math.abs(ny) > 0.9 ? 1 : 0, Math.abs(ny) > 0.9 ? 0 : 1, 0);
    d.lookAt(this.t);
    d.rotateZ(rand(0, TAU));
    d.scale.setScalar(size);
    d.updateMatrix();
    this.mesh.setMatrixAt(this.cursor, d.matrix);
    this.cursor = (this.cursor + 1) % this.max;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this.zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Brass casings with bounce physics.
// ---------------------------------------------------------------------------
export class Casings {
  constructor(scene, envMap, max = 40) {
    const m = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.85, roughness: 0.3, envMap });
    const g = new THREE.CylinderGeometry(0.0065, 0.0065, 0.028, 6);
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.max = max;
    this.cursor = 0;
    this.items = [];
    for (let i = 0; i < max; i++) this.items.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0, bounced: 0, scale: 1 });
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.zero);
    this.dummy = new THREE.Object3D();
    scene.add(this.mesh);
  }

  spawn(p, v, scale = 1) {
    const c = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    c.on = true;
    c.p.copy(p);
    c.v.copy(v);
    c.r.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
    c.w.set(rand(-25, 25), rand(-25, 25), rand(-25, 25));
    c.life = 2.2;
    c.bounced = 0;
    c.scale = scale;
  }

  update(dt, col, audio, camPos) {
    const d = this.dummy;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const c = this.items[i];
      if (!c.on) continue;
      any = true;
      c.life -= dt;
      if (c.life <= 0) {
        c.on = false;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      c.v.y -= 18 * dt;
      c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt;
      c.r.y += c.w.y * dt;
      c.r.z += c.w.z * dt;
      const g = col.groundHeight(c.p.x, c.p.z, 0.01, c.p.y + 0.06);
      if (c.p.y < g + 0.007 && c.v.y < 0) {
        c.p.y = g + 0.007;
        c.v.y *= -0.35;
        c.v.x *= 0.55;
        c.v.z *= 0.55;
        c.w.multiplyScalar(0.5);
        if (c.bounced < 2 && audio) audio.tink(c.p.distanceTo(camPos));
        c.bounced++;
      }
      d.position.copy(c.p);
      d.rotation.copy(c.r);
      d.scale.setScalar(c.scale);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.max; i++) {
      this.items[i].on = false;
      this.mesh.setMatrixAt(i, this.zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Effect presets built on the pools above.
// ---------------------------------------------------------------------------
export class FX {
  constructor(scene, tex, envMap) {
    this.add = new Particles(scene, 900, true);
    this.alpha = new Particles(scene, 700, false);
    this.tracers = new Tracers(scene, 56);
    this.decals = new Decals(scene, tex.hole, 160);
    this.casings = new Casings(scene, envMap, 44);
    this.budget = 1;
  }

  setQuality(level) { this.budget = level === 'low' ? 0.55 : level === 'med' ? 0.8 : 1; }

  n(base) { return Math.max(1, Math.round(base * this.budget)); }

  impact(x, y, z, nx, ny, nz, surf) {
    const sparks = surf === 'metal' ? 10 : surf === 'wood' ? 2 : 6;
    for (let i = 0; i < this.n(sparks); i++) {
      const s = rand(3, 9);
      this.add.emit(x, y, z, (nx + rand(-0.7, 0.7)) * s, (ny + rand(-0.3, 0.9)) * s, (nz + rand(-0.7, 0.7)) * s,
        rand(0.12, 0.3), rand(0.05, 0.08), 0.01, 4.0, 2.4, 0.9, 1, 16, 2.5);
    }
    this.add.emit(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, 0, 0, 0, 0.06, 0.45, 0.2, 3.5, 2.2, 1.0, 1, 0, 0);
    const dust = surf === 'wood' ? [0.42, 0.3, 0.18] : surf === 'metal' ? [0.35, 0.35, 0.36] : [0.62, 0.58, 0.52];
    for (let i = 0; i < this.n(4); i++) {
      const s = rand(0.6, 2.2);
      this.alpha.emit(x + nx * 0.08, y + ny * 0.08, z + nz * 0.08, (nx + rand(-0.5, 0.5)) * s, (ny + rand(0, 0.6)) * s + 0.4, (nz + rand(-0.5, 0.5)) * s,
        rand(0.5, 1.0), rand(0.12, 0.22), rand(0.6, 1.0), dust[0], dust[1], dust[2], 0.55, -0.3, 2.2);
    }
    if (surf === 'wood') {
      for (let i = 0; i < this.n(5); i++) {
        const s = rand(2, 5);
        this.alpha.emit(x, y, z, (nx + rand(-0.6, 0.6)) * s, (ny + rand(0, 1)) * s, (nz + rand(-0.6, 0.6)) * s,
          rand(0.4, 0.8), 0.05, 0.04, 0.35, 0.22, 0.1, 1, 14, 0.5);
      }
    }
  }

  blood(x, y, z, dx, dy, dz, head) {
    const n = this.n(head ? 16 : 9);
    for (let i = 0; i < n; i++) {
      const s = rand(1.5, head ? 6 : 4);
      this.alpha.emit(x, y, z, (dx + rand(-0.6, 0.6)) * s, (dy + rand(-0.2, 0.9)) * s, (dz + rand(-0.6, 0.6)) * s,
        rand(0.3, 0.7), rand(0.05, 0.09), 0.03, 0.42, 0.02, 0.02, 1, 14, 1);
    }
    for (let i = 0; i < this.n(4); i++) {
      this.alpha.emit(x, y, z, dx * rand(0.5, 1.5) + rand(-0.4, 0.4), rand(0, 0.6), dz * rand(0.5, 1.5) + rand(-0.4, 0.4),
        rand(0.4, 0.8), 0.15, rand(0.5, 0.8), 0.3, 0.02, 0.02, 0.6, 0, 3);
    }
  }

  muzzle(x, y, z, dx, dy, dz, big, firstPerson = false) {
    if (firstPerson) {
      // The view-model already draws the flash; only add light smoke drifting off the barrel.
      for (let i = 0; i < this.n(1); i++) {
        this.alpha.emit(x + dx * 0.4, y + dy * 0.4, z + dz * 0.4, dx * 0.8 + rand(-0.2, 0.2), rand(0.2, 0.5), dz * 0.8 + rand(-0.2, 0.2), rand(0.3, 0.5), 0.05, 0.22, 0.8, 0.78, 0.75, 0.12, -0.3, 2.5);
      }
      return;
    }
    this.add.emit(x, y, z, 0, 0, 0, 0.05, big ? 0.9 : 0.6, 0.3, 4.5, 2.6, 1.0, 1, 0, 0);
    for (let i = 0; i < this.n(3); i++) {
      const s = rand(4, 10);
      this.add.emit(x, y, z, (dx + rand(-0.3, 0.3)) * s, (dy + rand(-0.3, 0.3)) * s, (dz + rand(-0.3, 0.3)) * s, rand(0.05, 0.12), 0.06, 0.01, 4, 2.2, 0.8, 1, 0, 3);
    }
    for (let i = 0; i < this.n(2); i++) {
      this.alpha.emit(x, y, z, dx * 1.5 + rand(-0.3, 0.3), dy * 1.5 + rand(0, 0.5), dz * 1.5 + rand(-0.3, 0.3), rand(0.4, 0.8), 0.15, 0.7, 0.75, 0.73, 0.7, 0.3, -0.4, 2.5);
    }
  }

  glint(x, y, z) {
    this.add.emit(x, y, z, 0, 0, 0, 0.12, 1.4, 0.5, 6, 4.5, 3, 1, 0, 0);
  }

  pickupBurst(x, y, z, c) {
    for (let i = 0; i < this.n(18); i++) {
      const a = rand(0, TAU), s = rand(1.5, 4);
      this.add.emit(x, y, z, Math.cos(a) * s, rand(1, 4), Math.sin(a) * s, rand(0.3, 0.6), 0.12, 0.02, c[0] * 3, c[1] * 3, c[2] * 3, 1, 6, 1.5);
    }
  }

  deathPuff(x, y, z) {
    for (let i = 0; i < this.n(8); i++) {
      this.alpha.emit(x + rand(-0.4, 0.4), y + rand(0, 0.4), z + rand(-0.4, 0.4), rand(-0.6, 0.6), rand(0.2, 0.8), rand(-0.6, 0.6),
        rand(0.8, 1.4), 0.3, 1.2, 0.55, 0.52, 0.48, 0.35, -0.2, 1.5);
    }
  }

  update(dt, col, audio, camPos) {
    this.add.update(dt);
    this.alpha.update(dt);
    this.tracers.update(dt);
    this.casings.update(dt, col, audio, camPos);
  }

  clear() {
    this.add.clear();
    this.alpha.clear();
    this.tracers.clear();
    this.decals.clear();
    this.casings.clear();
  }

  setScale(px) {
    this.add.setScale(px);
    this.alpha.setScale(px);
  }
}
