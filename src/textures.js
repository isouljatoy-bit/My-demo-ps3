import * as THREE from 'three';
import { RNG } from './utils.js';

// All surface art is painted procedurally on canvases, so the game ships with zero image assets.

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function grain(ctx, w, h, amt, rng, chroma = 0) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amt;
    const c = chroma ? (rng.next() - 0.5) * chroma : 0;
    d[i] += n + c;
    d[i + 1] += n;
    d[i + 2] += n - c;
  }
  ctx.putImageData(img, 0, 0);
}

// Draws a soft blob, repeated across the tile edges so the texture stays seamless.
function blot(ctx, w, h, x, y, r, rgba) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const cx = x + ox * w;
      const cy = y + oy * h;
      if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
}

function blots(ctx, w, h, rng, n, rgba, rMin, rMax) {
  for (let i = 0; i < n; i++) blot(ctx, w, h, rng.range(0, w), rng.range(0, h), rng.range(rMin, rMax), rgba);
}

function specks(ctx, w, h, rng, n, lo, hi, aLo, aHi, sMax = 3) {
  for (let i = 0; i < n; i++) {
    const v = rng.range(lo, hi) | 0;
    ctx.fillStyle = `rgba(${v},${v},${v - 3},${rng.range(aLo, aHi)})`;
    ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, sMax), rng.range(1, sMax));
  }
}

function cracks(ctx, w, h, rng, n, rgba) {
  ctx.strokeStyle = rgba;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < n; i++) {
    let x = rng.range(0, w);
    let y = rng.range(0, h);
    let a = rng.range(0, Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = rng.int(6, 16);
    for (let s = 0; s < segs; s++) {
      a += rng.range(-0.7, 0.7);
      x += Math.cos(a) * rng.range(4, 12);
      y += Math.sin(a) * rng.range(4, 12);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Glass with a fake sky reflection — sells "city at golden hour" without any real reflections.
function glass(ctx, x, y, w, h, rng, tone = 0) {
  const g = ctx.createLinearGradient(x, y, x + w * 0.5, y + h);
  if (tone === 0) {
    g.addColorStop(0, '#a9cbe4');
    g.addColorStop(0.42, '#5d86a6');
    g.addColorStop(0.5, '#33546f');
    g.addColorStop(1, '#1b2c3d');
  } else {
    g.addColorStop(0, '#c7d9e0');
    g.addColorStop(0.35, '#7aa2b6');
    g.addColorStop(0.55, '#3c6177');
    g.addColorStop(1, '#203646');
  }
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,236,210,0.13)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.15, y);
  ctx.lineTo(x + w * 0.42, y);
  ctx.lineTo(x + w * 0.1, y + h);
  ctx.lineTo(x - w * 0.05, y + h);
  ctx.closePath();
  ctx.fill();
  const r = rng.next();
  if (r < 0.28) {
    ctx.fillStyle = 'rgba(232,220,190,0.7)';
    ctx.fillRect(x, y, w, h * rng.range(0.25, 0.7));
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let yy = y + 4; yy < y + h * 0.7; yy += 5) ctx.fillRect(x, yy, w, 1);
  } else if (r < 0.4) {
    ctx.fillStyle = 'rgba(255,190,120,0.28)';
    ctx.fillRect(x, y, w, h);
  } else if (r < 0.5) {
    ctx.fillStyle = 'rgba(150,40,40,0.35)';
    ctx.fillRect(x, y, w * 0.3, h);
    ctx.fillRect(x + w * 0.7, y, w * 0.3, h);
  }
}

function windowUnit(ctx, x, y, w, h, rng, frame, sill) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x - 5, y - 5, w + 10, h + 12);
  ctx.fillStyle = frame;
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  glass(ctx, x, y, w, h, rng);
  ctx.fillStyle = frame;
  ctx.fillRect(x + w / 2 - 2, y, 4, h);
  ctx.fillRect(x, y + h * 0.42, w, 3);
  ctx.fillStyle = sill;
  ctx.fillRect(x - 8, y + h + 3, w + 16, 7);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 8, y + h + 10, w + 16, 3);
}

