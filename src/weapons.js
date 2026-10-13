import * as THREE from 'three';
import { clamp, damp, lerp, rand, DEG, TAU, easeInOut } from './utils.js';

// recoil: v = vertical kick (deg), h = horizontal (deg), climb = extra per sustained shot,
// perm = fraction that stays (you must pull down), rec = recovery rate, ads = multiplier while aiming.
export const WEAPONS = [
  {
    id: 'pistol', name: 'P9 PISTOL', dmg: 34, head: 2.0, rpm: 400, auto: false, mag: 15, reserve: Infinity, reload: 1.3, pellets: 1,
    spreadHip: 0.016, spreadAds: 0.003, spreadMove: 0.018, bloom: 0.012, bloomMax: 0.045, range: 140, falloff: [25, 60, 0.6],
    recoil: { v: 1.9, h: 0.6, climb: 0, perm: 0.3, rec: 11, ads: 0.75 }, kick: { z: 0.05, r: 0.16 }, shake: 0.18, fovPunch: 0.8,
    adsFov: 62, adsSpeed: 14, sound: 'pistol', reloadSfx: ['magout', 'magin', 'slide'], casing: 0.9, tracer: 0.5,
  },
  {
    id: 'ar', name: 'AR-74', dmg: 30, head: 2.0, rpm: 630, auto: true, mag: 30, reserve: 210, reload: 2.1, pellets: 1,
    spreadHip: 0.028, spreadAds: 0.0025, spreadMove: 0.025, bloom: 0.006, bloomMax: 0.05, range: 220, falloff: [40, 110, 0.7],
    recoil: { v: 1.15, h: 0.55, climb: 0.035, perm: 0.42, rec: 7, ads: 0.68, pattern: true }, kick: { z: 0.035, r: 0.07 }, shake: 0.12, fovPunch: 0.5,
    adsFov: 52, adsSpeed: 10, sound: 'ar', reloadSfx: ['magout', 'magin', 'bolt'], casing: 1.2, tracer: 0.35,
  },
  {
    id: 'smg', name: 'VK-9 SMG', dmg: 21, head: 1.8, rpm: 920, auto: true, mag: 32, reserve: 256, reload: 1.7, pellets: 1,
    spreadHip: 0.024, spreadAds: 0.006, spreadMove: 0.012, bloom: 0.004, bloomMax: 0.04, range: 120, falloff: [18, 45, 0.55],
    recoil: { v: 0.7, h: 0.65, climb: 0.02, perm: 0.35, rec: 10, ads: 0.75, pattern: true }, kick: { z: 0.022, r: 0.04 }, shake: 0.08, fovPunch: 0.3,
    adsFov: 60, adsSpeed: 14, sound: 'smg', reloadSfx: ['magout', 'magin', 'bolt'], casing: 0.9, tracer: 0.3,
  },
  {
    id: 'shotgun', name: 'PUMP 12', dmg: 15, head: 1.5, rpm: 72, auto: false, mag: 6, reserve: 42, reload: 2.6, pellets: 10, pelletSpread: 0.065,
    spreadHip: 0.012, spreadAds: 0.006, spreadMove: 0.01, bloom: 0, bloomMax: 0, range: 70, falloff: [10, 28, 0.25],
    recoil: { v: 6.5, h: 1.4, climb: 0, perm: 0.25, rec: 6, ads: 0.85 }, kick: { z: 0.12, r: 0.35 }, shake: 0.55, fovPunch: 2.2,
    adsFov: 65, adsSpeed: 11, sound: 'shotgun', reloadSfx: ['shell', 'shell', 'pump'], casing: 1.8, tracer: 0.25, pump: true,
  },
  {
    id: 'dmr', name: 'M-DMR SCOPED', dmg: 82, head: 2.6, rpm: 150, auto: false, mag: 10, reserve: 60, reload: 2.4, pellets: 1,
    spreadHip: 0.035, spreadAds: 0.0, spreadMove: 0.03, bloom: 0, bloomMax: 0, range: 320, falloff: [120, 300, 0.85],
    recoil: { v: 3.6, h: 0.9, climb: 0, perm: 0.3, rec: 6, ads: 0.8 }, kick: { z: 0.08, r: 0.22 }, shake: 0.35, fovPunch: 1.4,
    adsFov: 20, adsSpeed: 8, sound: 'dmr', reloadSfx: ['magout', 'magin', 'bolt'], casing: 1.4, tracer: 1, scope: true,
  },
];

