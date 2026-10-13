import * as THREE from 'three';
import { Body, moveBody } from './physics.js';
import { clamp, damp, dampAngle, rand, randInt, TAU } from './utils.js';
import { rayBox } from './world.js';

export const KINDS = {
  gunner: { hp: 100, speed: 3.7, range: 60, pref: 22, acc: 0.18, dmg: 6, burst: [2, 4], rate: 0.13, pause: [1.4, 2.4], react: 0.9, sound: 'enemy', score: 100, jacket: '#2f6b3a', pants: '#2b3648', crew: '#3ddc84', gun: 0.62 },
  rusher: { hp: 75, speed: 5.6, range: 28, pref: 7, acc: 0.2, dmg: 5, burst: [4, 6], rate: 0.09, pause: [1.0, 1.6], react: 0.6, sound: 'esmg', score: 120, jacket: '#5b2a86', pants: '#1f1f24', crew: '#c77dff', gun: 0.42 },
  sniper: { hp: 80, speed: 1.6, range: 160, pref: 999, acc: 0.5, dmg: 24, burst: [1, 1], rate: 0.1, pause: [3.5, 4.5], react: 1.5, sound: 'esniper', score: 150, jacket: '#7a1f1f', pants: '#2b2b2b', crew: '#ff4d4d', gun: 0.95 },
};
// Gang 0 is the player's crew. Colors drive the jacket, bandana and pants.
export const GANGS = [
  { name: 'BLUE', jacket: '#1f4fa8', crew: '#4fa8ff', pants: '#22283a', css: '#4fa8ff' },
  { name: 'GREEN', jacket: '#2f6b3a', crew: '#3ddc84', pants: '#2b3648', css: '#3ddc84' },
  { name: 'PURPLE', jacket: '#5b2a86', crew: '#c77dff', pants: '#1f1f24', css: '#c77dff' },
  { name: 'RED', jacket: '#8a1f1f', crew: '#ff4d4d', pants: '#2b2b2b', css: '#ff5a5a' },
];
const SKIN = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#5c3a21', '#a86b3c'];
const _col = new THREE.Color();

function parts(list) {
  let count = 0;
  const geos = list.map((p) => {
    const g = new THREE.BoxGeometry(p[0], p[1], p[2]).toNonIndexed();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p[3], p[4], p[5]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(p[7] || 0, p[8] || 0, p[9] || 0)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    _col.set(p[6]);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    count += n;
    return g;
  });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o);
    nor.set(g.attributes.normal.array, o);
    col.set(g.attributes.color.array, o);
    o += g.attributes.position.array.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// Upper body (pivot at hips, y=0.95). Faces +Z.
function upperGeo(kind, gang, skin, armored) {
  const K = { ...KINDS[kind], ...GANGS[gang] };
  const L = K.gun;
  const list = [
    [0.5, 0.6, 0.28, 0, 0.32, 0, K.jacket],
    [0.44, 0.14, 0.26, 0, 0.0, 0, K.pants],
    [0.11, 0.08, 0.11, 0, 0.66, 0, skin],
    [0.24, 0.27, 0.25, 0, 0.82, 0, skin],
    [0.26, 0.09, 0.27, 0, 0.96, 0, K.crew],
    [0.22, 0.03, 0.12, 0, 0.93, 0.17, K.crew],
    [0.2, 0.04, 0.02, 0, 0.84, 0.13, '#111111'],
    // Right arm to the grip.
    [0.13, 0.32, 0.13, 0.3, 0.44, 0.06, K.jacket, -0.55, 0, 0.12],
    [0.11, 0.3, 0.11, 0.24, 0.34, 0.27, K.jacket, -1.35, 0, 0],
    [0.1, 0.1, 0.1, 0.11, 0.35, 0.42, skin],
    // Left arm to the handguard.
    [0.13, 0.32, 0.13, -0.3, 0.44, 0.08, K.jacket, -0.7, 0, -0.15],
    [0.11, 0.3, 0.11, -0.17, 0.38, 0.33, K.jacket, -1.4, 0.5, 0],
    [0.1, 0.1, 0.1, -0.02, 0.37, 0.52 + (L - 0.62) * 0.4, skin],
    // Weapon.
    [0.07, 0.1, L, 0.06, 0.38, 0.3 + L / 2, '#1b1c1f'],
    [0.05, 0.15, 0.07, 0.06, 0.27, 0.45, '#2a2b2f'],
    [0.03, 0.03, 0.2, 0.06, 0.4, 0.3 + L + 0.08, '#111214'],
  ];
  if (kind === 'sniper') list.push([0.05, 0.05, 0.22, 0.06, 0.47, 0.5, '#202226']);
  if (armored) {
    list.push([0.56, 0.48, 0.34, 0, 0.36, 0, '#4a5038']);
    list.push([0.3, 0.12, 0.05, 0, 0.42, 0.18, '#353a28']);
  }
  return parts(list);
}

