import * as THREE from 'three';
import { AudioEngine } from './audio.js';
import { createTextures } from './textures.js';
import { World } from './world.js';
import { NavGrid } from './nav.js';
import { createSky, createEnvMap, createHills, SUN_DIR } from './sky.js';
import { FX } from './effects.js';
import { Weapons } from './weapons.js';
import { Player } from './player.js';
import { Enemies, KINDS } from './enemies.js';
import { Pickups } from './pickups.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Post } from './post.js';
import { isClear } from './physics.js';
import { clamp, lerp, rand, store, wrapAngle, DEG } from './utils.js';

const QUALITY = {
  low: { scale: 0.62, shadow: 1024, shadowEvery: 2, bloom: false, msaa: 0, enemies: 8, fx: 'low' },
  med: { scale: 0.82, shadow: 1536, shadowEvery: 1, bloom: true, msaa: 0, enemies: 10, fx: 'med' },
  high: { scale: 1.0, shadow: 2048, shadowEvery: 1, bloom: true, msaa: 4, enemies: 12, fx: 'high' },
};
const BOT_COUNT = 100;
const KIND_LABEL = { gunner: 'GUNNER', rusher: 'RUSHER', sniper: 'ROOF SNIPER' };
const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.canvas = $('game');
    this.settings = {
      sens: store.get('stw.sens', 1.0),
      quality: store.get('stw.quality', 'auto'),
      assist: store.get('stw.assist', true),
      showFps: store.get('stw.fps', false),
    };
    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false,
    }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.baseFov = 78;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.08, 1500);
    this.camera.rotation.order = 'YXZ';
    this.sunDir = SUN_DIR;
    this.audio = new AudioEngine();
    this.hud = new HUD();
    this.input = new Input(this);
    document.body.classList.add(this.input.isTouch ? 'touch' : 'no-touch');
    this.state = 'boot';
    this.time = 0;
    this.frameNo = 0;
    this.aimAssist = { onTarget: false, friction: 0.5, pullYaw: 0, pullPitch: 0, wasAds: false };
    this.qName = this.settings.quality === 'auto' ? 'med' : this.settings.quality;
    this.dyn = 1;
    this.perf = { acc: 0, frames: 0, t: 0, good: 0 };
    this.fpsT = 0;
    this.fpsFrames = 0;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._hit = { t: 0, nx: 0, ny: 0, nz: 0, c: null };
    this._hit2 = { t: 0, nx: 0, ny: 0, nz: 0, c: null };
    this._cell = { x: 0, y: 0, z: 0 };
    this.frame = this.frame.bind(this);
  }

  get q() { return QUALITY[this.qName]; }

  async boot() {
    const msg = $('load-msg');
    const step = async (text) => {
      msg.textContent = text;
      await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
    };
    await step('PAINTING TEXTURES…');
    if (document.fonts && document.fonts.ready) {
      try { await Promise.race([document.fonts.ready, new Promise((res) => setTimeout(res, 1200))]); } catch (e) { /* fonts optional */ }
    }
    this.tex = createTextures(this.renderer);
    this.envMap = createEnvMap(this.renderer);

    await step('BUILDING THE CITY…');
    this.world = new World(this.scene, this.tex, this.envMap);
    this.world.generate(7);
    await step('MAPPING THE STREETS…');
    this.nav = new NavGrid(this.world.col, 2);
    this.hud.buildMinimap(this.world);

    await step('LIGHTING THE SUNSET…');
    this.sky = createSky();
    this.scene.add(this.sky);
    this.scene.add(createHills());
    this.scene.fog = new THREE.Fog(new THREE.Color().setRGB(0.78, 0.63, 0.5), 90, 560);
    this.hemi = new THREE.HemisphereLight(0xc2d6f5, 0x9a7656, 1.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffc489, 3.4);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -62; sc.right = 62; sc.top = 62; sc.bottom = -62; sc.near = 1; sc.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.mLight = new THREE.PointLight(0xffa040, 0, 10, 2);
    this.scene.add(this.mLight);

    await step('LOADING THE CREW…');
    this.fx = new FX(this.scene, this.tex, this.envMap);
    this.weapons = new Weapons(this, this.envMap, this.tex);
    this.player = new Player(this);
    this.enemies = new Enemies(this.scene, BOT_COUNT + 4);
    this.enemyDmgMul = 1;
    this.pickups = new Pickups(this.scene, this.tex);
    this.post = new Post(this.renderer);

    this.applyQuality(true);
    this.bindUI();
    window.addEventListener('resize', () => this.queueResize());
    window.addEventListener('orientationchange', () => this.queueResize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.queueResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'play') this.setState('pause');
        this.audio.suspend();
      } else if (this.state !== 'pause') this.audio.resume();
    });

    // Warm up every shader (including hidden pools) so the first firefight doesn't hitch.
    this.player.reset(this.world.spawn.x, this.world.spawn.y, this.world.spawn.z, this.world.spawn.yaw);
    this.player.applyCamera(this.camera, 0);
    this.warmup();

    $('loading').classList.add('hidden');
    this.setState('menu');
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  warmup() {
    const hidden = [];
    const reveal = (root) => root.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    reveal(this.scene);
    reveal(this.weapons.scene);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.weapons.scene, this.weapons.cam);
    this.renderer.shadowMap.needsUpdate = true;
    this.post.render(this.scene, this.camera, this.weapons.scene, this.weapons.cam, true, { damage: 0, lowHealth: 0, time: 0, scope: 0, exposure: 1 });
    for (const o of hidden) o.visible = false;
  }

  // ---------- UI ----------
  bindUI() {
    const tap = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); this.audio.init(); this.audio.ui(); fn(); });
    tap('btn-play', () => this.startRun('waves'));
    tap('btn-bots', () => this.startRun('bots'));
    tap('btn-resume', () => this.setState('play'));
    tap('btn-restart', () => this.startRun(this.mode));
    tap('btn-quit', () => this.setState('menu'));
    tap('btn-again', () => this.startRun(this.mode));
    tap('btn-menu', () => this.setState('menu'));

    const sens = $('sens');
    sens.value = this.settings.sens;
    sens.addEventListener('input', () => {
      this.settings.sens = parseFloat(sens.value);
      store.set('stw.sens', this.settings.sens);
    });
    const seg = (id, attr, cur, fn) => {
      const el = $(id);
      const sync = (v) => [...el.children].forEach((b) => b.classList.toggle('on', b.dataset[attr] === String(v)));
      sync(cur);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const v = b.dataset[attr];
        sync(v);
        fn(v);
      });
    };
    seg('qual', 'q', this.settings.quality, (v) => {
      this.settings.quality = v;
      store.set('stw.quality', v);
      this.qName = v === 'auto' ? 'med' : v;
      this.dyn = 1;
      this.applyQuality(true);
    });
    seg('assist', 'a', this.settings.assist ? '1' : '0', (v) => {
      this.settings.assist = v === '1';
      store.set('stw.assist', this.settings.assist);
    });
    seg('fpsopt', 'f', this.settings.showFps ? '1' : '0', (v) => {
      this.settings.showFps = v === '1';
      store.set('stw.fps', this.settings.showFps);
    });
    $('hint').innerHTML = this.input.isTouch
      ? 'Left thumb: move (push to the edge to sprint) · Right side: drag to aim · Big red button fires and steers · AIM toggles sights · Jump into ledges to climb'
      : 'WASD move · Mouse aim · Click fire · Right-click aim · Space jump/climb · Shift sprint · R reload · 1-5 / Q / wheel weapons · Esc pause';
  }

  updateBest() {
    const best = store.get('stw.best', null), b100 = store.get('stw.best100', null);
    const parts = [];
    if (best) parts.push(`WAVES BEST: WAVE ${best.wave} · ${best.score.toLocaleString()} PTS`);
    if (b100) parts.push(`100 BOTS BEST: ${b100.kills ?? 0} KILLS · ${b100.score.toLocaleString()} PTS`);
    $('best').innerHTML = parts.join('<br>');
  }

  setState(s) {
    const prev = this.state;
    this.state = s;
    $('menu').classList.toggle('hidden', s !== 'menu');
    $('pause').classList.toggle('hidden', s !== 'pause');
    $('gameover').classList.toggle('hidden', s !== 'over');
    this.hud.show(s === 'play' || s === 'pause');
    $('touch').classList.toggle('hidden', s !== 'play');
    this.input.enabled = s === 'play';
    if (s !== 'play') {
      this.input.reset();
      if (document.pointerLockElement) document.exitPointerLock?.();
    }
    if (s === 'menu') {
      this.updateBest();
      this.enemies.clear();
      this.pickups.clear();
      this.fx.clear();
      this.menuT = 0;
    }
    if (s === 'pause') this.audio.suspend();
    if (s === 'play') {
      this.audio.resume();
      if (prev === 'pause') this.last = performance.now();
    }
    if (s === 'over') this.showGameOver();
  }

  // ---------- Run lifecycle ----------
  startRun(mode = 'waves') {
    this.audio.init();
    this.mode = mode;
    this.victory = false;
    this.victoryT = 0;
    this.runTime = 0;
    const W = this.world;
    this.player.reset(W.spawn.x, W.spawn.y, W.spawn.z, W.spawn.yaw);
    this.weapons.reset();
    this.enemies.clear();
    this.pickups.clear();
    this.fx.clear();
    this.hud.clearTransient();
    this.stats = { kills: 0, heads: 0, score: 0, shots: 0, hits: 0 };
    this.killTimes = [];
    this.deathT = 0;
    this.timeScale = 1;
    this.wave = 0;
    this.intermission = 0;
    // Persistent rooftop pickups reward climbing.
    const types = ['armor', 'health', 'ammo'];
    const counts = { armor: 0, health: 0, ammo: 0 };
    W.pickupSpots.forEach((s, i) => {
      const type = types[i % 3];
      if (counts[type] >= 4) return;
      if (this.pickups.spawn(type, s.x, s.y, s.z, true, s)) counts[type]++;
    });
    this.nav.target = -1;
    this.nav.update(this.player.body.pos.x, this.player.body.pos.z);
    this.navT = 0;
    if (mode === 'bots') this.startBots();
    else {
      this.enemies.maxTokens = 99;
      this.enemyDmgMul = 1;
      this.startWave(1);
    }
    this.setState('play');
    if (!this.input.isTouch) this.renderer.domElement.requestPointerLock?.();
  }

  startWave(n) {
    this.wave = n;
    this.toSpawn = 4 + n * 3;
    this.cap = Math.min(this.q.enemies, 3 + n);
    this.spawnT = 1.5;
    this.intermission = 0;
    this.hud.showBanner(`WAVE ${n}`, n === 1 ? 'Rival crews incoming — hold the turf' : n % 3 === 0 ? 'Snipers on the rooftops' : 'They brought backup', 3);
    this.audio.waveStart();
  }

  // ---------- 100 Bots mode ----------
  startBots() {
    const P = this.player.body.pos, W = this.world;
    this.wave = 1;
    this.toSpawn = 0;
    this.enemies.maxTokens = 4;
    this.enemyDmgMul = 0.6;
    let placed = 0;
    // Rooftops first (up to two shooters per roof), then the streets.
    const spots = W.roofSpots.slice().sort(() => Math.random() - 0.5);
    for (const s of spots) {
      if (Math.hypot(s.x - P.x, s.z - P.z) < 28) continue;
      for (let k = 0; k < 2 && placed < 28; k++) {
        for (let tries = 0; tries < 6; tries++) {
          const x = s.x + rand(-s.rx, s.rx) * 0.85, z = s.z + rand(-s.rz, s.rz) * 0.85;
          if (!isClear(W.col, x, z, 0.45, s.y + 0.05, s.y + 1.8)) continue;
          if (this.enemies.list.some((e) => e.alive && Math.hypot(e.body.pos.x - x, e.body.pos.z - z) < 1.2)) continue;
          const kind = Math.random() < 0.25 ? 'sniper' : 'gunner';
          if (this.enemies.spawn(kind, x, s.y, z, s, this.wave, Math.random() < 0.12)) placed++;
          break;
        }
      }
    }
    for (let tries = 0; tries < 2000 && placed < BOT_COUNT; tries++) {
      const c = this.nav.randomCell(16, 140, this._cell);
      if (!c) break;
      if (Math.hypot(c.x - P.x, c.z - P.z) < 36) continue;
      if (this.enemies.list.some((e) => e.alive && Math.abs(e.body.pos.x - c.x) + Math.abs(e.body.pos.z - c.z) < 1.5)) continue;
      const kind = Math.random() < 0.3 ? 'rusher' : 'gunner';
      if (this.enemies.spawn(kind, c.x, c.y, c.z, null, this.wave, Math.random() < 0.15)) placed++;
    }
    this.botTotal = placed;
    this.hud.showBanner(`${placed} BOTS`, 'Every crew in the city wants your turf', 3.2);
    this.audio.waveStart();
  }

  updateBots(dt) {
    this.runTime += dt;
    if (this.victory) {
      this.victoryT += dt;
      if (this.victoryT > 3) this.setState('over');
      return;
    }
    if (this.enemies.aliveCount === 0) {
      this.victory = true;
      const bonus = 5000 + Math.max(0, Math.round(600 - this.runTime)) * 10;
      this.stats.score += bonus;
      this.hud.showBanner('TURF SECURED', `All ${this.botTotal} bots down · +${bonus}`, 3.5);
      this.audio.waveClear();
    }
  }

  updateWaves(dt) {
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startWave(this.wave + 1);
      return;
    }
    this.spawnT -= dt;
    if (this.toSpawn > 0 && this.enemies.aliveCount < this.cap && this.spawnT <= 0) {
      if (this.spawnEnemy()) this.toSpawn--;
      this.spawnT = rand(0.7, 1.8);
    }
    if (this.toSpawn <= 0 && this.enemies.aliveCount === 0) {
      const bonus = 250 * this.wave;
      this.stats.score += bonus;
      this.intermission = 8;
      this.hud.showBanner('WAVE CLEARED', `+${bonus} · next wave in 8s`, 3.2);
      this.audio.waveClear();
      this.player.heal(30, 10);
      this.weapons.refill(0.35);
    }
  }

  spawnEnemy() {
    const n = this.wave, P = this.player.body.pos;
    const armored = n >= 4 && Math.random() < Math.min(0.5, 0.12 + n * 0.03);
    const roofChance = Math.min(0.42, 0.16 + n * 0.035);
    if (Math.random() < roofChance) {
      const spots = this.world.roofSpots.filter((s) => {
        const d = Math.hypot(s.x - P.x, s.z - P.z);
        if (d < 26 || d > 130) return false;
        return !this.enemies.list.some((e) => e.alive && e.roof === s);
      });
      if (spots.length) {
        const s = spots[(Math.random() * spots.length) | 0];
        for (let tries = 0; tries < 8; tries++) {
          const x = s.x + rand(-s.rx, s.rx) * 0.85, z = s.z + rand(-s.rz, s.rz) * 0.85;
          if (isClear(this.world.col, x, z, 0.4, s.y + 0.05, s.y + 1.8)) {
            const kind = Math.random() < 0.55 ? 'sniper' : 'gunner';
            return !!this.enemies.spawn(kind, x, s.y, z, s, n, armored);
          }
        }
      }
    }
    const c = this.nav.randomCell(18, 62, this._cell);
    if (!c) return false;
    if (Math.hypot(c.x - P.x, c.z - P.z) < 30) return false;
    const kind = Math.random() < Math.min(0.45, 0.15 + n * 0.05) ? 'rusher' : 'gunner';
    return !!this.enemies.spawn(kind, c.x, c.y, c.z, null, n, armored);
  }

  // Moves a hidden enemy to a rooftop (or street cell) that has line of sight to the player.
  relocateEnemy(e) {
    // In 100 Bots mode the crowd itself provides pressure; only stragglers get repositioned.
    if (this.mode === 'bots' && this.enemies.aliveCount > 12) return false;
    const P = this.player.body.pos, cam = this.camera.position;
    const spots = this.world.roofSpots;
    for (let tries = 0; tries < 14; tries++) {
      const s = spots[(Math.random() * spots.length) | 0];
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      if (d < 22 || d > 110) continue;
      if (this.enemies.list.some((o) => o !== e && o.alive && o.roof === s)) continue;
      const x = s.x + rand(-s.rx, s.rx) * 0.8, z = s.z + rand(-s.rz, s.rz) * 0.8;
      if (!isClear(this.world.col, x, z, 0.4, s.y + 0.05, s.y + 1.8)) continue;
      if (!this.lineOfSight(x, s.y + 1.6, z, P.x, P.y + 1.5, P.z)) continue;
      if (this.lineOfSight(cam.x, cam.y, cam.z, x, s.y + 1.2, z) && this.isOnScreen(x, s.y + 1, z)) continue;
      this.placeEnemy(e, x, s.y, z, s);
      return true;
    }
    for (let tries = 0; tries < 20; tries++) {
      const c = this.nav.randomCell(10, 50, this._cell);
      if (!c) break;
      if (!this.lineOfSight(c.x, c.y + 1.6, c.z, P.x, P.y + 1.5, P.z)) continue;
      if (this.isOnScreen(c.x, c.y + 1, c.z) && this.lineOfSight(cam.x, cam.y, cam.z, c.x, c.y + 1.2, c.z)) continue;
      this.placeEnemy(e, c.x, c.y, c.z, null);
      return true;
    }
    return false;
  }

  placeEnemy(e, x, y, z, roof) {
    e.body.pos.set(x, y, z);
    e.body.vel.set(0, 0, 0);
    e.root.position.set(x, y, z);
    e.roof = roof;
    e.aimT = 0;
    e.backT = 0;
    e.losT = 0;
  }

  isOnScreen(x, y, z) {
    const v = this._w.set(x, y, z).project(this.camera);
    return v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
  }

  onPlayerShot() {
    this.stats.shots++;
  }

  onPlayerDeath() {
    this.deathT = 0;
    this.audio.death();
    this.hud.showBanner('', '', 0.01);
  }

  showGameOver() {
    const s = this.stats;
    const bots = this.mode === 'bots';
    $('go-title').textContent = this.victory ? 'TURF SECURED' : 'FLATLINED';
    $('go-title').classList.toggle('win', this.victory);
    $('go-wave-label').textContent = bots ? 'Bots left' : 'Wave';
    $('go-wave').textContent = bots ? this.enemies.aliveCount : this.wave;
    $('go-kills').textContent = s.kills;
    $('go-head').textContent = s.heads;
    const w = this.weapons;
    $('go-acc').textContent = (w.shotsFired ? Math.round((w.shotsHit / w.shotsFired) * 100) : 0) + '%';
    const key = bots ? 'stw.best100' : 'stw.best';
    const best = store.get(key, null);
    const isBest = !best || s.score > best.score;
    if (isBest) store.set(key, { wave: this.wave, score: s.score, kills: s.kills });
    const time = bots ? ` · ${Math.floor(this.runTime / 60)}:${String(Math.floor(this.runTime % 60)).padStart(2, '0')}` : '';
    $('go-score').textContent = `${s.score.toLocaleString()} PTS${time}${isBest ? ' · NEW BEST' : ''}`;
  }

  // ---------- Combat callbacks ----------
  pan(x, z) {
    const c = this.camera;
    const dx = x - c.position.x, dz = z - c.position.z;
    const l = Math.hypot(dx, dz) || 1;
    return clamp((dx / l) * Math.cos(this.player.yaw) - (dz / l) * Math.sin(this.player.yaw), -1, 1);
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return !this.world.col.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.3, this._hit2);
  }

  muzzleLight(p) {
    this.mLight.position.copy(p);
    this.mLight.intensity = 28;
  }

  playerShot(o, d, def, muzzle, tracer, first) {
    const H = this._hit;
    const wHit = this.world.col.raycast(o.x, o.y, o.z, d.x, d.y, d.z, def.range, H);
    const wT = wHit ? H.t : def.range;
    const eh = this.enemies.raycast(o, d, wT);
    let ex, ey, ez, hitEnemy = false;
    if (eh) {
      const e = eh.e, dist = eh.t, F = def.falloff;
      const mul = dist <= F[0] ? 1 : dist >= F[1] ? F[2] : lerp(1, F[2], (dist - F[0]) / (F[1] - F[0]));
      const armorMul = e.armored && !eh.head ? 0.8 : 1;
      const dmg = def.dmg * mul * (eh.head ? def.head : 1) * armorMul;
      const kind = e.kind;
      const killed = e.takeDamage(dmg, eh.head, d.x, d.z, this);
      this.fx.blood(eh.x, eh.y, eh.z, d.x, d.y, d.z, eh.head);
      if (first || killed) {
        this.hud.hitmarker(eh.head, killed);
        this.audio.hit(eh.head, killed);
      }
      if (killed) this.onKill(e, kind, eh.head, def);
      ex = eh.x; ey = eh.y; ez = eh.z;
      hitEnemy = true;
    } else if (wHit) {
      ex = o.x + d.x * H.t; ey = o.y + d.y * H.t; ez = o.z + d.z * H.t;
      const surf = H.c.surf;
      this.fx.impact(ex, ey, ez, H.nx, H.ny, H.nz, surf);
      this.fx.decals.add(ex, ey, ez, H.nx, H.ny, H.nz, rand(0.09, 0.14) * (def.id === 'shotgun' ? 0.7 : 1));
      if (first) {
        const pn = this.pan(ex, ez);
        this.audio.impact(H.t, surf, pn);
        if ((surf === 'metal' && Math.random() < 0.4) || Math.random() < 0.08) this.audio.ricochet(H.t, pn);
      }
    } else {
      ex = o.x + d.x * def.range; ey = o.y + d.y * def.range; ez = o.z + d.z * def.range;
    }
    if (tracer) this.fx.tracers.spawn(muzzle.x, muzzle.y, muzzle.z, ex, ey, ez, [4, 2.6, 1.2], 420, 6, 0.028, 2.2);
    return hitEnemy;
  }

  onKill(e, kind, head, def) {
    const s = this.stats;
    s.kills++;
    if (head) s.heads++;
    const now = this.time;
    this.killTimes = this.killTimes.filter((t) => now - t < 2.2);
    this.killTimes.push(now);
    const multi = this.killTimes.length;
    let pts = KINDS[kind].score + (head ? 60 : 0) + (e.armored ? 50 : 0);
    if (multi >= 2) pts += 75 * (multi - 1);
    s.score += pts;
    this.hud.killfeed(`${def.name} ▸ ${e.armored ? 'ARMORED ' : ''}${KIND_LABEL[kind]}  +${pts}`, head);
    if (multi === 2) this.hud.popup('DOUBLE KILL');
    else if (multi === 3) this.hud.popup('TRIPLE KILL');
    else if (multi >= 4) this.hud.popup('RAMPAGE');
    else if (head) this.hud.popup('HEADSHOT');
    const r = Math.random(), p = e.body.pos;
    if (r < 0.32) this.pickups.spawn('ammo', p.x, p.y, p.z);
    else if (r < 0.46) this.pickups.spawn('health', p.x, p.y, p.z);
    else if (r < 0.56) this.pickups.spawn('armor', p.x, p.y, p.z);
  }

  enemyShot(e, m, hit, dist, dmg) {
    const cam = this.camera, P = this.player;
    let ex, ey, ez;
    const pn = this.pan(e.body.pos.x, e.body.pos.z);
    if (hit) {
      ex = cam.position.x + rand(-0.2, 0.2);
      ey = cam.position.y - rand(0.1, 0.5);
      ez = cam.position.z + rand(-0.2, 0.2);
      P.damage(dmg * this.enemyDmgMul, e.body.pos.x, e.body.pos.z);
    } else {
      const a = rand(0, Math.PI * 2), r = rand(0.6, 1.9);
      ex = cam.position.x + Math.cos(a) * r;
      ey = cam.position.y + Math.sin(a) * r * 0.6 - 0.2;
      ez = cam.position.z + Math.sin(a) * r;
      if (r < 1.3) this.audio.whiz(pn);
      // Continue past the player and find what the bullet actually strikes.
      let dx = ex - m.x, dy = ey - m.y, dz = ez - m.z;
      const L = Math.hypot(dx, dy, dz);
      dx /= L; dy /= L; dz /= L;
      if (this.world.col.raycast(m.x, m.y, m.z, dx, dy, dz, L + 30, this._hit2)) {
        const t = this._hit2.t;
        ex = m.x + dx * t; ey = m.y + dy * t; ez = m.z + dz * t;
        const H = this._hit2;
        if (Math.hypot(ex - cam.position.x, ez - cam.position.z) < 45) {
          this.fx.impact(ex, ey, ez, H.nx, H.ny, H.nz, H.c.surf);
          this.fx.decals.add(ex, ey, ez, H.nx, H.ny, H.nz, rand(0.08, 0.12));
        }
      } else {
        ex = m.x + dx * (L + 30); ey = m.y + dy * (L + 30); ez = m.z + dz * (L + 30);
      }
    }
    let dx = ex - m.x, dy = ey - m.y, dz = ez - m.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    this.fx.muzzle(m.x, m.y, m.z, dx / L, dy / L, dz / L, e.kind === 'sniper');
    const col = e.kind === 'sniper' ? [5, 1.2, 1.0] : [4, 1.4, 0.6];
    this.fx.tracers.spawn(m.x, m.y, m.z, ex, ey, ez, col, e.kind === 'sniper' ? 520 : 320, e.kind === 'sniper' ? 12 : 5, e.kind === 'sniper' ? 0.045 : 0.03);
    this.audio.gun(e.K.sound, dist, pn);
  }

  // ---------- Aim assist (touch only) ----------
  updateAimAssist(dt) {
    const A = this.aimAssist;
    A.onTarget = false;
    A.pullYaw = 0;
    A.pullPitch = 0;
    const w = this.weapons;
    const adsNow = w.adsT > 0.15;
    const justAds = adsNow && !A.wasAds;
    A.wasAds = adsNow;
    if (!this.settings.assist || this.input.lookIsMouse || this.player.dead) return;
    const cam = this.camera;
    const f = cam.getWorldDirection(this._v);
    let best = null, bestAng = 1e9, bestDir = null;
    for (const e of this.enemies.list) {
      if (!e.alive || !e.los) continue;
      const d = this._w.set(e.body.pos.x - cam.position.x, e.body.pos.y + 1.3 - cam.position.y, e.body.pos.z - cam.position.z);
      const dist = d.length();
      if (dist > 120) continue;
      d.divideScalar(dist);
      const ang = Math.acos(clamp(d.dot(f), -1, 1));
      const thr = (adsNow ? 4.5 : 3.0) * DEG + Math.atan2(0.5, dist);
      if (ang < thr && ang < bestAng) {
        bestAng = ang;
        best = e;
        bestDir = this._d.copy(d);
      }
    }
    if (!best) return;
    A.onTarget = true;
    const p = this.player;
    const ty = Math.atan2(-bestDir.x, -bestDir.z);
    const tp = Math.asin(clamp(bestDir.y, -1, 1));
    const dyaw = wrapAngle(ty - (p.yaw + p.recoilY));
    const dpitch = tp - (p.pitch + p.recoilP);
    if (justAds && bestAng < 9 * DEG) {
      A.pullYaw = dyaw * 0.6;
      A.pullPitch = dpitch * 0.6;
    } else if (this.input.fire || adsNow) {
      const k = Math.min(1, dt * 2.2);
      A.pullYaw = dyaw * k * 0.45;
      A.pullPitch = dpitch * k * 0.25;
    }
  }

  // ---------- Frame ----------
  frame(now) {
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) return;
    this.trackPerf(dt);
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.frameNo++;
    this.input.update();
    if (this.input.consume('pause')) {
      if (this.state === 'play' && !this.player.dead) this.setState('pause');
    }
    if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'play') this.updatePlay(dt);
    else if (this.state === 'over') this.updateOver(dt);
    this.render(dt);
  }

  updateMenu(dt) {
    this.menuT = (this.menuT || 0) + dt;
    const S = this.world.spawn;
    const a = this.menuT * 0.05 + 0.6;
    const cam = this.camera;
    cam.position.set(S.x + Math.cos(a) * 62, 26 + Math.sin(this.menuT * 0.2) * 3, S.z + Math.sin(a) * 62);
    cam.lookAt(S.x, 10, S.z);
    cam.fov = 60;
    cam.updateProjectionMatrix();
    this.fx.update(dt, this.world.col, null, cam.position);
    this.sky.material.uniforms.uTime.value = this.time;
  }

  updateOver(dt) {
    this.fx.update(dt * 0.3, this.world.col, null, this.camera.position);
    this.enemies.update(dt * 0.3, this);
  }

  updatePlay(dt) {
    const p = this.player, w = this.weapons, inp = this.input, cam = this.camera;
    if (p.dead) {
      this.deathT += dt;
      this.timeScale = lerp(0.35, 0.15, clamp(this.deathT / 1.5, 0, 1));
      const sdt = dt * this.timeScale;
      p.applyCamera(cam, sdt);
      const k = clamp(this.deathT / 1.4, 0, 1);
      cam.position.y -= k * 1.1;
      cam.rotation.z += k * 0.6;
      cam.rotation.x -= k * 0.25;
      cam.updateMatrixWorld();
      this.enemies.update(sdt, this);
      this.fx.update(sdt, this.world.col, this.audio, cam.position);
      if (this.deathT > 2.0) this.setState('over');
      this.updateHud(dt);
      return;
    }
    this.updateAimAssist(dt);
    p.update(dt, inp, w);
    p.applyCamera(cam, dt);
    const target = w.fovTarget(this.baseFov + (p.sprinting ? 6 : 0)) + p.fovPunch;
    cam.fov = lerp(cam.fov, target, 1 - Math.exp(-18 * dt));
    cam.updateProjectionMatrix();
    w.update(dt, inp, p, cam);

    this.navT -= dt;
    if (this.navT <= 0) {
      this.navT = 0.4;
      this.nav.update(p.body.pos.x, p.body.pos.z);
    }
    this.enemies.update(dt, this);
    this.pickups.update(dt, this);
    if (this.mode === 'bots') this.updateBots(dt);
    else this.updateWaves(dt);
    this.fx.update(dt, this.world.col, this.audio, cam.position);
    this.audio.update(dt);
    this.mLight.intensity = Math.max(0, this.mLight.intensity - dt * 600);
    this.sky.material.uniforms.uTime.value = this.time;
    this.updateHud(dt);
  }

  updateHud(dt) {
    const p = this.player, w = this.weapons, H = this.hud, cam = this.camera;
    H.vitals(p.health, p.armor);
    H.weapon(w.cur, w.st.mag, w.st.reserve, w.reloadT > 0);
    H.wave(this.mode === 'bots' ? '100 BOTS' : 'WAVE ' + this.wave, this.toSpawn + this.enemies.aliveCount);
    H.score(this.stats.score);
    const spread = w.spread(p);
    const gap = (Math.tan(spread) / Math.tan((cam.fov * DEG) / 2)) * (window.innerHeight / 2) + 5;
    const f = cam.getWorldDirection(this._v);
    const H2 = this._hit2;
    const wt = this.world.col.raycast(cam.position.x, cam.position.y, cam.position.z, f.x, f.y, f.z, 200, H2) ? H2.t : 200;
    const onT = !!this.enemies.raycast(cam.position, f, wt);
    H.crosshair(gap, w.adsT < 0.6 && !p.dead && w.sprintT < 0.5, onT);
    H.scope(w.scoped);
    if (this.frameNo % 2 === 0) H.drawMinimap(p, this.enemies, this.pickups);
    H.update(dt);
  }

  render(dt) {
    const cam = this.camera;
    this.sky.position.copy(cam.position);
    // Shadow frustum follows the camera, snapped to texels to avoid shimmering.
    const q = this.q;
    const f = cam.getWorldDirection(this._v);
    const tex = (sizeOf(this.sun.shadow.camera) / q.shadow);
    const cx = Math.round((cam.position.x + f.x * 22) / tex) * tex;
    const cz = Math.round((cam.position.z + f.z * 22) / tex) * tex;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx + SUN_DIR.x * 200, SUN_DIR.y * 200, cz + SUN_DIR.z * 200);
    this.sun.target.updateMatrixWorld();
    if (this.frameNo % q.shadowEvery === 0) this.renderer.shadowMap.needsUpdate = true;

    const h = this.post.h;
    this.fx.setScale(h / (2 * Math.tan((cam.fov * DEG) / 2)));
    const p = this.player;
    const playing = this.state === 'play' || this.state === 'pause';
    const showVm = playing && !this.weapons.scoped && !p.dead;
    this.enemies.render();
    this.post.render(this.scene, cam, this.weapons.scene, this.weapons.cam, showVm, {
      damage: playing ? clamp(p.hurtT, 0, 1) : 0,
      lowHealth: playing ? clamp((40 - p.health) / 40, 0, 1) : 0,
      time: this.time,
      scope: this.weapons.scoped ? 1 : 0,
      exposure: 1.0,
    });
  }

  // ---------- Quality / performance ----------
  queueResize() {
    clearTimeout(this._rz);
    this._rz = setTimeout(() => this.applyQuality(false), 120);
  }

  applyQuality(full) {
    const q = this.q;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pr = dpr * q.scale * this.dyn;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const bw = Math.max(1, Math.floor(w * pr)), bh = Math.max(1, Math.floor(h * pr));
    this.post.setSize(bw, bh, q.msaa, q.bloom);
    this.fx.setQuality(q.fx);
    if (full && this.sun.shadow.mapSize.x !== q.shadow) {
      this.sun.shadow.mapSize.set(q.shadow, q.shadow);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  trackPerf(rawDt) {
    this.fpsT += rawDt;
    this.fpsFrames++;
    if (this.fpsT >= 0.5) {
      this.hud.fps(Math.round(this.fpsFrames / this.fpsT) + ' FPS · ' + this.qName.toUpperCase() + ' ' + Math.round(this.dyn * 100) + '%', this.settings.showFps && this.state === 'play');
      this.fpsT = 0;
      this.fpsFrames = 0;
    }
    if (this.settings.quality !== 'auto' || this.state !== 'play' || rawDt > 0.25) return;
    const P = this.perf;
    P.acc += rawDt;
    P.frames++;
    P.t += rawDt;
    if (P.t < 2) return;
    const avg = (P.acc / P.frames) * 1000;
    P.acc = 0; P.frames = 0; P.t = 0;
    if (avg > 19.5) {
      P.good = 0;
      if (this.dyn > 0.66) this.dyn = Math.max(0.66, this.dyn - 0.08);
      else if (this.qName === 'high') { this.qName = 'med'; this.dyn = 0.9; }
      else if (this.qName === 'med') { this.qName = 'low'; this.dyn = 1; }
      else return;
      this.applyQuality(true);
    } else if (avg < 17.4) {
      P.good++;
      if (this.dyn < 1 && P.good >= 2) {
        this.dyn = Math.min(1, this.dyn + 0.04);
        P.good = 0;
        this.applyQuality(false);
      } else if (this.dyn >= 1 && P.good >= 5 && this.qName === 'low') {
        this.qName = 'med';
        this.dyn = 0.8;
        P.good = 0;
        this.applyQuality(true);
      }
    }
  }
}

function sizeOf(c) { return c.right - c.left; }

const game = new Game();
window.__game = game;
game.boot().catch((err) => {
  console.error(err);
  $('load-msg').textContent = 'FAILED TO START: ' + (err && err.message ? err.message : err);
});