const SWAP_T = 0.5;

// ---------------------------------------------------------------------------
// Procedural first-person models: barrels, mags, sights, hands — all primitives.
// ---------------------------------------------------------------------------
function makeMats(envMap, tex) {
  const S = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, envMap, envMapIntensity: 1, ...extra });
  return {
    steel: S(0x2c2e33, 0.8, 0.36),
    darkSteel: S(0x1c1d20, 0.75, 0.42),
    poly: S(0x191a1c, 0.15, 0.65),
    wood: S(0x7a4220, 0.0, 0.55),
    bakelite: S(0x7b3214, 0.1, 0.4),
    tan: S(0x9a8462, 0.05, 0.7),
    skin: S(0xb7825f, 0.0, 0.72),
    glove: S(0x262626, 0.05, 0.85),
    sleeve: S(0x2f3338, 0.0, 0.9),
    brass: S(0xd0a650, 0.9, 0.3),
    lens: S(0x4a8fb0, 0.3, 0.05, { envMapIntensity: 2.2, transparent: true, opacity: 0.22, depthWrite: false }),
    tube: S(0x16171a, 0.3, 0.6, { side: THREE.DoubleSide }),
    dot: new THREE.MeshBasicMaterial({ map: tex.dot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(5, 0.5, 0.5) }),
  };
}

function box(parent, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function cyl(parent, r, len, mat, x, y, z, seg = 14, r2 = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const _z = new THREE.Vector3(0, 0, 1);
function arm(parent, M, from, to) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const d = b.clone().sub(a);
  const L = d.length();
  d.normalize();
  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, L), M.sleeve);
  fore.position.copy(a).addScaledVector(d, L / 2);
  fore.quaternion.setFromUnitVectors(_z, d);
  parent.add(fore);
  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.05), M.skin);
  cuff.position.copy(b).addScaledVector(d, -0.03);
  cuff.quaternion.copy(fore.quaternion);
  parent.add(cuff);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.11), M.glove);
  hand.position.copy(b);
  hand.quaternion.copy(fore.quaternion);
  parent.add(hand);
}

function redDot(g, M, y, z, size = 0.018) {
  box(g, 0.04, 0.02, 0.07, M.poly, 0, y - size - 0.008, z);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(size, size, 0.065, 20, 1, true), M.tube);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, y, z);
  g.add(tube);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(size * 0.95, 20), M.lens);
  lens.position.set(0, y, z - 0.03);
  lens.renderOrder = 3;
  g.add(lens);
  const dot = new THREE.Mesh(new THREE.PlaneGeometry(0.009, 0.009), M.dot);
  dot.position.set(0, y, z - 0.02);
  dot.renderOrder = 5;
  g.add(dot);
}

