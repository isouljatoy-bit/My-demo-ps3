import * as THREE from 'three';
import { RNG, TAU } from './utils.js';

export const SUN_DIR = new THREE.Vector3(-0.58, 0.4, -0.71).normalize();

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  vec4 p = projectionMatrix * viewMatrix * wp;
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uTime;
uniform float uClouds;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = max(dot(d, uSun), 0.0);
  vec3 zenith = vec3(0.08, 0.22, 0.58);
  vec3 horizon = vec3(0.86, 0.68, 0.52);
  vec3 warm = vec3(1.0, 0.52, 0.22);
  vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.5));
  float hz = 1.0 - clamp(h * 2.2, 0.0, 1.0);
  col = mix(col, warm * 1.25, pow(sd, 5.0) * 0.6 * hz);
  col += warm * pow(sd, 48.0) * 1.2;
  col += vec3(1.0, 0.75, 0.45) * pow(sd, 400.0) * 6.0;
  col += vec3(30.0, 24.0, 16.0) * smoothstep(0.99955, 0.9998, sd);
  if (h > 0.0 && uClouds > 0.5) {
    vec2 uv = d.xz / (h + 0.1) * 0.9 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(uv * 1.4);
    c = smoothstep(0.52, 0.86, c);
    vec3 lit = mix(vec3(0.95, 0.86, 0.8), vec3(1.6, 1.0, 0.62), pow(sd, 3.0));
    vec3 shade = vec3(0.55, 0.52, 0.6);
    vec3 cc = mix(shade, lit, smoothstep(0.0, 1.0, fbm(uv * 1.4 + uSun.xz * 0.15)));
    col = mix(col, cc, c * 0.8 * smoothstep(0.0, 0.12, h));
  }
  if (h < 0.0) col = mix(horizon * 0.85, vec3(0.32, 0.3, 0.3), clamp(-h * 5.0, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 }, uClouds: { value: 1 } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// Pre-filtered environment from the same sky, for car paint, glass and the weapon metal.
export function createEnvMap(renderer) {
  const scene = new THREE.Scene();
  const sky = createSky();
  sky.material.uniforms.uClouds.value = 0;
  scene.add(sky);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.18, 0.17, 0.16) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  scene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 2000);
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  return rt.texture;
}

// Distant hazy mountain ring (no fog, painted in atmospheric perspective).
export function createHills() {
  const rng = new RNG(4242);
  const seg = 160, rings = 3;
  const pos = [], col = [], idx = [];
  const heights = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU;
    const h = 40 + 70 * Math.abs(Math.sin(a * 2.0 + 0.7)) + 45 * Math.sin(a * 5.3 + 1.1) * 0.5 + rng.range(0, 30);
    heights.push(Math.max(20, h));
  }
  heights[seg] = heights[0];
  const base = new THREE.Color().setRGB(0.66, 0.55, 0.5);
  const top = new THREE.Color().setRGB(0.5, 0.46, 0.54);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let r = 0; r < rings; r++) {
      const t = r / (rings - 1);
      const rad = 980 - t * 60;
      const y = t === 0 ? -5 : heights[i] * (t === 1 ? 1 : 0.6);
      pos.push(ca * rad, y, sa * rad);
      const c = base.clone().lerp(top, t);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let r = 0; r < rings - 1; r++) {
      const a = i * rings + r, b = a + rings;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: true }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -9;
  return mesh;
}
