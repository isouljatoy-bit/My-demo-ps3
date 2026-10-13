import * as THREE from 'three';
import { Body, moveBody, isClear } from './physics.js';
import { clamp, damp, lerp, rand, wrapAngle } from './utils.js';

const WALK = 5.2, SPRINT = 7.8, ADS_SPEED = 3.0, JUMP_V = 7.6;
const EYE = 1.62;

export class Player {
  constructor(game) {
    this.g = game;
    this.body = new Body(0.35, 1.75);
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._t = [];
    this.reset(0, 0, 0, 0);
  }

  reset(x, y, z, yaw) {
    this.body.pos.set(x, y, z);
    this.body.vel.set(0, 0, 0);
    this.body.grounded = false;
    this.yaw = yaw;
    this.pitch = -0.08;
    this.recoilP = 0;
    this.recoilY = 0;
    this.recoverRate = 8;
    this.health = 100;
    this.armor = 25;
    this.dead = false;
    this.eyeOffset = 0;
    this.landDip = 0;
    this.landVel = 0;
    this.bobT = 0;
    this.stepT = 0;
    this.sprinting = false;
    this.mantle = null;
    this.shake = 0;
    this.fovPunch = 0;
    this.hurtT = 0;
    this.sinceHurt = 99;
    this.lean = 0;
    this.airTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.lastSafe = new THREE.Vector3(x, y, z);
    this.spawnProtect = 0;
  }

  addRecoil(v, h, perm, rec) {
    this.pitch += v * perm;
    this.yaw += h * perm;
    this.recoilP += v * (1 - perm);
    this.recoilY += h * (1 - perm);
    this.recoverRate = rec;
  }