function buildModel(id, M) {
  const g = new THREE.Group();
  const mag = new THREE.Group();
  g.add(mag);
  let model;
  switch (id) {
    case 'pistol': {
      box(g, 0.032, 0.036, 0.19, M.steel, 0, 0.03, -0.03);
      box(g, 0.03, 0.026, 0.165, M.poly, 0, 0.002, -0.02);
      box(g, 0.031, 0.11, 0.05, M.poly, 0, -0.06, 0.05, -0.25);
      box(g, 0.006, 0.012, 0.06, M.poly, 0, -0.022, 0.0);
      cyl(g, 0.007, 0.012, M.darkSteel, 0, 0.03, -0.128);
      box(g, 0.026, 0.01, 0.008, M.darkSteel, 0, 0.052, 0.055);
      box(g, 0.006, 0.011, 0.006, M.darkSteel, 0, 0.052, -0.11);
      box(mag, 0.033, 0.016, 0.054, M.poly, 0, 0, 0);
      mag.position.set(0, -0.118, 0.066);
      mag.rotation.x = -0.25;
      arm(g, M, [0.15, -0.32, 0.36], [0.0, -0.05, 0.065]);
      arm(g, M, [-0.16, -0.33, 0.3], [-0.022, -0.065, 0.055]);
      model = { sightY: 0.052, adsZ: -0.3, hip: new THREE.Vector3(0.15, -0.17, -0.42), muzzle: new THREE.Vector3(0, 0.03, -0.14), eject: new THREE.Vector3(0.02, 0.045, -0.01) };
      break;
    }
    case 'ar': {
      box(g, 0.056, 0.076, 0.34, M.steel, 0, 0, 0);
      box(g, 0.05, 0.03, 0.3, M.darkSteel, 0, 0.05, 0.01);
      box(g, 0.064, 0.062, 0.2, M.wood, 0, -0.004, -0.27);
      box(g, 0.05, 0.032, 0.18, M.wood, 0, 0.042, -0.26);
      cyl(g, 0.0115, 0.34, M.darkSteel, 0, 0.012, -0.5);
      cyl(g, 0.009, 0.2, M.steel, 0, 0.046, -0.33);
      box(g, 0.012, 0.05, 0.015, M.steel, 0, 0.045, -0.6);
      cyl(g, 0.018, 0.07, M.darkSteel, 0, 0.012, -0.7);
      box(g, 0.04, 0.11, 0.05, M.poly, 0, -0.085, 0.1, -0.35);
      box(g, 0.006, 0.01, 0.07, M.steel, 0, -0.045, 0.05);
      box(g, 0.046, 0.076, 0.26, M.wood, 0, -0.025, 0.3, 0.08);
      box(g, 0.048, 0.09, 0.02, M.poly, 0, -0.04, 0.43, 0.08);
      box(mag, 0.04, 0.12, 0.075, M.bakelite, 0, -0.06, 0, 0.18);
      box(mag, 0.04, 0.1, 0.072, M.bakelite, 0, -0.155, -0.035, 0.42);
      mag.position.set(0, -0.04, -0.06);
      redDot(g, M, 0.1, 0.0);
      arm(g, M, [0.16, -0.32, 0.38], [0.0, -0.1, 0.11]);
      arm(g, M, [-0.2, -0.3, -0.02], [-0.012, -0.045, -0.27]);
      model = { sightY: 0.1, adsZ: -0.17, hip: new THREE.Vector3(0.16, -0.19, -0.44), muzzle: new THREE.Vector3(0, 0.012, -0.74), eject: new THREE.Vector3(0.03, 0.04, -0.02) };
      break;
    }
    case 'smg': {
      box(g, 0.05, 0.08, 0.28, M.tan, 0, 0, 0);
      box(g, 0.03, 0.012, 0.24, M.poly, 0, 0.046, 0);
      box(g, 0.045, 0.05, 0.12, M.tan, 0, 0.0, -0.19);
      cyl(g, 0.01, 0.12, M.steel, 0, 0.005, -0.29);
      cyl(g, 0.02, 0.15, M.poly, 0, 0.005, -0.38);
      box(g, 0.04, 0.1, 0.045, M.poly, 0, -0.08, 0.08, -0.3);
      box(g, 0.035, 0.09, 0.035, M.poly, 0, -0.08, -0.15);
      box(g, 0.02, 0.06, 0.2, M.poly, 0, -0.01, 0.24);
      box(g, 0.04, 0.05, 0.02, M.poly, 0, -0.02, 0.34);
      box(mag, 0.035, 0.2, 0.05, M.poly, 0, -0.1, 0);
      mag.position.set(0, -0.03, -0.05);
      box(g, 0.05, 0.008, 0.06, M.poly, 0, 0.056, 0.02);
      box(g, 0.006, 0.045, 0.06, M.poly, -0.022, 0.078, 0.02);
      box(g, 0.006, 0.045, 0.06, M.poly, 0.022, 0.078, 0.02);
      box(g, 0.05, 0.007, 0.06, M.poly, 0, 0.1, 0.02);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.038, 0.032), M.lens);
      lens.position.set(0, 0.08, -0.011);
      g.add(lens);
      const dot = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.014), M.dot);
      dot.position.set(0, 0.08, -0.008);
      dot.renderOrder = 5;
      g.add(dot);
      arm(g, M, [0.16, -0.3, 0.38], [0.0, -0.09, 0.09]);
      arm(g, M, [-0.16, -0.32, 0.05], [0.0, -0.1, -0.15]);
      model = { sightY: 0.08, adsZ: -0.2, hip: new THREE.Vector3(0.15, -0.18, -0.42), muzzle: new THREE.Vector3(0, 0.005, -0.46), eject: new THREE.Vector3(0.028, 0.03, -0.03) };
      break;
    }
    case 'shotgun': {
      box(g, 0.056, 0.07, 0.24, M.steel, 0, 0, 0);
      cyl(g, 0.014, 0.52, M.darkSteel, 0, 0.022, -0.37);
      cyl(g, 0.013, 0.42, M.steel, 0, -0.012, -0.32);
      box(g, 0.046, 0.08, 0.3, M.wood, 0, -0.03, 0.27, 0.1);
      box(g, 0.04, 0.1, 0.05, M.wood, 0, -0.07, 0.11, -0.3);
      box(g, 0.006, 0.008, 0.006, M.brass, 0, 0.04, -0.6);
      box(g, 0.03, 0.01, 0.01, M.steel, 0, 0.04, -0.05);
      box(mag, 0.05, 0.046, 0.16, M.wood, 0, 0, 0);
      mag.position.set(0, -0.012, -0.3);
      arm(g, M, [0.17, -0.3, 0.4], [0.0, -0.07, 0.12]);
      arm(g, M, [-0.18, -0.3, -0.06], [0.0, -0.05, -0.3]);
      model = { sightY: 0.042, adsZ: -0.22, hip: new THREE.Vector3(0.16, -0.19, -0.42), muzzle: new THREE.Vector3(0, 0.022, -0.64), eject: new THREE.Vector3(0.032, 0.02, -0.02), pumpMag: true };
      break;
    }
    case 'dmr': {
      box(g, 0.05, 0.07, 0.32, M.poly, 0, 0, 0);
      box(g, 0.055, 0.06, 0.3, M.poly, 0, 0, -0.3);
      cyl(g, 0.011, 0.3, M.darkSteel, 0, 0.005, -0.58);
      cyl(g, 0.016, 0.05, M.darkSteel, 0, 0.005, -0.75);
      box(g, 0.04, 0.1, 0.05, M.poly, 0, -0.085, 0.1, -0.35);
      box(g, 0.05, 0.09, 0.26, M.poly, 0, -0.02, 0.3);
      box(g, 0.052, 0.06, 0.03, M.poly, 0, 0.04, 0.4);
      cyl(g, 0.02, 0.3, M.steel, 0, 0.085, -0.02, 16);
      cyl(g, 0.03, 0.07, M.steel, 0, 0.085, -0.19, 16, 0.021);
      cyl(g, 0.026, 0.06, M.steel, 0, 0.085, 0.15, 16);
      box(g, 0.03, 0.045, 0.02, M.darkSteel, 0, 0.055, -0.08);
      box(g, 0.03, 0.045, 0.02, M.darkSteel, 0, 0.055, 0.06);
      const l1 = cyl(g, 0.027, 0.004, M.lens, 0, 0.085, -0.226, 16);
      const l2 = cyl(g, 0.023, 0.004, M.lens, 0, 0.085, 0.182, 16);
      l1.renderOrder = l2.renderOrder = 2;
      box(mag, 0.04, 0.12, 0.07, M.poly, 0, -0.06, 0);
      mag.position.set(0, -0.03, -0.04);
      arm(g, M, [0.16, -0.32, 0.38], [0.0, -0.1, 0.11]);
      arm(g, M, [-0.2, -0.3, -0.04], [0.0, -0.05, -0.3]);
      model = { sightY: 0.085, adsZ: -0.14, hip: new THREE.Vector3(0.16, -0.19, -0.44), muzzle: new THREE.Vector3(0, 0.005, -0.78), eject: new THREE.Vector3(0.03, 0.03, -0.02) };
      break;
    }
    default:
      throw new Error('unknown weapon ' + id);
  }
  g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  model.group = g;
  model.mag = mag;
  model.magBase = mag.position.clone();
  model.ads = new THREE.Vector3(0, -model.sightY, model.adsZ);
  return model;
}

