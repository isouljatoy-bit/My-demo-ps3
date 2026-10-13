import { clamp, rand } from './utils.js';

// Per-weapon synthesis recipes.
// crack: [bandpass freq, Q, decay, gain]  body: [lowpass freq, decay, gain]  thump: [f0, f1, decay, gain]
const GUNS = {
  pistol:  { crack: [2600, 0.9, 0.07, 1.0], body: [1400, 0.16, 0.8], thump: [170, 55, 0.12, 0.9], vol: 0.85, rev: 0.35 },
  ar:      { crack: [1900, 0.8, 0.10, 1.1], body: [1100, 0.22, 1.0], thump: [130, 45, 0.16, 1.0], vol: 0.95, rev: 0.45 },
  smg:     { crack: [3000, 1.0, 0.06, 0.9], body: [1700, 0.12, 0.7], thump: [190, 70, 0.09, 0.75], vol: 0.8, rev: 0.3 },
  shotgun: { crack: [1300, 0.7, 0.14, 1.2], body: [750, 0.38, 1.3], thump: [95, 35, 0.26, 1.3], vol: 1.0, rev: 0.6 },
  dmr:     { crack: [2300, 0.8, 0.15, 1.3], body: [950, 0.42, 1.2], thump: [105, 38, 0.24, 1.3], vol: 1.0, rev: 0.7 },
  enemy:   { crack: [1800, 0.8, 0.09, 1.0], body: [1000, 0.2, 0.9], thump: [130, 50, 0.14, 0.8], vol: 0.9, rev: 0.4 },
  esmg:    { crack: [2800, 0.9, 0.06, 0.9], body: [1500, 0.12, 0.7], thump: [180, 65, 0.09, 0.7], vol: 0.85, rev: 0.35 },
  esniper: { crack: [2200, 0.8, 0.18, 1.3], body: [900, 0.5, 1.2], thump: [100, 38, 0.25, 1.2], vol: 1.0, rev: 0.8 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.sirenT = 25;
    this.hornT = 12;
    this.tinkBudget = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.18;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.6);
    this.revIn = ctx.createGain();
    this.revIn.gain.value = 0.5;
    this.revIn.connect(this.reverb);
    this.reverb.connect(this.master);

    this.noiseBuf = this.makeNoise(2, false);
    this.brownBuf = this.makeNoise(4, true);

    // iOS unlock: play a silent buffer inside the gesture.
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);

    this.ready = true;
    this.startAmbience();
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  makeNoise(seconds, brown) {
    const ctx = this.ctx;
    const len = (seconds * ctx.sampleRate) | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = (seconds * ctx.sampleRate) | 0;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Early slap-back off buildings + diffuse tail.
        const slap = (i > ctx.sampleRate * 0.045 && i < ctx.sampleRate * 0.06) ? 0.6 : 0;
        d[i] = (Math.random() * 2 - 1) * (Math.pow(1 - t, decay) * 0.6 + slap * (1 - t));
      }
    }
    return buf;
  }

  // Output strip: gain -> (panner) -> sfx + reverb send
  out(pan = 0, vol = 1, rev = 0.2) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    let tail = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      tail = p;
    }
    tail.connect(this.sfx);
    if (rev > 0) {
      const r = ctx.createGain();
      r.gain.value = rev;
      tail.connect(r);
      r.connect(this.revIn);
    }
    return g;
  }

  noise(dest, t, dur, type, freq, q, gain, attack = 0.001) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return f;
  }

  tone(dest, t, type, f0, f1, dur, gain, attack = 0.002) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  gun(kind, dist = 0, pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const P = GUNS[kind] || GUNS.ar;
    const far = dist > 0;
    const vol = (far ? Math.min(1, 9 / (dist + 6)) * 0.85 : 1) * P.vol;
    if (vol < 0.02) return;
    const o = this.out(pan, vol, P.rev + (far ? 0.3 : 0));
    let dest = o;
    if (far) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600 + 9000 * Math.exp(-dist / 35);
      lp.connect(o);
      dest = lp;
    }
    this.noise(dest, t, P.crack[2], 'bandpass', P.crack[0] * rand(0.9, 1.1), P.crack[1], P.crack[3]);
    this.noise(dest, t, P.body[1], 'lowpass', P.body[0] * rand(0.92, 1.08), 0.7, P.body[2]);
    this.tone(dest, t, 'sine', P.thump[0] * rand(0.95, 1.05), P.thump[1], P.thump[2], P.thump[3]);
    if (!far) this.noise(dest, t + 0.025, 0.03, 'highpass', 4200, 0.7, 0.12);
  }

  mech(kind) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.7, 0.08);
    switch (kind) {
      case 'magout':
        this.noise(o, t, 0.05, 'bandpass', 2200, 2, 0.5);
        this.tone(o, t, 'triangle', 900, 500, 0.05, 0.12);
        break;
      case 'magin':
        this.noise(o, t, 0.04, 'bandpass', 1500, 2, 0.6);
        this.noise(o, t + 0.06, 0.05, 'bandpass', 3200, 3, 0.55);
        this.tone(o, t + 0.06, 'square', 1400, 800, 0.03, 0.06);
        break;
      case 'bolt':
        this.noise(o, t, 0.05, 'bandpass', 2600, 2.5, 0.6);
        this.noise(o, t + 0.11, 0.06, 'bandpass', 1900, 2.5, 0.7);
        break;
      case 'pump':
        this.noise(o, t, 0.08, 'bandpass', 1200, 1.5, 0.7);
        this.noise(o, t + 0.14, 0.08, 'bandpass', 1600, 1.5, 0.75);
        break;
      case 'shell':
        this.noise(o, t, 0.05, 'bandpass', 2400, 3, 0.45);
        this.tone(o, t + 0.02, 'triangle', 1800, 1200, 0.04, 0.08);
        break;
      case 'slide':
        this.noise(o, t, 0.06, 'bandpass', 3000, 2, 0.5);
        this.noise(o, t + 0.08, 0.04, 'bandpass', 2200, 3, 0.55);
        break;
      default:
        this.noise(o, t, 0.04, 'highpass', 3000, 1, 0.4);
    }
  }

  empty() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.6, 0.05);
    this.noise(o, t, 0.025, 'highpass', 3500, 1, 0.5);
    this.tone(o, t, 'square', 2200, 1800, 0.02, 0.05);
  }

  swap() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.5, 0.05);
    this.noise(o, t, 0.12, 'bandpass', 1300, 0.8, 0.35, 0.03);
    this.noise(o, t + 0.16, 0.04, 'bandpass', 2800, 2, 0.4);
  }

  hit(head, kill) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.55, 0.05);
    this.tone(o, t, 'square', head ? 2600 : 1700, head ? 2300 : 1500, 0.045, 0.25);
    if (head) this.tone(o, t + 0.01, 'sine', 3900, 3800, 0.18, 0.18);
    if (kill) {
      this.tone(o, t + 0.05, 'triangle', 880, 860, 0.12, 0.25);
      this.tone(o, t + 0.1, 'triangle', 1320, 1300, 0.16, 0.2);
    }
  }

  hurt() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.8, 0.1);
    this.noise(o, t, 0.18, 'lowpass', 420, 0.8, 1.0);
    this.tone(o, t, 'sine', 95, 45, 0.22, 0.9);
  }

  whiz(pan) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = this.out(pan, 0.55, 0.1);
    const f = this.noise(o, t, 0.16, 'bandpass', 3400, 4, 0.7, 0.01);
    f.frequency.setValueAtTime(3400, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.16);
  }

  ricochet(dist, pan) {
    if (!this.ready || dist > 45) return;
    const t = this.ctx.currentTime;
    const o = this.out(pan, 0.35 * Math.min(1, 6 / (dist + 3)), 0.25);
    const osc = this.tone(o, t, 'sine', rand(2400, 3600), rand(900, 1300), 0.22, 0.25, 0.005);
    osc.detune.value = rand(-50, 50);
    this.noise(o, t, 0.04, 'highpass', 3000, 1, 0.4);
  }

  impact(dist, surface, pan) {
    if (!this.ready || dist > 35) return;
    const t = this.ctx.currentTime;
    const o = this.out(pan, Math.min(1, 5 / (dist + 2)) * 0.5, 0.1);
    if (surface === 'metal') this.tone(o, t, 'triangle', rand(1800, 2600), 1400, 0.12, 0.3);
    this.noise(o, t, 0.06, 'bandpass', surface === 'wood' ? 900 : 1600, 1.2, 0.5);
  }

  step(sprint, surface) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(rand(-0.15, 0.15), sprint ? 0.32 : 0.22, 0.04);
    const f = surface === 'metal' ? 1900 : surface === 'wood' ? 700 : 950;
    this.noise(o, t, 0.06, 'bandpass', f * rand(0.85, 1.15), 1.4, 0.8, 0.004);
    if (surface === 'metal') this.tone(o, t, 'triangle', rand(380, 460), 300, 0.08, 0.12);
  }

  land(speed) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, Math.min(1, speed / 14), 0.1);
    this.noise(o, t, 0.12, 'lowpass', 700, 0.8, 1.0, 0.003);
    this.tone(o, t, 'sine', 120, 50, 0.14, 0.7);
  }

  jump() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.25, 0.02);
    this.noise(o, t, 0.1, 'bandpass', 800, 1, 0.5, 0.01);
  }

  tink(dist) {
    if (!this.ready || this.tinkBudget > 6 || dist > 8) return;
    this.tinkBudget++;
    const t = this.ctx.currentTime;
    const o = this.out(rand(-0.4, 0.4), 0.18, 0.05);
    this.tone(o, t, 'sine', rand(3800, 5200), 3000, 0.09, 0.3);
    this.tone(o, t + 0.07, 'sine', rand(4200, 5600), 3200, 0.06, 0.15);
  }

  pickup(type) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.45, 0.2);
    const base = type === 'health' ? 523 : type === 'armor' ? 392 : 659;
    [1, 1.25, 1.5, 2].forEach((m, i) => this.tone(o, t + i * 0.06, 'triangle', base * m, base * m, 0.14, 0.35));
  }

  waveStart() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = this.out(0, 0.5, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.6);
    lp.frequency.exponentialRampToValueAtTime(400, t + 1.6);
    lp.connect(o);
    [110, 164.8, 220, 261.6].forEach((f) => {
      this.tone(lp, t, 'sawtooth', f, f * 0.995, 1.6, 0.2, 0.08);
    });
    this.tone(o, t, 'sine', 55, 40, 1.4, 0.6, 0.02);
  }

  waveClear() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.45, 0.5);
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(o, t + i * 0.09, 'triangle', f, f, 0.5, 0.3, 0.01));
  }

  death() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.7, 0.8);
    this.tone(o, t, 'sawtooth', 220, 40, 2.2, 0.35, 0.02);
    this.tone(o, t, 'sine', 110, 30, 2.5, 0.6, 0.02);
    this.noise(o, t, 1.2, 'lowpass', 300, 0.5, 0.6, 0.05);
  }

  ui() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.3, 0.05);
    this.tone(o, t, 'triangle', 880, 1100, 0.07, 0.3);
  }

  glint(dist, pan) {
    if (!this.ready || dist > 140) return;
    const t = this.ctx.currentTime;
    const o = this.out(pan, 0.12, 0.3);
    this.tone(o, t, 'sine', 2900, 3100, 0.25, 0.25, 0.01);
  }

  startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start();

    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.35;
    const wg = ctx.createGain();
    wg.gain.value = 0.025;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.018;
    lfo.connect(lg);
    lg.connect(wg.gain);
    wind.connect(bp);
    bp.connect(wg);
    wg.connect(this.master);
    wind.start();
    lfo.start();
  }

  siren() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = rand(4, 7);
    const o = this.out(rand(-0.9, 0.9), 0.0, 0.6);
    o.gain.setValueAtTime(0.0001, t);
    o.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.4);
    o.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(o);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 760;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rand(0.45, 0.8);
    const lg = ctx.createGain();
    lg.gain.value = 170;
    lfo.connect(lg);
    lg.connect(osc.frequency);
    osc.connect(lp);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur);
    lfo.stop(t + dur);
  }

  horn() {
    const t = this.ctx.currentTime;
    const o = this.out(rand(-0.8, 0.8), 0.04, 0.6);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(o);
    const d = rand(0.25, 0.6);
    this.tone(lp, t, 'sawtooth', 392, 390, d, 0.6, 0.01);
    this.tone(lp, t, 'sawtooth', 494, 492, d, 0.5, 0.01);
  }

  update(dt) {
    if (!this.ready) return;
    this.tinkBudget = Math.max(0, this.tinkBudget - dt * 10);
    this.sirenT -= dt;
    if (this.sirenT <= 0) {
      this.sirenT = rand(25, 50);
      this.siren();
    }
    this.hornT -= dt;
    if (this.hornT <= 0) {
      this.hornT = rand(10, 26);
      this.horn();
    }
  }
}