  damage(amount, fromX, fromZ) {
    if (this.dead || this.spawnProtect > 0) return;
    const absorbed = Math.min(this.armor, amount * 0.66);
    this.armor -= absorbed;
    this.health -= amount - absorbed;
    this.hurtT = Math.min(1, this.hurtT + amount / 35);
    this.sinceHurt = 0;
    this.shake = Math.min(1, this.shake + 0.25);
    this.recoilP += rand(-0.012, 0.02);
    this.recoilY += rand(-0.02, 0.02);
    const g = this.g;
    g.audio.hurt();
    const dx = fromX - this.body.pos.x, dz = fromZ - this.body.pos.z;
    const rx = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw);
    const rz = dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw);
    g.hud.damageFrom(Math.atan2(rx, -rz));
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      g.onPlayerDeath();
    }
  }

  heal(hp, ar) {
    this.health = Math.min(100, this.health + hp);
    this.armor = Math.min(100, this.armor + ar);
  }

  update(dt, inp, weapons) {
    const b = this.body, g = this.g;
    // Look (touch sensitivity scales with zoom so ADS feels precise).
    const fovScale = g.camera.fov / g.baseFov;
    let sens = g.settings.sens * fovScale;
    if (g.aimAssist.onTarget) sens *= g.aimAssist.friction;
    const look = inp.takeLook();
    this.yaw -= look.x * sens * (inp.lookIsMouse ? 0.0022 : 0.0052);
    this.pitch -= look.y * sens * (inp.lookIsMouse ? 0.0022 : 0.0052);
    this.yaw += g.aimAssist.pullYaw;
    this.pitch += g.aimAssist.pullPitch;
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this.yaw = wrapAngle(this.yaw);

    // Recoil recovery.
    const rr = 1 - Math.exp(-this.recoverRate * dt);
    this.recoilP -= this.recoilP * rr;
    this.recoilY -= this.recoilY * rr;

    if (this.mantle) {
      this.updateMantle(dt);
      return;
    }

    // Movement intent.
    const mv = inp.move;
    const f = this._f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = this._r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let wx = f.x * mv.y + r.x * mv.x, wz = f.z * mv.y + r.z * mv.x;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    const wantSprint = inp.sprint && mv.y > 0.5 && weapons.adsT < 0.2 && weapons.reloadT <= 0;
    if (wantSprint && !inp.fire) this.sprinting = true;
    if (!wantSprint || mv.y < 0.3) this.sprinting = false;
    const speed = weapons.adsT > 0.5 ? lerp(WALK, ADS_SPEED, weapons.adsT) : this.sprinting ? SPRINT : WALK;

    const accel = b.grounded ? 14 : 3.2;
    b.vel.x = damp(b.vel.x, wx * speed, accel, dt);
    b.vel.z = damp(b.vel.z, wz * speed, accel, dt);

    // Jump with coyote time and input buffer.
    if (inp.consume('jump')) this.jumpBuffer = 0.15;
    this.jumpBuffer -= dt;
    this.coyote = b.grounded ? 0.1 : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      b.vel.y = JUMP_V;
      b.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      g.audio.jump();
    }

    const wasGrounded = b.grounded;
    const steps = dt > 1 / 45 ? 2 : 1;
    for (let i = 0; i < steps; i++) moveBody(b, dt / steps, g.world.col);

    // Landing feedback.
    if (b.landSpeed > 3) {
      this.landVel -= Math.min(b.landSpeed, 22) * 0.045;
      if (b.landSpeed > 6) g.audio.land(b.landSpeed);
      this.shake = Math.min(1, this.shake + Math.min(0.4, b.landSpeed * 0.02));
    }
    if (b.stepDelta > 0 && wasGrounded) this.eyeOffset -= b.stepDelta;
    else if (b.stepDelta < 0 && wasGrounded) this.eyeOffset -= b.stepDelta;
    this.eyeOffset = damp(this.eyeOffset, 0, 16, dt);
    this.eyeOffset = clamp(this.eyeOffset, -0.6, 0.6);

    // Ledge mantle: push into a ledge up to ~1.7m high while moving forward.
    if (b.blocked && mv.y > 0.4 && (!b.grounded || this.jumpBuffer > -0.3 || inp.jumpHeld)) this.tryMantle(b.blocked, f);

    // Landing spring.
    this.landVel += (-90 * this.landDip - 11 * this.landVel) * dt;
    this.landDip += this.landVel * dt;

    // Head bob + footsteps.
    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (b.grounded && sp > 0.8) {
      this.bobT += dt * sp * 1.55;
      this.stepT += dt * sp;
      const stride = this.sprinting ? 2.5 : 2.0;
      if (this.stepT > stride) {
        this.stepT = 0;
        g.audio.step(this.sprinting, g.world.col.surfaceAt(b.pos.x, b.pos.z, b.pos.y));
      }
    }
    this.lean = damp(this.lean, -mv.x * 0.025 + (this.sprinting ? 0 : 0), 6, dt);

    if (b.grounded) {
      this.airTime = 0;
      this.lastSafe.copy(b.pos);
    } else this.airTime += dt;

    // Out-of-world safety net.
    if (b.pos.y < -20) {
      b.pos.copy(this.lastSafe);
      b.vel.set(0, 0, 0);
    }

    this.sinceHurt += dt;
    this.spawnProtect = Math.max(0, this.spawnProtect - dt);
    this.hurtT = Math.max(0, this.hurtT - dt * 0.9);
    if (this.sinceHurt > 5 && this.health < 100 && !this.dead) this.health = Math.min(100, this.health + dt * 7);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.fovPunch = damp(this.fovPunch, 0, 10, dt);
  }

  tryMantle(c, f) {
    const b = this.body;
    const top = c.y1;
    const dh = top - b.pos.y;
    if (dh <= b.stepH * 0.9 || dh > 1.75) return;
    const tx = b.pos.x + f.x * 0.75, tz = b.pos.z + f.z * 0.75;
    if (!isClear(this.g.world.col, tx, tz, b.r * 0.9, top + 0.02, top + b.h)) return;
    if (!isClear(this.g.world.col, b.pos.x, b.pos.z, b.r * 0.9, b.pos.y + b.h, top + b.h)) return;
    this.mantle = { t: 0, dur: 0.18 + dh * 0.12, sx: b.pos.x, sy: b.pos.y, sz: b.pos.z, ex: tx, ey: top, ez: tz };
    b.vel.set(0, 0, 0);
    this.g.audio.jump();
    this.shake = Math.min(1, this.shake + 0.1);
  }

  updateMantle(dt) {
    const m = this.mantle, b = this.body;
    m.t += dt;
    const k = clamp(m.t / m.dur, 0, 1);
    const up = clamp(k * 1.6, 0, 1);
    const fw = clamp((k - 0.35) / 0.65, 0, 1);
    b.pos.set(lerp(m.sx, m.ex, fw), lerp(m.sy, m.ey, up * up * (3 - 2 * up)), lerp(m.sz, m.ez, fw));
    if (k >= 1) {
      this.mantle = null;
      b.grounded = true;
      b.vel.set(0, 0, 0);
      this.landVel -= 0.25;
    }
  }

  applyCamera(cam, dt) {
    const b = this.body;
    const bob = Math.sin(this.bobT) * 0.035 * (this.sprinting ? 1.4 : 1);
    const bobX = Math.cos(this.bobT * 0.5) * 0.03 * (this.sprinting ? 1.4 : 1);
    const sp = Math.hypot(b.vel.x, b.vel.z);
    const bobK = b.grounded ? clamp(sp / 5, 0, 1.5) * (1 - this.g.weapons.adsT * 0.85) : 0;
    const sh = this.shake * this.shake;
    const t = performance.now() * 0.001;
    const shX = (Math.sin(t * 37.1) + Math.sin(t * 23.7)) * 0.5 * sh * 0.025;
    const shY = (Math.sin(t * 31.3) + Math.sin(t * 17.9)) * 0.5 * sh * 0.025;
    cam.position.set(
      b.pos.x + Math.cos(this.yaw) * bobX * bobK,
      b.pos.y + EYE + this.eyeOffset + this.landDip + bob * bobK * 0.6 - (this.mantle ? 0.15 : 0),
      b.pos.z - Math.sin(this.yaw) * bobX * bobK,
    );
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + this.recoilP + shY, this.yaw + this.recoilY + shX, this.lean + shX * 0.5);
    cam.updateMatrixWorld();
  }
}