function buildFlash(tex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(6, 4.2, 2.2), side: THREE.DoubleSide });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat);
  g.add(front);
  const s1 = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.3), mat);
  s1.rotation.x = Math.PI / 2;
  s1.position.z = -0.12;
  g.add(s1);
  const s2 = s1.clone();
  s2.rotation.z = Math.PI / 2;
  g.add(s2);
  g.visible = false;
  g.traverse((o) => { o.renderOrder = 10; o.frustumCulled = false; });
  return g;
}

// ---------------------------------------------------------------------------
// Weapon system: firing, recoil, spread, reloads, swaps, view-model animation.
// ---------------------------------------------------------------------------
export class Weapons {
  constructor(game, envMap, tex) {
    this.g = game;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(50, 1, 0.01, 20);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.hemi = new THREE.HemisphereLight(0xc4dcff, 0x6b5340, 1.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd2a0, 2.6);
    this.scene.add(this.sun, this.sun.target);
    this.flashLight = new THREE.PointLight(0xffa64d, 0, 2.5, 2);
    this.scene.add(this.flashLight);
    this.M = makeMats(envMap, tex);
    this.models = WEAPONS.map((d) => buildModel(d.id, this.M));
    for (const m of this.models) {
      m.group.visible = false;
      this.pivot.add(m.group);
    }
    this.flash = buildFlash(tex.flash);
    this.flashT = 0;
    this.state = WEAPONS.map((d) => ({ mag: d.mag, reserve: d.reserve }));
    this.cur = 1;
    this.models[this.cur].group.visible = true;
    this.models[this.cur].group.add(this.flash);
    this.flash.position.copy(this.models[this.cur].muzzle);

    this.kick = { z: 0, vz: 0, rx: 0, vrx: 0, ry: 0, vry: 0, rz: 0, vrz: 0 };
    this.reset();

    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._m = new THREE.Vector3();
    this._e = new THREE.Vector3();
    this._sunCam = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  reset() {
    this.state = WEAPONS.map((d) => ({ mag: d.mag, reserve: d.reserve }));
    this.setCurrent(1);
    this.swapT = 0;
    this.swapTo = -1;
    this.swapped = true;
    this.reloadT = 0;
    this.reloadDur = 1;
    this.reloadFlags = [false, false, false];
    this.fireCd = 0;
    this.shotIdx = 0;
    this.sinceShot = 10;
    this.adsT = 0;
    this.bloom = 0;
    this.sprintT = 0;
    this.bobT = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.triggerHeld = false;
    this.emptyClicked = false;
    this.pumpT = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    for (const k in this.kick) this.kick[k] = 0;
  }

  setCurrent(i) {
    if (this.models[this.cur]) this.models[this.cur].group.visible = false;
    this.cur = i;
    const m = this.models[i];
    m.group.visible = true;
    m.group.add(this.flash);
    this.flash.position.copy(m.muzzle);
    m.mag.position.copy(m.magBase);
  }

  get def() { return WEAPONS[this.cur]; }
  get st() { return this.state[this.cur]; }
  get busy() { return this.swapT > 0 || this.reloadT > 0; }

  requestSwap(i) {
    if (i === this.cur && this.swapT <= 0) return;
    if (i < 0 || i >= WEAPONS.length) return;
    this.reloadT = 0;
    this.swapTo = i;
    this.swapT = SWAP_T;
    this.swapped = false;
    this.g.audio.swap();
  }

  startReload() {
    const d = this.def, s = this.st;
    if (this.reloadT > 0 || this.swapT > 0 || s.mag >= d.mag || s.reserve <= 0) return;
    this.reloadT = this.reloadDur = d.reload;
    this.reloadFlags = [false, false, false];
  }

  refill(fraction) {
    WEAPONS.forEach((d, i) => {
      if (d.reserve === Infinity) return;
      this.state[i].reserve = Math.min(d.reserve * 1.5, this.state[i].reserve + Math.ceil(d.reserve * fraction));
    });
  }

  spread(player) {
    const d = this.def;
    const sp = Math.hypot(player.body.vel.x, player.body.vel.z);
    let s = lerp(d.spreadHip, d.spreadAds, this.adsT);
    s += clamp(sp / 5.5, 0, 1.4) * d.spreadMove * (1 - this.adsT * 0.6);
    if (!player.body.grounded) s += 0.03;
    s += this.bloom;
    return s;
  }

  update(dt, inp, player, cam) {
    const d = this.def, s = this.st, g = this.g;
    this.fireCd -= dt;
    this.sinceShot += dt;
    if (this.sinceShot > 0.28) this.shotIdx = 0;
    this.bloom = Math.max(0, this.bloom - dt * (this.sinceShot > 0.12 ? 0.18 : 0.04));
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flashLight.intensity = this.flashT > 0 ? 6 : 0;
    this.pumpT = Math.max(0, this.pumpT - dt);

    // Weapon selection.
    if (inp.consume('swap')) this.requestSwap((this.swapTo >= 0 && this.swapT > 0 ? this.swapTo + 1 : this.cur + 1) % WEAPONS.length);
    const slot = inp.consumeSlot();
    if (slot >= 0) this.requestSwap(slot);
    if (this.swapT > 0) {
      this.swapT -= dt;
      if (!this.swapped && this.swapT <= SWAP_T / 2) {
        this.setCurrent(this.swapTo);
        this.swapped = true;
        this.shotIdx = 0;
        this.bloom = 0;
      }
      if (this.swapT <= 0) this.swapTo = -1;
    }

    // Reload.
    if (inp.consume('reload')) this.startReload();
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      const p = 1 - this.reloadT / this.reloadDur;
      const marks = [0.18, 0.55, 0.82];
      for (let i = 0; i < 3; i++) {
        if (!this.reloadFlags[i] && p >= marks[i]) {
          this.reloadFlags[i] = true;
          g.audio.mech(d.reloadSfx[i]);
        }
      }
      if (this.reloadT <= 0) {
        const need = d.mag - s.mag;
        const take = Math.min(need, s.reserve);
        s.mag += take;
        if (s.reserve !== Infinity) s.reserve -= take;
        this.reloadT = 0;
      }
    }

    // Aim down sights.
    const wantAds = inp.ads && this.swapT <= 0 && this.reloadT <= 0 && !player.mantle;
    this.adsT = damp(this.adsT, wantAds ? 1 : 0, d.adsSpeed, dt);
    if (this.adsT > 0.05 && player.sprinting) player.sprinting = false;

    // Fire.
    const canFire = this.swapT <= 0 && this.reloadT <= 0 && !player.mantle && this.pumpT <= 0;
    if (inp.fire && player.sprinting) {
      player.sprinting = false;
      this.fireCd = Math.max(this.fireCd, 0.08);
    }
    if (inp.fire && canFire && this.fireCd <= 0) {
      const allow = d.auto || !this.triggerHeld || inp.touchFire;
      if (allow) {
        if (s.mag > 0) {
          this.shoot(player, cam);
          this.emptyClicked = false;
        } else if (!this.emptyClicked) {
          g.audio.empty();
          this.emptyClicked = true;
          this.fireCd = 0.25;
          if (s.reserve > 0) this.startReload();
        }
      }
    }
    if (!inp.fire) this.emptyClicked = false;
    this.triggerHeld = inp.fire;
    if (s.mag === 0 && s.reserve > 0 && this.reloadT <= 0 && this.swapT <= 0 && this.sinceShot > 0.25) this.startReload();
    // Completely dry: fall back to the next gun that still has ammo.
    if (s.mag === 0 && s.reserve <= 0 && this.swapT <= 0 && this.sinceShot > 0.35) {
      for (let k = 1; k < WEAPONS.length; k++) {
        const j = (this.cur + k) % WEAPONS.length;
        if (this.state[j].mag > 0 || this.state[j].reserve > 0) {
          this.requestSwap(j);
          break;
        }
      }
    }

    this.animate(dt, inp, player, cam);
  }

