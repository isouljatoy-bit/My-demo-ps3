import * as THREE from 'three';
import { rand, TAU } from './utils.js';

const TYPES = {
  health: { color: [0.25, 1.0, 0.35], label: '+ HEALTH' },
  armor: { color: [0.3, 0.65, 1.0], label: '+ ARMOR' },
  ammo: { color: [1.0, 0.75, 0.25], label: '+ AMMO' },
};

function icon(type) {
  const g = new THREE.Group();
  if (type === 'health') {
    const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f4, emissive: 0x222222 });
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.25) });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.22), white));
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.24), red);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.24), red);
    g.add(a, b);
  } else if (type === 'armor') {
    const blue = new THREE.MeshLambertMaterial({ color: 0x2b5fae, emissive: 0x0a1a40 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 3) });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.56, 0.18), blue));
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.2), blue);
    s1.position.set(-0.17, 0.33, 0);
    const s2 = s1.clone();
    s2.position.x = 0.17;
    g.add(s1, s2);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.2), glow);
    strip.position.y = 0.05;
    g.add(strip);
  } else {
    const olive = new THREE.MeshLambertMaterial({ color: 0x4b5a2a });
    const brass = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 0.6) });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.32, 0.3), olive));
    for (let i = 0; i < 4; i++) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), brass);
      r.position.set(-0.15 + i * 0.1, 0.24, 0);
      g.add(r);
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Pickups {
  constructor(scene, tex) {
    this.scene = scene;
    this.items = [];
    const ringGeo = new THREE.RingGeometry(0.45, 0.62, 32).rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(0.28, 0.5, 4, 16, 1, true).translate(0, 2, 0);
    for (const type of Object.keys(TYPES)) {
      for (let i = 0; i < 14; i++) {
        const c = TYPES[type].color;
        const root = new THREE.Group();
        const ic = icon(type);
        ic.position.y = 0.75;
        root.add(ic);
        const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0] * 2, c[1] * 2, c[2] * 2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.y = 0.04;
        root.add(ring);
        const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, alphaMap: tex.glow });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        root.add(beam);
        root.visible = false;
        scene.add(root);
        this.items.push({ type, root, icon: ic, ring, beam, on: false, persistent: false, life: 0, respawn: 0, spot: null, t: rand(0, TAU) });
      }
    }
  }

  spawn(type, x, y, z, persistent = false, spot = null) {
    const it = this.items.find((p) => p.type === type && !p.on && p.respawn <= 0 && !p.spot);
    if (!it) return null;
    it.on = true;
    it.persistent = persistent;
    it.spot = spot;
    it.life = persistent ? Infinity : 25;
    it.root.position.set(x, y, z);
    it.root.visible = true;
    return it;
  }

  clear() {
    for (const it of this.items) {
      it.on = false;
      it.root.visible = false;
      it.spot = null;
      it.respawn = 0;
      it.persistent = false;
    }
  }

  update(dt, g) {
    const P = g.player.body.pos;
    for (const it of this.items) {
      if (!it.on) {
        if (it.respawn > 0) {
          it.respawn -= dt;
          if (it.respawn <= 0 && it.spot) {
            it.on = true;
            it.root.visible = true;
            it.life = Infinity;
          }
        }
        continue;
      }
      it.t += dt;
      it.icon.rotation.y = it.t * 2.2;
      it.icon.position.y = 0.75 + Math.sin(it.t * 2.6) * 0.1;
      const pulse = 0.65 + Math.sin(it.t * 5) * 0.2;
      it.ring.material.opacity = pulse;
      it.ring.scale.setScalar(1 + Math.sin(it.t * 3) * 0.08);
      it.life -= dt;
      if (it.life < 4) it.root.visible = Math.floor(it.life * 8) % 2 === 0;
      if (it.life <= 0) {
        it.on = false;
        it.root.visible = false;
        continue;
      }
      const p = it.root.position;
      const dx = P.x - p.x, dy = P.y - p.y, dz = P.z - p.z;
      if (dx * dx + dz * dz < 1.6 && Math.abs(dy) < 1.6 && !g.player.dead) {
        if (this.apply(it.type, g)) {
          g.fx.pickupBurst(p.x, p.y + 0.75, p.z, TYPES[it.type].color);
          g.audio.pickup(it.type);
          g.hud.popup(TYPES[it.type].label);
          it.on = false;
          it.root.visible = false;
          if (it.spot) it.respawn = 35;
        }
      }
    }
  }

  apply(type, g) {
    const p = g.player;
    if (type === 'health') {
      if (p.health >= 100) return false;
      p.heal(50, 0);
    } else if (type === 'armor') {
      if (p.armor >= 100) return false;
      p.heal(0, 50);
    } else {
      g.weapons.refill(0.5);
    }
    return true;
  }
}