function legGeo(gang) {
  const K = GANGS[gang];
  return parts([
    [0.18, 0.86, 0.2, 0, -0.43, 0, K.pants],
    [0.19, 0.1, 0.3, 0, -0.9, 0.05, '#e8e8e8'],
  ]);
}

// ---------------------------------------------------------------------------
class Enemy {
  constructor(scene, pool) {
    this.pool = pool;
    this.body = new Body(0.32, 1.75);
    this.body.stepH = 0.45;
    this.root = new THREE.Group();
    this.pose = new THREE.Group();
    this.root.add(this.pose);
    // Transform-only hierarchy: the pool draws every bot through shared InstancedMeshes.
    this.upper = new THREE.Object3D();
    this.upper.position.y = 0.95;
    this.legL = new THREE.Object3D();
    this.legR = new THREE.Object3D();
    this.legL.position.set(-0.12, 0.95, 0);
    this.legR.position.set(0.12, 0.95, 0);
    this.pose.add(this.upper, this.legL, this.legR);
    this.variant = 0;
    this.armorIdx = 0;
    this.hasToken = false;
    this.tokenT = 0;
    this.tokenCd = 0;
    this.lodAcc = 0;
    this.active = false;
    this.alive = false;
    this.muzzleLocal = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.wp = { x: 0, y: 0, z: 0 };
  }