  shoot(player, cam) {
    const d = this.def, s = this.st, g = this.g;
    s.mag--;
    this.fireCd = 60 / d.rpm;
    this.shotIdx++;
    this.sinceShot = 0;
    this.shotsFired++;
    if (d.pump) this.pumpT = 0.0;

    // Recoil: part permanent (player must compensate), part recovers.
    const R = d.recoil;
    const adsMul = lerp(1, R.ads, this.adsT);
    const v = R.v * (1 + R.climb * Math.min(this.shotIdx, 14)) * adsMul * DEG * rand(0.9, 1.1);
    let hk;
    if (R.pattern) {
      const i = this.shotIdx;
      hk = (Math.sin(i * 0.55) * 0.75 + (i > 9 ? 0.45 : -0.15) + rand(-0.35, 0.35)) * R.h;
    } else hk = rand(-1, 1) * R.h;
    player.addRecoil(v, hk * adsMul * DEG, R.perm, R.rec);
    const kickMul = 1 - this.adsT * 0.45;
    this.kick.vz += d.kick.z * 22 * kickMul * rand(0.9, 1.1);
    this.kick.vrx += d.kick.r * 22 * kickMul * rand(0.85, 1.15);
    this.kick.vry += rand(-1, 1) * d.kick.r * 6;
    this.kick.vrz += rand(-1, 1) * d.kick.r * 9;
    player.shake = Math.min(1, player.shake + d.shake);
    player.fovPunch += d.fovPunch;
    this.bloom = Math.min(d.bloomMax, this.bloom + d.bloom);

    // Muzzle position in world space (view-model space ~ camera space).
    const m = this.models[this.cur];
    this.pivot.updateMatrixWorld(true);
    this._m.copy(m.muzzle).applyMatrix4(m.group.matrixWorld);
    cam.localToWorld(this._m);
    this._e.copy(m.eject).applyMatrix4(m.group.matrixWorld);
    cam.localToWorld(this._e);

    // Hitscan rays from the camera through the (recoiled) crosshair.
    cam.getWorldDirection(this._f);
    this._r.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this._u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const spread = this.spread(player);
    let anyHit = false;
    for (let p = 0; p < d.pellets; p++) {
      const sp = spread + (d.pelletSpread || 0);
      const rr = sp * Math.sqrt(Math.random()), a = Math.random() * TAU;
      this._d.copy(this._f).addScaledVector(this._r, Math.cos(a) * rr).addScaledVector(this._u, Math.sin(a) * rr).normalize();
      const tracer = p === 0 ? Math.random() < d.tracer : Math.random() < 0.25;
      if (g.playerShot(cam.position, this._d, d, this._m, tracer, p === 0)) anyHit = true;
    }
    if (anyHit) this.shotsHit++;

    // Juice.
    this.flashT = 0.045;
    this.flash.rotation.z = rand(0, TAU);
    const fs = (d.id === 'shotgun' ? 1.5 : d.id === 'smg' ? 0.8 : 1) * rand(0.85, 1.2);
    this.flash.scale.setScalar(fs);
    this.flashLight.position.copy(m.muzzle).applyMatrix4(m.group.matrixWorld);
    g.muzzleLight(this._m);
    g.fx.muzzle(this._m.x, this._m.y, this._m.z, this._f.x, this._f.y, this._f.z, d.id === 'shotgun', true);
    g.audio.gun(d.sound);
    // Brass.
    this._v.copy(this._r).multiplyScalar(rand(1.6, 2.6)).addScaledVector(this._u, rand(1.2, 2.2)).addScaledVector(this._f, rand(-0.4, 0.3));
    this._v.add(player.body.vel);
    g.fx.casings.spawn(this._e, this._v, d.casing);
    if (d.pump) {
      this.pumpT = 0.45;
      setTimeout(() => g.audio.mech('pump'), 260);
    }
    g.onPlayerShot(d);
  }

