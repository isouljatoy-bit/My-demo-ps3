import { MAP } from './world.js';
import { WEAPONS } from './weapons.js';
import { GANGS } from './enemies.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.hp = $('hp-bar');
    this.hpFill = this.hp.firstElementChild;
    this.arFill = $('ar-bar').firstElementChild;
    this.wName = $('wp-name');
    this.wAmmo = $('wp-ammo');
    this.wSlots = $('wp-slots');
    this.waveNum = $('wave-num');
    this.waveLeft = $('wave-left');
    this.scoreEl = $('score');
    this.cross = $('crosshair');
    this.crossParts = {
      t: this.cross.querySelector('.ch-t'), b: this.cross.querySelector('.ch-b'),
      l: this.cross.querySelector('.ch-l'), r: this.cross.querySelector('.ch-r'),
    };
    this.hit = $('hitmarker');
    this.dmgEls = [...$('dmg-ind').children];
    this.dmgCursor = 0;
    this.dmgT = [0, 0, 0, 0];
    this.feed = $('killfeed');
    this.banner = $('banner');
    this.bannerT = this.banner.querySelector('.t');
    this.bannerS = this.banner.querySelector('.s');
    this.popupEl = $('popup');
    this.scopeEl = $('scope');
    this.fpsEl = $('fps');
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.cache = Object.create(null);
    this.hitT = 0;
    this.bannerTime = 0;
    this.popupTime = 0;
    this.feedItems = [];
    WEAPONS.forEach((w, i) => {
      const s = document.createElement('span');
      s.textContent = String(i + 1);
      this.wSlots.appendChild(s);
    });
    this.slotEls = [...this.wSlots.children];
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  set(key, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(val);
  }

  vitals(health, armor) {
    const h = Math.max(0, Math.round(health)), a = Math.max(0, Math.round(armor));
    this.set('hp', h, (v) => {
      this.hpFill.style.transform = `scaleX(${v / 100})`;
      this.hp.classList.toggle('low', v < 30);
    });
    this.set('ar', a, (v) => { this.arFill.style.transform = `scaleX(${v / 100})`; });
  }

  weapon(idx, mag, reserve, reloading) {
    const w = WEAPONS[idx];
    this.set('wname', reloading ? w.name + ' · RELOADING' : w.name, (v) => { this.wName.textContent = v; });
    const res = reserve === Infinity ? '∞' : String(reserve);
    this.set('ammo', mag + '/' + res, () => {
      this.wAmmo.innerHTML = `${mag} <small>/ ${res}</small>`;
      this.wAmmo.classList.toggle('empty', mag === 0);
    });
    this.set('slot', idx, (v) => this.slotEls.forEach((s, i) => s.classList.toggle('on', i === v)));
  }

  wave(n, left, lives) {
    this.set('wave', n, (v) => { this.waveNum.textContent = v; });
    this.set('left', left + '|' + lives, () => {
      this.waveLeft.textContent = left + (left === 1 ? ' HOSTILE' : ' HOSTILES') + (lives !== undefined ? ' · ' + '♥'.repeat(Math.max(0, lives)) : '');
    });
  }

  // Respawn countdown overlay; t < 0 hides it.
  respawn(t, canSkip) {
    const el = this.respawnEl || (this.respawnEl = document.getElementById('respawn'));
    if (t < 0) { this.set('rsp', 'off', () => el.classList.add('hidden')); return; }
    this.set('rsp', Math.ceil(t) + (canSkip ? 's' : ''), () => {
      el.classList.remove('hidden');
      el.querySelector('b').textContent = Math.max(1, Math.ceil(t));
      el.querySelector('small').style.visibility = canSkip ? 'visible' : 'hidden';
    });
  }

  // Gang War: label plus one colored count per crew.
  gangs(gangs, counts) {
    this.set('wave', 'GANG WAR', (v) => { this.waveNum.textContent = v; });
    this.set('left', counts.join(','), () => {
      this.waveLeft.innerHTML = gangs.map((g, i) =>
        `<span style="color:${g.css};opacity:${counts[i] ? 1 : 0.35}">${i === 0 ? 'YOU+' : ''}${g.name} ${counts[i]}</span>`).join(' · ');
    });
  }

  score(s) { this.set('score', s, (v) => { this.scoreEl.textContent = v.toLocaleString(); }); }

  crosshair(gapPx, visible, onTarget) {
    const g = Math.round(Math.min(gapPx, 120));
    this.set('cvis', visible, (v) => { this.cross.style.display = v ? '' : 'none'; });
    if (!visible) return;
    this.set('cgap', g, (v) => {
      const P = this.crossParts;
      P.t.style.top = (-v - 9) + 'px';
      P.b.style.top = v + 'px';
      P.l.style.left = (-v - 9) + 'px';
      P.r.style.left = v + 'px';
    });
    this.set('ctgt', onTarget, (v) => this.cross.classList.toggle('on-target', v));
  }

  hitmarker(head, kill) {
    this.hitT = kill ? 0.35 : 0.2;
    this.hit.classList.toggle('head', head && !kill);
    this.hit.classList.toggle('kill', kill);
    this.hit.style.opacity = '1';
    this.hit.style.transform = `scale(${kill ? 1.3 : 1})`;
  }

  damageFrom(angle) {
    const i = this.dmgCursor;
    this.dmgCursor = (i + 1) % this.dmgEls.length;
    this.dmgT[i] = 1.1;
    this.dmgEls[i].style.transform = `rotate(${angle}rad)`;
    this.dmgEls[i].style.opacity = '1';
  }

  killfeed(text, head, color) {
    const d = document.createElement('div');
    d.textContent = text;
    if (head) d.classList.add('head');
    if (color) d.style.borderRightColor = color;
    this.feed.prepend(d);
    this.feedItems.push({ el: d, t: 3.5 });
    while (this.feed.children.length > 4) this.feed.lastChild.remove();
  }

  showBanner(title, sub, dur = 2.6) {
    this.bannerT.textContent = title;
    this.bannerS.textContent = sub || '';
    this.banner.style.opacity = '1';
    this.bannerTime = dur;
  }

  popup(text) {
    this.popupEl.textContent = text;
    this.popupEl.style.opacity = '1';
    this.popupEl.style.transform = 'translateX(-50%) translateY(0)';
    this.popupTime = 1.1;
  }

  scope(on) { this.set('scope', on, (v) => this.scopeEl.classList.toggle('hidden', !v)); }

  fps(v, show) {
    this.set('fpsShow', show, (s) => { this.fpsEl.style.display = s ? '' : 'none'; });
    if (show) this.set('fps', v, (x) => { this.fpsEl.textContent = x; });
  }

  update(dt) {
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.hit.style.opacity = '0';
    }
    for (let i = 0; i < this.dmgT.length; i++) {
      if (this.dmgT[i] > 0) {
        this.dmgT[i] -= dt;
        this.dmgEls[i].style.opacity = String(Math.max(0, Math.min(1, this.dmgT[i])));
      }
    }
    if (this.bannerTime > 0) {
      this.bannerTime -= dt;
      if (this.bannerTime <= 0) this.banner.style.opacity = '0';
    }
    if (this.popupTime > 0) {
      this.popupTime -= dt;
      const k = Math.max(0, this.popupTime);
      this.popupEl.style.opacity = String(Math.min(1, k * 2));
      this.popupEl.style.transform = `translateX(-50%) translateY(${(1.1 - k) * -18}px)`;
    }
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const f = this.feedItems[i];
      f.t -= dt;
      if (f.t <= 0) {
        f.el.remove();
        this.feedItems.splice(i, 1);
      } else if (f.t < 0.5) f.el.style.opacity = String(f.t * 2);
    }
  }

  clearTransient() {
    this.feed.innerHTML = '';
    this.feedItems.length = 0;
    this.banner.style.opacity = '0';
    this.bannerTime = 0;
    this.popupEl.style.opacity = '0';
    this.hit.style.opacity = '0';
    this.dmgEls.forEach((e) => (e.style.opacity = '0'));
    this.dmgT.fill(0);
  }

  // ---------- Minimap ----------
  buildMinimap(world) {
    const S = 4; // px per meter
    const size = Math.ceil(MAP.SIZE * S);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.fillStyle = '#3c4048';
    x.fillRect(0, 0, size, size);
    const toPx = (v) => (v + MAP.HALF) * S;
    const sorted = [...world.mapRects].sort((a, b) => a.h - b.h);
    for (const r of sorted) {
      x.fillStyle = r.color;
      x.fillRect(toPx(r.x0), toPx(r.z0), (r.x1 - r.x0) * S, (r.z1 - r.z0) * S);
      if (r.h > 0) {
        x.strokeStyle = 'rgba(0,0,0,0.45)';
        x.lineWidth = 2;
        x.strokeRect(toPx(r.x0) + 1, toPx(r.z0) + 1, (r.x1 - r.x0) * S - 2, (r.z1 - r.z0) * S - 2);
      }
    }
    x.fillStyle = 'rgba(255,214,90,0.9)';
    for (const s of world.roofSpots) {
      x.beginPath();
      x.arc(toPx(s.x), toPx(s.z), 3, 0, Math.PI * 2);
      x.fill();
    }
    this.mapImg = c;
    this.mapScale = S;
  }

  drawMinimap(player, enemies, pickups) {
    const ctx = this.mmCtx, W = this.mm.width, H = this.mm.height;
    const S = this.mapScale, zoom = 0.75;
    const px = (player.body.pos.x + MAP.HALF) * S, pz = (player.body.pos.z + MAP.HALF) * S;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#23262c';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(player.yaw);
    ctx.scale(zoom, zoom);
    ctx.drawImage(this.mapImg, -px, -pz);
    // Pickups.
    for (const it of pickups.items) {
      if (!it.on) continue;
      const p = it.root.position;
      ctx.fillStyle = it.type === 'health' ? '#5fd068' : it.type === 'armor' ? '#4fa8ff' : '#ffb23e';
      ctx.fillRect((p.x + MAP.HALF) * S - px - 6, (p.z + MAP.HALF) * S - pz - 6, 12, 12);
    }
    // Bots in their crew colors, with height cues.
    for (const e of enemies.list) {
      if (!e.alive) continue;
      const ex = (e.body.pos.x + MAP.HALF) * S - px, ez = (e.body.pos.z + MAP.HALF) * S - pz;
      const dh = e.body.pos.y - player.body.pos.y;
      ctx.fillStyle = GANGS[e.gang].css;
      ctx.beginPath();
      if (dh > 3) { ctx.moveTo(ex, ez - 11); ctx.lineTo(ex + 9, ez + 7); ctx.lineTo(ex - 9, ez + 7); }
      else if (dh < -3) { ctx.moveTo(ex, ez + 11); ctx.lineTo(ex + 9, ez - 7); ctx.lineTo(ex - 9, ez - 7); }
      else ctx.arc(ex, ez, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
    // Player arrow (always up).
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 11);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    // North marker on the rim.
    const a = player.yaw;
    const nx = W / 2 + Math.sin(-a) * (W / 2 - 14) * -1, ny = H / 2 - Math.cos(-a) * (H / 2 - 14);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(nx, ny, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 1);
  }
}