  spawn(kind, x, y, z, roof, wave, armored, team = 1, gang = 1) {
    const K = KINDS[kind];
    this.kind = kind;
    this.team = team;
    this.gang = gang;
    this.target = null;
    this.targetIsPlayer = team !== 0;
    this.targetT = rand(0, 0.5);
    this.killer = null;
    this.K = K;
    this.roof = roof;
    this.variant = randInt(0, this.pool.geos[gang][kind].length - 1);
    this.armorIdx = armored ? 1 : 0;
    this.hasToken = false;
    this.tokenCd = rand(0, 2);
    this.lodAcc = 0;
    this.maxHp = this.hp = K.hp + (armored ? 60 : 0) + wave * 4;
    this.armored = armored;
    this.body.pos.set(x, y, z);
    this.body.vel.set(0, 0, 0);
    this.body.grounded = true;
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, rand(0, TAU), 0);
    this.pose.rotation.set(0, 0, 0);
    this.pose.position.set(0, 0, 0);
    this.upper.rotation.set(0, 0, 0);
    this.root.scale.setScalar(1);
    this.root.visible = true;
    this.active = true;
    this.alive = true;
    this.deadT = 0;
    this.flash = 0;
    this.flinch = 0;
    this.los = false;
    this.losT = rand(0, 0.3);
    this.aimT = 0;
    this.burstLeft = 0;
    this.shotCd = rand(0.5, 1.5);
    this.walkT = rand(0, TAU);
    this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = rand(1, 3);
    this.stuckT = 0;
    this.lastX = x;
    this.lastZ = z;
    this.navT = 0;
    this.glintT = 0;
    this.wave = wave;
    this.accScale = Math.min(1.6, 1 + wave * 0.06);
    this.dmgScale = Math.min(1.8, 1 + wave * 0.05);
    this.yaw = this.root.rotation.y;
    this.fallDir = 0;
    this.muzzleLocal.set(0.06, 0.4 + 0.95, 0.3 + K.gun + 0.18);
    this.sinceSeen = 99;
    this.backT = 0;
    this.perchT = rand(35, 70);
  }

  despawn() {
    if (this.hasToken) this.pool.releaseToken(this);
    this.active = false;
    this.alive = false;
    this.root.visible = false;
  }

  takeDamage(amount, head, dx, dz, game, attacker = null) {
    if (!this.alive) return false;
    // Getting shot pulls attention onto the shooter.
    if (attacker && attacker.alive && attacker.team !== this.team && Math.random() < 0.6) {
      this.target = attacker;
      this.targetIsPlayer = false;
      this.targetT = rand(1.5, 3);
    }
    this.hp -= amount;
    this.flash = 1;
    this.flinch = Math.min(1, this.flinch + (head ? 1 : 0.6));
    this.aimT = Math.max(0, this.aimT - 0.25);
    this.sinceSeen = 0;
    if (this.hp <= 0) {
      if (this.hasToken) this.pool.releaseToken(this);
      this.alive = false;
      this.killer = attacker;
      this.deadT = 0;
      this.fallDir = Math.atan2(-dx, -dz);
      this.root.rotation.y = this.fallDir;
      game.fx.deathPuff(this.body.pos.x, this.body.pos.y + 0.3, this.body.pos.z);
      return true;
    }
    return false;
  }

  muzzleWorld(out) {
    this.root.updateMatrixWorld(true);
    return out.copy(this.muzzleLocal).applyMatrix4(this.root.matrixWorld);
  }

  update(dt, g) {
    const b = this.body;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.flinch = Math.max(0, this.flinch - dt * 4);

    if (!this.alive) {
      this.deadT += dt;
      const k = clamp(this.deadT / 0.55, 0, 1);
      const e = k < 1 ? 1 - Math.pow(1 - k, 3) : 1;
      const bounce = k >= 1 ? Math.sin(clamp((this.deadT - 0.55) / 0.25, 0, 1) * Math.PI) * 0.06 : 0;
      this.pose.rotation.x = -(Math.PI / 2) * e + bounce;
      this.pose.position.y = 0.05 * e;
      const slide = Math.min(this.deadT, 0.4) * 1.2;
      this.root.position.set(b.pos.x - Math.sin(this.fallDir) * slide, b.pos.y, b.pos.z - Math.cos(this.fallDir) * slide);
      this.legL.rotation.x = 0.3 * e;
      this.legR.rotation.x = -0.2 * e;
      if (this.deadT > 5) this.root.position.y = b.pos.y - (this.deadT - 5) * 0.6;
      if (this.deadT > 6) this.despawn();
      return;
    }

    // Pick the nearest hostile: a rival gang member, or the player if we're not on their crew.
    this.targetT -= dt;
    if (this.targetT <= 0 || (this.targetIsPlayer ? g.player.dead : !(this.target && this.target.alive))) {
      this.targetT = rand(0.5, 0.9);
      this.pickTarget(g);
    }
    const tp = this.targetIsPlayer ? g.player.body.pos : this.target ? this.target.body.pos : null;
    const P = tp || b.pos;
    const dx = P.x - b.pos.x, dz = P.z - b.pos.z, dy = P.y - b.pos.y;
    const dist = tp ? Math.hypot(dx, dz) : 999;
    const K = this.K;
    this.sinceSeen += dt;

    // Line of sight (staggered).
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.22 + Math.random() * 0.12;
      this.los = !!tp && dist < K.range * 1.2 && g.lineOfSight(b.pos.x, b.pos.y + 1.6, b.pos.z, P.x, P.y + 1.5, P.z);
      if (this.los) this.sinceSeen = 0;
    }

    // Never let a round stall: a rival that can't find an angle on the player for too long repositions.
    if (this.targetIsPlayer && !this.los && this.sinceSeen > (this.roof ? 10 : 16)) {
      this.sinceSeen = 0;
      if (g.relocateEnemy(this)) return;
    }
    // Gang War: a rooftop shooter with nothing to shoot heads down to the street.
    // Every perch is temporary so the war always resolves.
    if (this.roof && g.mode === 'gang') {
      this.perchT -= dt;
      if ((this.perchT <= 0 || (!this.los && this.sinceSeen > 14)) && g.dropToStreet(this)) {
        this.sinceSeen = 0;
        return;
      }
    }
    const field = g.fieldFor(this.team);

    // Facing.
    const wantYaw = Math.atan2(dx, dz);
    this.yaw = dampAngle(this.yaw, wantYaw, this.los ? 9 : 5, dt);
    this.root.rotation.y = this.yaw;
    const pitch = Math.atan2(dy + 0.2, Math.max(dist, 0.1));
    this.upper.rotation.x = damp(this.upper.rotation.x, -clamp(pitch, -0.9, 0.9), 8, dt) - this.flinch * 0.35;

    // Movement.
    let mx = 0, mz = 0, speed = K.speed;
    if (this.roof) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(1.2, 3); this.strafeSign *= -1; }
      const px = -dz / (dist || 1), pz = dx / (dist || 1);
      mx = px * this.strafeSign; mz = pz * this.strafeSign;
      speed = this.los ? K.speed : K.speed * 0.6;
      const nx = b.pos.x + mx * 0.8, nz = b.pos.z + mz * 0.8;
      const R = this.roof;
      if (Math.abs(nx - R.x) > R.rx || Math.abs(nz - R.z) > R.rz) {
        this.strafeSign *= -1;
        mx = -mx; mz = -mz;
      }
    } else {
      const engage = this.los && dist < K.pref + (this.kind === 'rusher' ? 2 : 8);
      if (engage) {
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = rand(0.8, 2.2); this.strafeSign *= -1; }
        const px = -dz / (dist || 1), pz = dx / (dist || 1);
        mx = px * this.strafeSign; mz = pz * this.strafeSign;
        if (dist < K.pref * 0.6) { mx -= dx / dist * 0.7; mz -= dz / dist * 0.7; }
        speed *= 0.55;
      } else if (this.targetIsPlayer && (this.backT > 0 || (!this.los && this.sinceSeen > 2.5 && dist < 26 && field.pathDist(b.pos.x, b.pos.z) <= 4))) {
        // Hugging the base of the player's building with no angle: back off the wall to see the roof.
        if (this.backT <= 0) this.backT = rand(2, 3.5);
        this.backT -= dt;
        mx = -dx / (dist || 1) + (-dz / (dist || 1)) * this.strafeSign * 0.5;
        mz = -dz / (dist || 1) + (dx / (dist || 1)) * this.strafeSign * 0.5;
        if (this.los) this.backT = Math.min(this.backT, 0.4);
      } else {
        this.navT -= dt;
        if (field.next(b.pos.x, b.pos.z, this.wp)) {
          mx = this.wp.x - b.pos.x;
          mz = this.wp.z - b.pos.z;
        } else if (tp && dist > 1.5) {
          mx = dx; mz = dz;
        }
        const ml = Math.hypot(mx, mz);
        if (ml > 0.001) { mx /= ml; mz /= ml; }
        if (this.los && dist < K.range) speed *= 0.8;
      }
      // Separation.
      for (const o of this.pool.list) {
        if (o === this || !o.alive) continue;
        const ox = b.pos.x - o.body.pos.x, oz = b.pos.z - o.body.pos.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < 2.5 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          mx += (ox / d) * (1.6 - d) * 0.9;
          mz += (oz / d) * (1.6 - d) * 0.9;
        }
      }
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    b.vel.x = damp(b.vel.x, mx * speed, 8, dt);
    b.vel.z = damp(b.vel.z, mz * speed, 8, dt);
    moveBody(b, dt, g.world.col);
    if (this.roof) {
      const R = this.roof;
      b.pos.x = clamp(b.pos.x, R.x - R.rx, R.x + R.rx);
      b.pos.z = clamp(b.pos.z, R.z - R.rz, R.z + R.rz);
      if (b.pos.y < R.y - 0.5) { b.pos.y = R.y; b.vel.y = 0; }
    }

    // Stuck: hop.
    const moved = Math.hypot(b.pos.x - this.lastX, b.pos.z - this.lastZ);
    if (ml > 0.3 && moved < speed * dt * 0.25 && b.grounded) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 0.6) {
      b.vel.y = 7;
      b.grounded = false;
      this.stuckT = 0;
      this.strafeSign *= -1;
    }
    this.lastX = b.pos.x;
    this.lastZ = b.pos.z;

    // Animation.
    const sp = Math.hypot(b.vel.x, b.vel.z);
    this.walkT += dt * sp * 2.4;
    const swing = Math.sin(this.walkT) * 0.65 * clamp(sp / 3, 0, 1);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.upper.position.y = 0.95 + Math.abs(Math.cos(this.walkT)) * 0.04 * clamp(sp / 3, 0, 1);
    this.upper.rotation.z = Math.sin(this.walkT) * 0.04;
    this.root.position.copy(b.pos);

    // Combat.
    if (this.los && dist < K.range) {
      this.aimT += dt;
      if (this.kind === 'sniper' && this.aimT > K.react - 0.7 && this.shotCd < 0.7) {
        this.glintT -= dt;
        if (this.glintT <= 0) {
          this.glintT = 0.12;
          this.muzzleWorld(this.tmp);
          g.fx.glint(this.tmp.x, this.tmp.y + 0.08, this.tmp.z);
          if (this.shotCd > 0.55 && this.targetIsPlayer) g.audio.glint(dist, 0);
        }
      }
    } else {
      this.aimT = Math.max(0, this.aimT - dt * 0.5);
    }
    this.shotCd -= dt;
    // Attack tokens: only a few bots may shoot at the player at once; the rest maneuver.
    // Bot-vs-bot fights don't need tokens.
    const wantsFire = this.los && dist < K.range && this.aimT > K.react && (this.targetIsPlayer ? !g.player.dead : true);
    this.tokenCd -= dt;
    if (this.hasToken) {
      this.tokenT -= dt;
      if (!wantsFire || this.tokenT <= 0 || !this.targetIsPlayer) this.pool.releaseToken(this);
    } else if (wantsFire && this.targetIsPlayer && this.tokenCd <= 0) this.pool.requestToken(this);
    if (this.shotCd <= 0 && wantsFire && (this.hasToken || !this.targetIsPlayer)) {
      if (this.burstLeft <= 0) this.burstLeft = randInt(K.burst[0], K.burst[1]);
      this.fire(g, dist);
      this.burstLeft--;
      this.shotCd = this.burstLeft > 0 ? K.rate * rand(0.9, 1.2) : rand(K.pause[0], K.pause[1]);
    }
  }

  pickTarget(g) {
    const b = this.body.pos;
    let best = null, bestD = Infinity, isPlayer = false;
    if (this.team !== 0 && !g.player.dead) {
      const P = g.player.body.pos;
      bestD = Math.hypot(P.x - b.x, P.z - b.z) * 0.85;
      isPlayer = true;
    }
    // Street bots can't climb, so they hunt other street-level targets first; a target we
    // haven't seen for a while is dropped in favor of someone else.
    const stale = this.sinceSeen > 6 && !this.targetIsPlayer ? this.target : null;
    let roofBest = null, roofD = Infinity;
    for (const o of this.pool.list) {
      if (!o.alive || o.team === this.team || o === stale) continue;
      const d = Math.abs(o.body.pos.x - b.x) + Math.abs(o.body.pos.z - b.z);
      if (!this.roof && o.roof) {
        if (d < roofD) { roofD = d; roofBest = o; }
        continue;
      }
      if (d < bestD) { bestD = d; best = o; isPlayer = false; }
    }
    if (!best && !isPlayer && roofBest) best = roofBest;
    if (stale && best !== stale) this.sinceSeen = 0;
    this.target = best;
    this.targetIsPlayer = isPlayer;
  }

  fire(g, dist) {
    const K = this.K;
    if (!this.targetIsPlayer) {
      const t = this.target;
      const tv = Math.hypot(t.body.vel.x, t.body.vel.z);
      let acc = K.acc * 1.6 * this.accScale;
      acc *= dist < 10 ? 1.15 : clamp(1 - (dist - 10) / (K.range * 1.3), 0.3, 1);
      acc *= tv > 4 ? 0.7 : 1;
      acc *= Math.min(1, 0.45 + this.aimT / 2.2);
      const m = this.muzzleWorld(this.tmp);
      g.botShot(this, t, m, Math.random() < acc, dist, K.dmg * 1.8 * rand(0.85, 1.15));
      this.flinch = Math.min(1, this.flinch + 0.12);
      return;
    }
    const p = g.player;
    const pb = p.body;
    const psp = Math.hypot(pb.vel.x, pb.vel.z);
    let acc = K.acc * this.accScale;
    acc *= dist < 10 ? 1.15 : clamp(1 - (dist - 10) / (K.range * 1.3), 0.25, 1);
    acc *= psp > 6 ? 0.55 : psp > 2 ? 0.75 : 1;
    if (!pb.grounded) acc *= 0.6;
    acc *= Math.min(1, 0.45 + this.aimT / 2.2);
    if (p.mantle) acc *= 0.7;
    const hit = Math.random() < acc;
    const m = this.muzzleWorld(this.tmp);
    g.enemyShot(this, m, hit, dist, K.dmg * this.dmgScale * rand(0.85, 1.15));
    this.flinch = Math.min(1, this.flinch + 0.12);
  }
}