// ---------- Ground ----------
function asphalt(rng) {
  const S = 512;
  const [c, x] = mk(S, S);
  x.fillStyle = '#4b4c4f';
  x.fillRect(0, 0, S, S);
  blots(x, S, S, rng, 16, 'rgba(25,25,28,0.25)', 30, 100);
  blots(x, S, S, rng, 8, 'rgba(130,125,118,0.12)', 20, 70);
  specks(x, S, S, rng, 11000, 35, 150, 0.2, 0.55, 3);
  cracks(x, S, S, rng, 7, 'rgba(18,18,18,0.55)');
  blots(x, S, S, rng, 3, 'rgba(10,10,12,0.35)', 12, 26);
  grain(x, S, S, 16, rng);
  return c;
}

function sidewalk(rng) {
  const S = 256;
  const [c, x] = mk(S, S);
  x.fillStyle = '#bdb6ab';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const v = rng.range(-10, 10);
      x.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 250 : 0},${v > 0 ? 240 : 0},${Math.abs(v) / 120})`;
      x.fillRect(i * 128, j * 128, 128, 128);
    }
  }
  blots(x, S, S, rng, 10, 'rgba(70,65,60,0.12)', 10, 40);
  specks(x, S, S, rng, 2500, 120, 210, 0.15, 0.35, 2);
  x.fillStyle = 'rgba(70,64,58,0.65)';
  for (let k = 0; k <= 2; k++) {
    x.fillRect(k * 128 - 1, 0, 2, S);
    x.fillRect(0, k * 128 - 1, S, 2);
  }
  cracks(x, S, S, rng, 2, 'rgba(60,55,50,0.4)');
  grain(x, S, S, 14, rng);
  return c;
}

function concrete(rng) {
  const S = 256;
  const [c, x] = mk(S, S);
  x.fillStyle = '#aaa59d';
  x.fillRect(0, 0, S, S);
  blots(x, S, S, rng, 14, 'rgba(80,76,70,0.12)', 15, 60);
  blots(x, S, S, rng, 8, 'rgba(255,250,240,0.1)', 15, 50);
  specks(x, S, S, rng, 1800, 110, 190, 0.1, 0.3, 2);
  x.fillStyle = 'rgba(60,58,54,0.35)';
  for (let i = 0; i < 4; i++) {
    x.beginPath();
    x.arc(32 + i * 64, 32, 2.5, 0, Math.PI * 2);
    x.arc(32 + i * 64, 160, 2.5, 0, Math.PI * 2);
    x.fill();
  }
  grain(x, S, S, 14, rng);
  return c;
}

function roof(rng) {
  const S = 256;
  const [c, x] = mk(S, S);
  x.fillStyle = '#625f5b';
  x.fillRect(0, 0, S, S);
  specks(x, S, S, rng, 7000, 50, 170, 0.25, 0.6, 2.5);
  blots(x, S, S, rng, 10, 'rgba(30,28,26,0.25)', 15, 50);
  x.fillStyle = 'rgba(30,28,26,0.4)';
  x.fillRect(0, 127, S, 2);
  x.fillRect(127, 0, 2, S);
  grain(x, S, S, 18, rng);
  return c;
}

function grass(rng) {
  const S = 256;
  const [c, x] = mk(S, S);
  x.fillStyle = '#4c7a2f';
  x.fillRect(0, 0, S, S);
  blots(x, S, S, rng, 12, 'rgba(110,90,40,0.22)', 15, 45);
  blots(x, S, S, rng, 12, 'rgba(120,170,60,0.2)', 15, 50);
  for (let i = 0; i < 5000; i++) {
    const g = rng.range(70, 150) | 0;
    x.strokeStyle = `rgba(${(g * 0.55) | 0},${g},${(g * 0.35) | 0},0.55)`;
    x.lineWidth = 1;
    const px = rng.range(0, S);
    const py = rng.range(0, S);
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + rng.range(-2, 2), py - rng.range(3, 7));
    x.stroke();
  }
  grain(x, S, S, 12, rng);
  return c;
}

function pavers(rng) {
  const S = 256;
  const [c, x] = mk(S, S);
  x.fillStyle = '#6e6458';
  x.fillRect(0, 0, S, S);
  const tones = ['#cdb99c', '#c4ae8f', '#d6c4a8', '#bfa88a', '#d0bc9f'];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      x.fillStyle = rng.pick(tones);
      x.fillRect(i * 32 + 1.5, j * 32 + 1.5, 29, 29);
    }
  }
  blots(x, S, S, rng, 10, 'rgba(80,70,60,0.15)', 12, 40);
  specks(x, S, S, rng, 1500, 120, 220, 0.1, 0.3, 2);
  grain(x, S, S, 14, rng);
  return c;
}

function metal(rng) {
  const S = 128;
  const [c, x] = mk(S, S);
  x.fillStyle = '#4b5056';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const ox = i * 16 + (j % 2) * 8;
      const oy = j * 16;
      x.fillStyle = 'rgba(200,205,210,0.35)';
      x.save();
      x.translate(ox + 8, oy + 8);
      x.rotate(Math.PI / 4 * (i % 2 ? 1 : -1));
      x.fillRect(-5, -1.2, 10, 2.4);
      x.restore();
    }
  }
  blots(x, S, S, rng, 6, 'rgba(120,60,30,0.25)', 6, 22);
  grain(x, S, S, 18, rng);
  return c;
}

function wood(rng) {
  const S = 256;
  const [c, x] = mk(S, S);
  const tones = ['#9a6c40', '#8d6037', '#a6774a', '#93673c'];
  for (let i = 0; i < 6; i++) {
    x.fillStyle = rng.pick(tones);
    x.fillRect(0, i * 43, S, 43);
    x.strokeStyle = 'rgba(60,35,15,0.35)';
    for (let k = 0; k < 7; k++) {
      x.beginPath();
      const yy = i * 43 + rng.range(4, 39);
      x.moveTo(0, yy);
      for (let xx = 0; xx <= S; xx += 16) x.lineTo(xx, yy + Math.sin(xx * 0.05 + k) * 1.5);
      x.stroke();
    }
    x.fillStyle = 'rgba(30,18,8,0.7)';
    x.fillRect(0, i * 43 + 41, S, 2);
  }
  x.fillStyle = 'rgba(60,38,18,0.55)';
  x.fillRect(0, 0, S, 18);
  x.fillRect(0, S - 18, S, 18);
  x.fillRect(0, 0, 18, S);
  x.fillRect(S - 18, 0, 18, S);
  x.fillStyle = 'rgba(40,40,40,0.8)';
  [[9, 9], [S - 9, 9], [9, S - 9], [S - 9, S - 9]].forEach(([a, b]) => {
    x.beginPath();
    x.arc(a, b, 3, 0, Math.PI * 2);
    x.fill();
  });
  grain(x, S, S, 14, rng);
  return c;
}

// ---------- Facades (tile = 2 bays x 2 floors = 8m x 7m, 64px/m) ----------
function facadeBrick(rng) {
  const W = 512, H = 448;
  const [c, x] = mk(W, H);
  x.fillStyle = '#a39280';
  x.fillRect(0, 0, W, H);
  const bh = 7, bw = 18;
  for (let y = 0, row = 0; y < H; y += bh, row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let xx = -bw; xx < W + bw; xx += bw) {
      const v = rng.range(-16, 16);
      x.fillStyle = `rgb(${(132 + v) | 0},${(70 + v * 0.6) | 0},${(52 + v * 0.5) | 0})`;
      x.fillRect(xx + off + 1, y + 1, bw - 2, bh - 2);
    }
  }
  blots(x, W, H, rng, 14, 'rgba(40,25,20,0.16)', 20, 70);
  for (let r = 0; r < 2; r++) {
    const fy = r * 224;
    x.fillStyle = '#c9b89e';
    x.fillRect(0, fy + 218, W, 6);
    for (let col = 0; col < 2; col++) {
      const ww = 92, wh = 118;
      const wx = col * 256 + (256 - ww) / 2;
      const wy = fy + 224 - 58 - wh;
      x.fillStyle = '#cdbca2';
      x.fillRect(wx - 10, wy - 16, ww + 20, 11);
      windowUnit(x, wx, wy, ww, wh, rng, '#efe9dc', '#cdbca2');
    }
  }
  grain(x, W, H, 14, rng);
  return c;
}

function facadeStucco(rng) {
  const W = 512, H = 448;
  const [c, x] = mk(W, H);
  x.fillStyle = '#ece6da';
  x.fillRect(0, 0, W, H);
  blots(x, W, H, rng, 18, 'rgba(120,110,95,0.1)', 20, 80);
  specks(x, W, H, rng, 3000, 180, 240, 0.08, 0.2, 2);
  for (let r = 0; r < 2; r++) {
    const fy = r * 224;
    x.fillStyle = 'rgba(0,0,0,0.12)';
    x.fillRect(0, fy + 214, W, 3);
    x.fillStyle = '#f8f4ec';
    x.fillRect(0, fy + 205, W, 9);
    for (let col = 0; col < 2; col++) {
      const ww = 84, wh = 112;
      const wx = col * 256 + (256 - ww) / 2;
      const wy = fy + 224 - 62 - wh;
      x.fillStyle = '#7d8c8f';
      x.fillRect(wx - 34, wy - 2, 26, wh + 4);
      x.fillRect(wx + ww + 8, wy - 2, 26, wh + 4);
      x.fillStyle = 'rgba(0,0,0,0.2)';
      for (let yy = wy + 4; yy < wy + wh; yy += 6) {
        x.fillRect(wx - 32, yy, 22, 1.5);
        x.fillRect(wx + ww + 10, yy, 22, 1.5);
      }
      windowUnit(x, wx, wy, ww, wh, rng, '#fbf8f2', '#d9d2c4');
      if (rng.chance(0.35)) {
        x.fillStyle = '#c9cbcc';
        x.fillRect(wx + 14, wy + wh + 14, 56, 30);
        x.fillStyle = 'rgba(0,0,0,0.3)';
        for (let k = 0; k < 6; k++) x.fillRect(wx + 18 + k * 8, wy + wh + 18, 4, 22);
      }
    }
  }
  for (let i = 0; i < 6; i++) {
    const sx = rng.range(0, W);
    const g = x.createLinearGradient(sx, 0, sx, H);
    g.addColorStop(0, 'rgba(90,80,70,0.0)');
    g.addColorStop(0.5, 'rgba(90,80,70,0.08)');
    g.addColorStop(1, 'rgba(90,80,70,0.0)');
    x.fillStyle = g;
    x.fillRect(sx, 0, rng.range(4, 12), H);
  }
  grain(x, W, H, 10, rng);
  return c;
}

function facadeOffice(rng) {
  const W = 512, H = 448;
  const [c, x] = mk(W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#9ec2d8');
  g.addColorStop(0.5, '#56809d');
  g.addColorStop(1, '#2c4a61');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 9; i++) blot(x, W, H, rng.range(0, W), rng.range(0, H), rng.range(40, 110), 'rgba(255,240,225,0.18)');
  for (let r = 0; r < 2; r++) {
    const fy = r * 224;
    for (let col = 0; col < 4; col++) {
      const px = col * 128;
      if (rng.chance(0.3)) {
        x.fillStyle = 'rgba(255,200,140,0.18)';
        x.fillRect(px, fy, 128, 170);
      }
      if (rng.chance(0.25)) {
        x.fillStyle = 'rgba(230,230,225,0.35)';
        x.fillRect(px, fy, 128, rng.range(30, 120));
      }
    }
    x.fillStyle = '#2b3640';
    x.fillRect(0, fy + 170, W, 54);
    x.fillStyle = 'rgba(255,255,255,0.07)';
    x.fillRect(0, fy + 170, W, 4);
  }
  x.fillStyle = '#c6cbd0';
  for (let col = 0; col <= 4; col++) x.fillRect(col * 128 - 3, 0, 6, H);
  for (let r = 0; r <= 2; r++) x.fillRect(0, r * 224 - 4, W, 8);
  x.fillStyle = 'rgba(0,0,0,0.25)';
  for (let col = 0; col <= 4; col++) x.fillRect(col * 128 + 3, 0, 2, H);
  grain(x, W, H, 8, rng);
  return c;
}

function facadeConcrete(rng) {
  const W = 512, H = 448;
  const [c, x] = mk(W, H);
  x.fillStyle = '#bab5ab';
  x.fillRect(0, 0, W, H);
  blots(x, W, H, rng, 18, 'rgba(70,66,60,0.14)', 20, 70);
  specks(x, W, H, rng, 2500, 140, 210, 0.08, 0.2, 2);
  for (let r = 0; r < 2; r++) {
    const fy = r * 224;
    const wy = fy + 50;
    const wh = 104;
    x.fillStyle = 'rgba(0,0,0,0.3)';
    x.fillRect(0, wy - 4, W, wh + 10);
    for (let k = 0; k < 8; k++) glass(x, k * 64 + 3, wy, 58, wh, rng, 1);
    x.fillStyle = '#d6d1c6';
    for (let k = 0; k <= 8; k++) x.fillRect(k * 64 - 3, wy, 6, wh);
    x.fillStyle = '#cbc5b9';
    x.fillRect(0, wy + wh, W, 10);
    x.fillStyle = 'rgba(0,0,0,0.18)';
    x.fillRect(0, wy + wh + 10, W, 3);
  }
  for (let i = 0; i < 10; i++) {
    const sx = rng.range(0, W);
    const g = x.createLinearGradient(sx, 0, sx, H);
    g.addColorStop(0, 'rgba(60,55,50,0.0)');
    g.addColorStop(0.6, 'rgba(60,55,50,0.12)');
    g.addColorStop(1, 'rgba(60,55,50,0.0)');
    x.fillStyle = g;
    x.fillRect(sx, rng.range(0, H * 0.5), rng.range(3, 10), H);
  }
  grain(x, W, H, 12, rng);
  return c;
}

function storefront(rng) {
  const W = 512, H = 224; // 8m x 3.5m
  const [c, x] = mk(W, H);
  x.fillStyle = '#3d3935';
  x.fillRect(0, 0, W, H);
  const top = 46;
  const panes = [[18, 236], [252, 410]];
  panes.forEach(([a, b]) => {
    const g = x.createLinearGradient(0, top, 0, H - 22);
    g.addColorStop(0, '#2a2a30');
    g.addColorStop(1, '#4a3a2c');
    x.fillStyle = g;
    x.fillRect(a, top, b - a, H - 22 - top);
    for (let s = 0; s < 3; s++) {
      const sy = top + 30 + s * 40;
      x.fillStyle = 'rgba(255,210,150,0.25)';
      x.fillRect(a + 10, sy, b - a - 20, 3);
      for (let k = a + 14; k < b - 14; k += rng.range(8, 16)) {
        x.fillStyle = `hsla(${rng.range(0, 360)},55%,55%,0.55)`;
        x.fillRect(k, sy - rng.range(8, 20), rng.range(4, 9), 20);
      }
    }
    x.fillStyle = 'rgba(255,200,130,0.12)';
    x.fillRect(a, top, b - a, H - 22 - top);
    x.fillStyle = 'rgba(200,225,240,0.22)';
    x.beginPath();
    x.moveTo(a + 20, top);
    x.lineTo(a + 80, top);
    x.lineTo(a + 30, H - 22);
    x.lineTo(a - 10, H - 22);
    x.fill();
    x.fillStyle = '#9aa0a6';
    x.fillRect(a - 4, top - 4, b - a + 8, 4);
    x.fillRect(a - 4, top, 4, H - 22 - top);
    x.fillRect(b, top, 4, H - 22 - top);
  });
  x.fillStyle = '#20262c';
  x.fillRect(426, top + 6, 70, H - 22 - top - 6);
  glass(x, 434, top + 14, 54, 90, rng, 1);
  x.fillStyle = '#9aa0a6';
  x.fillRect(426, top + 2, 70, 4);
  x.fillRect(476, top + 100, 6, 22);
  x.fillStyle = '#222';
  x.fillRect(0, H - 22, W, 22);
  x.fillStyle = '#2a2622';
  x.fillRect(0, 0, W, top - 6);
  grain(x, W, H, 10, rng);
  return c;
}

// ---------- Effects / props ----------
function leaf(rng) {
  const W = 128, H = 512;
  const [c, x] = mk(W, H);
  x.clearRect(0, 0, W, H);
  x.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const t = i / 46;
    const y = H - 10 - t * (H - 20);
    const len = (W * 0.48) * Math.sin(Math.min(1, (1 - t) * 1.2 + 0.15) * Math.PI * 0.5) * (1 - t * 0.55);
    const gc = rng.range(90, 140) | 0;
    x.strokeStyle = `rgb(${(gc * 0.45) | 0},${gc},${(gc * 0.3) | 0})`;
    x.lineWidth = rng.range(5, 8) * (1 - t * 0.5);
    x.beginPath();
    x.moveTo(W / 2, y);
    x.quadraticCurveTo(W / 2 - len * 0.6, y - 12, W / 2 - len, y - 28);
    x.stroke();
    x.beginPath();
    x.moveTo(W / 2, y);
    x.quadraticCurveTo(W / 2 + len * 0.6, y - 12, W / 2 + len, y - 28);
    x.stroke();
  }
  x.strokeStyle = '#6b6b2a';
  x.lineWidth = 6;
  x.beginPath();
  x.moveTo(W / 2, H);
  x.lineTo(W / 2, 6);
  x.stroke();
  return c;
}

function bulletHole() {
  const S = 64;
  const [c, x] = mk(S, S);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(8,8,8,1)');
  g.addColorStop(0.18, 'rgba(15,14,13,1)');
  g.addColorStop(0.3, 'rgba(45,42,38,0.85)');
  g.addColorStop(0.62, 'rgba(70,65,58,0.35)');
  g.addColorStop(1, 'rgba(70,65,58,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(20,20,20,0.6)';
  x.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
    x.beginPath();
    x.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    x.lineTo(32 + Math.cos(a) * (14 + Math.random() * 12), 32 + Math.sin(a) * (14 + Math.random() * 12));
    x.stroke();
  }
  return c;
}

function flash() {
  const S = 128;
  const [c, x] = mk(S, S);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.15, 'rgba(255,220,140,0.95)');
  g.addColorStop(0.4, 'rgba(255,140,40,0.45)');
  g.addColorStop(1, 'rgba(255,90,10,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.fillStyle = 'rgba(255,230,170,0.9)';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
    const l = 40 + Math.random() * 22;
    x.beginPath();
    x.moveTo(64 + Math.cos(a - 0.12) * 10, 64 + Math.sin(a - 0.12) * 10);
    x.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l);
    x.lineTo(64 + Math.cos(a + 0.12) * 10, 64 + Math.sin(a + 0.12) * 10);
    x.fill();
  }
  return c;
}

function dot() {
  const S = 64;
  const [c, x] = mk(S, S);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,60,50,1)');
  g.addColorStop(0.35, 'rgba(255,30,30,0.35)');
  g.addColorStop(1, 'rgba(255,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return c;
}

function glow() {
  const S = 128;
  const [c, x] = mk(S, S);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return c;
}

function ad(title, sub, bg1, bg2, fg) {
  const W = 512, H = 256;
  const [c, x] = mk(W, H);
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, bg1);
  g.addColorStop(1, bg2);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = -H; i < W; i += 36) {
    x.beginPath();
    x.moveTo(i, H);
    x.lineTo(i + H, 0);
    x.lineTo(i + H + 14, 0);
    x.lineTo(i + 14, H);
    x.fill();
  }
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '900 86px Anton, Impact, "Arial Black", sans-serif';
  x.shadowColor = 'rgba(0,0,0,0.45)';
  x.shadowOffsetY = 6;
  x.fillText(title, W / 2, H * 0.44, W - 40);
  x.shadowOffsetY = 0;
  x.font = '700 30px Rajdhani, "Arial Narrow", sans-serif';
  x.fillText(sub, W / 2, H * 0.78, W - 60);
  x.strokeStyle = 'rgba(255,255,255,0.85)';
  x.lineWidth = 10;
  x.strokeRect(5, 5, W - 10, H - 10);
  return c;
}

export function createTextures(renderer) {
  const rng = new RNG(90210);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const T = (canvas, o = {}) => {
    const t = new THREE.CanvasTexture(canvas);
    if (o.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = o.aniso ?? maxAniso;
    t.needsUpdate = true;
    return t;
  };
  return {
    asphalt: T(asphalt(rng)),
    sidewalk: T(sidewalk(rng)),
    conc: T(concrete(rng)),
    roof: T(roof(rng)),
    grass: T(grass(rng)),
    paver: T(pavers(rng)),
    metal: T(metal(rng)),
    wood: T(wood(rng)),
    brick: T(facadeBrick(rng)),
    stucco: T(facadeStucco(rng)),
    office: T(facadeOffice(rng)),
    concw: T(facadeConcrete(rng)),
    store: T(storefront(rng)),
    leaf: T(leaf(rng), { repeat: false, aniso: 2 }),
    hole: T(bulletHole(), { repeat: false, aniso: 1 }),
    flash: T(flash(), { repeat: false, aniso: 1 }),
    dot: T(dot(), { repeat: false, aniso: 1 }),
    glow: T(glow(), { repeat: false, aniso: 1 }),
    ads: [
      T(ad('TACO LOCO', 'OPEN 24/7 · EXTRA HOT', '#ff5e3a', '#ff9f1c', '#fff6d6'), { repeat: false }),
      T(ad('HYPE ENERGY', 'DRINK FAST · LIVE LOUD', '#1b1b2f', '#3a0ca3', '#39ff14'), { repeat: false }),
      T(ad('SUNSET FM 101.9', 'THE CITY NEVER SLEEPS', '#ff7eb3', '#7b2cbf', '#ffffff'), { repeat: false }),
    ],
  };
}