  animate(dt, inp, player, cam) {
    const m = this.models[this.cur];
    const K = this.kick;
    // Under-damped springs give a crisp kick with a little settle.
    const kS = 210, kD = 19;
    K.vz += (-kS * K.z - kD * K.vz) * dt; K.z += K.vz * dt;
    K.vrx += (-kS * K.rx - kD * K.vrx) * dt; K.rx += K.vrx * dt;
    K.vry += (-kS * K.ry - kD * K.vry) * dt; K.ry += K.vry * dt;
    K.vrz += (-kS * K.rz - kD * K.vrz) * dt; K.rz += K.vrz * dt;

    const ads = easeInOut(clamp(this.adsT, 0, 1));
    const sp = Math.hypot(player.body.vel.x, player.body.vel.z);
    const moving = player.body.grounded ? clamp(sp / 5, 0, 1.6) : 0;
    this.sprintT = damp(this.sprintT, player.sprinting ? 1 : 0, 9, dt);
    this.bobT += dt * (player.sprinting ? 11 : 8.2) * Math.min(1, sp / 3);

    // Look sway lags behind camera rotation.
    this.swayX = damp(this.swayX, clamp(-inp.lastLookX * 0.0009, -0.04, 0.04), 8, dt);
    this.swayY = damp(this.swayY, clamp(inp.lastLookY * 0.0009, -0.04, 0.04), 8, dt);

    const p = this._v.copy(m.hip).lerp(m.ads, ads);
    const bobA = (1 - ads * 0.9) * moving;
    p.x += Math.sin(this.bobT) * 0.011 * bobA + this.swayX * (1 - ads * 0.8);
    p.y += -Math.abs(Math.cos(this.bobT)) * 0.012 * bobA + this.swayY * (1 - ads * 0.8) - player.landDip * 0.08;
    p.z += K.z;
    let rx = K.rx, ry = K.ry + this.swayX * 2, rz = K.rz + Math.sin(this.bobT) * 0.012 * bobA;

    // Sprint pose.
    const sT = this.sprintT * (1 - ads);
    p.x -= 0.04 * sT; p.y -= 0.05 * sT;
    ry += 0.62 * sT; rz += 0.28 * sT; rx -= 0.12 * sT;

    // Reload pose: tilt and drop the mag.
    if (this.reloadT > 0) {
      const q = 1 - this.reloadT / this.reloadDur;
      const c = Math.sin(q * Math.PI);
      rz -= 0.55 * c; rx += 0.18 * c; p.y -= 0.05 * c; p.x -= 0.02 * c;
      if (m.pumpMag) {
        const pump = q > 0.75 ? Math.sin(((q - 0.75) / 0.25) * Math.PI) : 0;
        m.mag.position.set(m.magBase.x, m.magBase.y, m.magBase.z + pump * 0.08);
      } else {
        const out = q < 0.18 ? 0 : q < 0.45 ? (q - 0.18) / 0.27 : q < 0.55 ? 1 : q < 0.7 ? 1 - (q - 0.55) / 0.15 : 0;
        m.mag.position.set(m.magBase.x, m.magBase.y - out * 0.3, m.magBase.z + out * 0.05);
      }
    } else if (m.pumpMag && this.pumpT > 0) {
      const pc = Math.sin((1 - this.pumpT / 0.45) * Math.PI);
      m.mag.position.set(m.magBase.x, m.magBase.y, m.magBase.z + pc * 0.09);
      rx += 0.05 * pc;
    } else {
      m.mag.position.copy(m.magBase);
    }

    // Swap pose.
    if (this.swapT > 0) {
      const ph = 1 - this.swapT / SWAP_T;
      const low = easeInOut(ph < 0.5 ? ph * 2 : (1 - ph) * 2);
      p.y -= 0.3 * low;
      rx -= 0.9 * low;
    }

    // Mantle pose.
    if (player.mantle) {
      p.y -= 0.12;
      rz += 0.4;
    }

    this.pivot.position.copy(p);
    this.pivot.rotation.set(rx, ry, rz);

    const d = this.def;
    const scoped = d.scope && this.adsT > 0.88;
    this.pivot.visible = !scoped;
    this.scoped = scoped;

    // Sun in camera space so the gun is lit consistently with the world.
    this._q.copy(cam.quaternion).invert();
    this._sunCam.copy(this.g.sunDir).applyQuaternion(this._q);
    this.sun.position.copy(this._sunCam).multiplyScalar(5);
    this.sun.target.position.set(0, 0, 0);

    this.cam.aspect = cam.aspect;
    this.cam.fov = lerp(50, 40, ads);
    this.cam.updateProjectionMatrix();
  }

  fovTarget(base) {
    const d = this.def;
    return lerp(base, d.adsFov, easeInOut(clamp(this.adsT, 0, 1)));
  }
}