// ---------------------------------------------------------------------------
export class Enemies {
  constructor(scene, max = 14) {
    // geos[gang][kind][variant][armored]
    this.geos = GANGS.map((_, gang) => {
      const byKind = {};
      for (const kind of Object.keys(KINDS)) {
        byKind[kind] = [];
        for (let v = 0; v < 2; v++) {
          const skin = SKIN[(v * 3 + gang + kind.length) % SKIN.length];
          byKind[kind].push([upperGeo(kind, gang, skin, false), upperGeo(kind, gang, skin, true)]);
        }
      }
      return byKind;
    });
    this.legs = GANGS.map((_, gang) => legGeo(gang));
    this.list = [];
    for (let i = 0; i < max; i++) this.list.push(new Enemy(scene, this));
    this.maxTokens = 99;
    this.tokens = 0;
    this.frame = 0;
    // One InstancedMesh per body-part geometry: draw calls stay flat no matter how many bots.
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.ims = [];
    const white = new THREE.Color(1, 1, 1);
    const mk = (geo, cap) => {
      const im = new THREE.InstancedMesh(geo, this.mat, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < cap; i++) im.setColorAt(i, white);
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = false;
      im.frustumCulled = false;
      im.userData.n = 0;
      scene.add(im);
      this.ims.push(im);
      return im;
    };
    this.upperIM = this.geos.map((byKind) => {
      const o = {};
      for (const kind of Object.keys(byKind)) o[kind] = byKind[kind].map((pair) => pair.map((geo) => mk(geo, max)));
      return o;
    });
    this.legIM = this.legs.map((geo) => mk(geo, max * 2));
    // Floating blue diamonds mark the player's crew.
    this.marker = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.13, 0).scale(1, 1.4, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 1.8, 4), fog: false }), max);
    this.marker.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marker.count = 0;
    this.marker.frustumCulled = false;
    scene.add(this.marker);
    this._dummy = new THREE.Object3D();
    this.time = 0;
    this._c = new THREE.Color();
    this.hitInfo = { e: null, t: 0, head: false, x: 0, y: 0, z: 0 };
    this._box = { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }

  get activeCount() {
    let n = 0;
    for (const e of this.list) if (e.active) n++;
    return n;
  }

  spawn(kind, x, y, z, roof, wave, armored, team = 1, gang = 1) {
    const e = this.list.find((q) => !q.active);
    if (!e) return null;
    e.spawn(kind, x, y, z, roof, wave, armored, team, gang);
    return e;
  }

  countTeam(team) {
    let n = 0;
    for (const e of this.list) if (e.alive && e.team === team) n++;
    return n;
  }

  get hostileCount() {
    let n = 0;
    for (const e of this.list) if (e.alive && e.team !== 0) n++;
    return n;
  }

  requestToken(e) {
    if (this.tokens >= this.maxTokens) return false;
    this.tokens++;
    e.hasToken = true;
    e.tokenT = rand(3, 6);
    return true;
  }

  releaseToken(e) {
    if (!e.hasToken) return;
    e.hasToken = false;
    this.tokens = Math.max(0, this.tokens - 1);
    e.tokenCd = rand(1.5, 3.5);
  }

  update(dt, g) {
    this.frame++;
    this.time += dt;
    const P = g.player.body.pos;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.active) continue;
      // Distant live bots think at a third of the rate to save CPU on large battles.
      const far = e.alive && Math.abs(e.body.pos.x - P.x) + Math.abs(e.body.pos.z - P.z) > 110;
      if (far) {
        e.lodAcc += dt;
        if ((this.frame + i) % 3 !== 0) continue;
        e.update(Math.min(e.lodAcc, 0.15), g);
        e.lodAcc = 0;
      } else e.update(dt, g);
    }
  }

  render() {
    for (const im of this.ims) im.userData.n = 0;
    const c = this._c;
    const put = (im, m) => {
      const n = im.userData.n++;
      im.setMatrixAt(n, m);
      im.setColorAt(n, c);
    };
    for (const e of this.list) {
      if (!e.active) continue;
      e.root.updateMatrixWorld(true);
      const f = e.flash;
      c.setRGB(1 + f * 2.5, 1 - f * 0.4, 1 - f * 0.45);
      put(this.upperIM[e.gang][e.kind][e.variant][e.armorIdx], e.upper.matrixWorld);
      const legs = this.legIM[e.gang];
      put(legs, e.legL.matrixWorld);
      put(legs, e.legR.matrixWorld);
    }
    let m = 0;
    const d = this._dummy;
    for (const e of this.list) {
      if (!e.alive || e.team !== 0) continue;
      d.position.set(e.body.pos.x, e.body.pos.y + 2.3 + Math.sin(this.time * 3 + e.walkT) * 0.06, e.body.pos.z);
      d.rotation.set(0, this.time * 2, 0);
      d.updateMatrix();
      this.marker.setMatrixAt(m++, d.matrix);
    }
    this.marker.count = m;
    this.marker.visible = m > 0;
    if (m) this.marker.instanceMatrix.needsUpdate = true;
    for (const im of this.ims) {
      im.count = im.userData.n;
      im.visible = im.count > 0;
      if (im.count > 0) {
        im.instanceMatrix.needsUpdate = true;
        im.instanceColor.needsUpdate = true;
      }
    }
  }

  clear() {
    for (const e of this.list) e.despawn();
    this.tokens = 0;
  }

  // Ray vs every live enemy (head sphere + body box). Returns hitInfo or null.
  raycast(o, d, maxT) {
    let best = maxT, hitE = null, head = false;
    const B = this._box;
    for (const e of this.list) {
      if (!e.alive || e.team === 0) continue;
      const p = e.body.pos;
      const cx = p.x - o.x, cy = p.y + 0.9 - o.y, cz = p.z - o.z;
      const t = cx * d.x + cy * d.y + cz * d.z;
      if (t < 0 || t > best + 1.5) continue;
      const d2 = cx * cx + cy * cy + cz * cz - t * t;
      if (d2 > 1.6) continue;
      // Head sphere (slightly forward of center, follows facing).
      const hx = p.x + Math.sin(e.yaw) * 0.02 - o.x, hy = p.y + 1.77 - o.y, hz = p.z + Math.cos(e.yaw) * 0.02 - o.z;
      const tb = hx * d.x + hy * d.y + hz * d.z;
      const hd2 = hx * hx + hy * hy + hz * hz - tb * tb;
      const r = 0.17;
      if (hd2 < r * r) {
        const th = tb - Math.sqrt(r * r - hd2);
        if (th > 0 && th < best) { best = th; hitE = e; head = true; }
      }
      B.x0 = p.x - 0.3; B.x1 = p.x + 0.3; B.y0 = p.y; B.y1 = p.y + 1.62; B.z0 = p.z - 0.3; B.z1 = p.z + 0.3;
      const tt = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, B);
      if (tt >= 0 && tt < best) { best = tt; hitE = e; head = false; }
    }
    if (!hitE) return null;
    const h = this.hitInfo;
    h.e = hitE; h.t = best; h.head = head;
    h.x = o.x + d.x * best; h.y = o.y + d.y * best; h.z = o.z + d.z * best;
    return h;
  }
}

