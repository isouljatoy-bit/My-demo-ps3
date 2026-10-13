import { clamp } from './utils.js';

// Unified input: multi-touch (dynamic joystick, look-drag anywhere on the right,
// fire button that also steers aim) plus keyboard & pointer-lock mouse.
export class Input {
  constructor(game) {
    this.g = game;
    this.move = { x: 0, y: 0 };
    this.lookX = 0;
    this.lookY = 0;
    this.lastLookX = 0;
    this.lastLookY = 0;
    this.lookIsMouse = false;
    this._look = { x: 0, y: 0 };
    this.fireTouches = 0;
    this.jumpTouches = 0;
    this.mouseFire = false;
    this.adsToggle = false;
    this.adsHold = false;
    this.sprintToggle = false;
    this.jumpHeld = false;
    this.jumpTouches = 0;
    this.queue = { jump: false, reload: false, swap: false, pause: false };
    this.slot = -1;
    this.keys = Object.create(null);
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.looks = new Map();
    this.btns = new Map();
    this.joyR = 58;
    this.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.enabled = false;

    this.layer = document.getElementById('touch');
    this.joyBase = document.getElementById('joy-base');
    this.joyKnob = document.getElementById('joy-knob');
    this.btnEls = {
      ads: document.getElementById('b-ads'),
      sprint: document.getElementById('b-sprint'),
    };
    this.bind();
  }

  get fire() { return this.fireTouches > 0 || this.mouseFire; }
  get touchFire() { return this.fireTouches > 0; }
  get ads() { return this.adsToggle || this.adsHold; }
  get sprint() { return this.sprintToggle || this.keys.ShiftLeft || this.keys.ShiftRight || this.joySprint; }
  get joySprint() {
    if (this.joy.id === null) return false;
    return Math.hypot(this.joy.x, this.joy.y) > 0.96 && this.joy.y > 0.75;
  }

  consume(name) {
    const v = this.queue[name];
    this.queue[name] = false;
    return v;
  }

  consumeSlot() {
    const s = this.slot;
    this.slot = -1;
    return s;
  }

  takeLook() {
    this._look.x = this.lookX;
    this._look.y = this.lookY;
    this.lastLookX = this.lookX;
    this.lastLookY = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return this._look;
  }

  update() {
    if (this.joy.id !== null) {
      this.move.x = this.joy.x;
      this.move.y = this.joy.y;
    } else {
      const k = this.keys;
      this.move.x = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      this.move.y = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      const l = Math.hypot(this.move.x, this.move.y);
      if (l > 1) { this.move.x /= l; this.move.y /= l; }
    }
    this.jumpHeld = !!this.keys.Space || this.jumpTouches > 0;
  }

  reset() {
    this.fireTouches = 0;
    this.jumpTouches = 0;
    this.mouseFire = false;
    this.adsToggle = false;
    this.adsHold = false;
    this.sprintToggle = false;
    this.joy.id = null;
    this.joy.x = this.joy.y = 0;
    this.looks.clear();
    for (const [, b] of this.btns) b.el.classList.remove('down');
    this.btns.clear();
    for (const k in this.queue) this.queue[k] = false;
    this.lookX = this.lookY = 0;
    this.keys = Object.create(null);
    this.syncToggles();
    this.resetJoyUI();
  }

  syncToggles() {
    this.btnEls.ads.classList.toggle('toggled', this.adsToggle);
    this.btnEls.sprint.classList.toggle('toggled', this.sprintToggle);
  }

  resetJoyUI() {
    const s = this.joyBase.style;
    s.left = '';
    s.top = '';
    s.bottom = '';
    this.joyBase.classList.remove('active');
    this.joyBase.classList.add('idle');
    this.joyKnob.style.transform = 'translate(0px, 0px)';
  }

  // ---------- Touch ----------
  btnDown(name, id, el) {
    el.classList.add('down');
    this.btns.set(id, { name, el });
    switch (name) {
      case 'fire': this.fireTouches++; break;
      case 'ads': this.adsToggle = !this.adsToggle; this.syncToggles(); break;
      case 'jump': this.queue.jump = true; this.jumpTouches++; break;
      case 'reload': this.queue.reload = true; break;
      case 'swap': this.queue.swap = true; break;
      case 'sprint': this.sprintToggle = !this.sprintToggle; this.syncToggles(); break;
      case 'pause': this.queue.pause = true; break;
      default: break;
    }
    if (navigator.vibrate && name === 'fire') { try { navigator.vibrate(8); } catch (e) { /* unsupported */ } }
  }

  btnUp(id) {
    const b = this.btns.get(id);
    if (!b) return;
    b.el.classList.remove('down');
    if (b.name === 'fire') this.fireTouches = Math.max(0, this.fireTouches - 1);
    if (b.name === 'jump') this.jumpTouches = Math.max(0, this.jumpTouches - 1);
    this.btns.delete(id);
  }

  onTouchStart(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.lookIsMouse = false;
    for (const t of e.changedTouches) {
      const el = t.target && t.target.closest ? t.target.closest('[data-btn]') : null;
      if (el) {
        const name = el.dataset.btn;
        this.btnDown(name, t.identifier, el);
        if (name === 'fire') this.looks.set(t.identifier, { x: t.clientX, y: t.clientY });
        continue;
      }
      if (t.clientX < window.innerWidth * 0.42 && this.joy.id === null) {
        this.joy.id = t.identifier;
        this.joy.ox = t.clientX;
        this.joy.oy = t.clientY;
        this.joy.x = this.joy.y = 0;
        const s = this.joyBase.style;
        s.left = t.clientX + 'px';
        s.top = t.clientY + 'px';
        s.bottom = 'auto';
        this.joyBase.style.marginTop = '-62px';
        this.joyBase.classList.add('active');
        this.joyBase.classList.remove('idle');
        this.joyKnob.style.transform = 'translate(0px, 0px)';
      } else {
        this.looks.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
  }

  onTouchMove(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joy.id) {
        let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
        const d = Math.hypot(dx, dy);
        const R = this.joyR;
        // Floating stick: drag the origin along when the thumb overshoots.
        if (d > R * 1.35) {
          const k = (d - R * 1.35) / d;
          this.joy.ox += dx * k;
          this.joy.oy += dy * k;
          dx = t.clientX - this.joy.ox;
          dy = t.clientY - this.joy.oy;
          this.joyBase.style.left = this.joy.ox + 'px';
          this.joyBase.style.top = this.joy.oy + 'px';
        }
        const cl = Math.min(1, Math.hypot(dx, dy) / R);
        const ang = Math.atan2(dy, dx);
        const dead = 0.12;
        const mag = cl < dead ? 0 : (cl - dead) / (1 - dead);
        this.joy.x = Math.cos(ang) * mag;
        this.joy.y = -Math.sin(ang) * mag;
        this.joyKnob.style.transform = `translate(${Math.cos(ang) * cl * R}px, ${Math.sin(ang) * cl * R}px)`;
        continue;
      }
      const L = this.looks.get(t.identifier);
      if (L) {
        const dx = t.clientX - L.x, dy = t.clientY - L.y;
        // Mild acceleration curve for fast flicks, precise for small adjustments.
        const sp = Math.hypot(dx, dy);
        const acc = 1 + clamp((sp - 6) / 40, 0, 0.6);
        this.lookX += dx * acc;
        this.lookY += dy * acc;
        L.x = t.clientX;
        L.y = t.clientY;
      }
    }
  }

  onTouchEnd(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joy.id) {
        this.joy.id = null;
        this.joy.x = this.joy.y = 0;
        this.resetJoyUI();
      }
      this.looks.delete(t.identifier);
      this.btnUp(t.identifier);
    }
  }

  // ---------- Keyboard / mouse ----------
  bind() {
    const L = this.layer;
    const opts = { passive: false };
    L.addEventListener('touchstart', (e) => this.onTouchStart(e), opts);
    L.addEventListener('touchmove', (e) => this.onTouchMove(e), opts);
    L.addEventListener('touchend', (e) => this.onTouchEnd(e), opts);
    L.addEventListener('touchcancel', (e) => this.onTouchEnd(e), opts);
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
    document.addEventListener('gesturechange', (e) => e.preventDefault(), opts);
    document.addEventListener('dblclick', (e) => e.preventDefault(), opts);
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (!this.enabled && e.code !== 'Escape') return;
      this.keys[e.code] = true;
      switch (e.code) {
        case 'Space': this.queue.jump = true; e.preventDefault(); break;
        case 'KeyR': this.queue.reload = true; break;
        case 'KeyQ': this.queue.swap = true; break;
        case 'Digit1': this.slot = 0; break;
        case 'Digit2': this.slot = 1; break;
        case 'Digit3': this.slot = 2; break;
        case 'Digit4': this.slot = 3; break;
        case 'Digit5': this.slot = 4; break;
        case 'KeyP': this.queue.pause = true; break;
        default: break;
      }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    const canvas = this.g.renderer.domElement;
    L.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.isTouchEvent(e)) return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.adsHold = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.adsHold = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      this.lookIsMouse = true;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.queue.swap = true;
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.enabled && !this.isTouch) this.queue.pause = true;
    });
  }

  isTouchEvent(e) {
    return e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents;
  }
}
