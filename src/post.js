import * as THREE from 'three';

// Mobile-tuned post stack: HDR scene target (optional MSAA) -> bright-pass at 1/4 res ->
// separable gaussian (1/4 and 1/8) -> composite with ACES, grade, vignette, damage FX, grain.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThr;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThr, uThr + 0.6, br);
  gl_FragColor = vec4(min(c * k, vec3(24.0)), 1.0);
}`;

const BLUR = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tB1; uniform sampler2D tB2;
uniform float uBloom; uniform float uHasBloom; uniform float uExposure; uniform float uSat;
uniform float uVignette; uniform float uDamage; uniform float uTime; uniform vec2 uRes; uniform float uScope;
uniform float uLowHealth;
varying vec2 vUv;
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
void main() {
  vec2 uv = vUv;
  vec2 dir = uv - 0.5;
  float ca = uDamage * 0.006 + uScope * 0.0015;
  vec3 col;
  col.r = texture2D(tScene, uv + dir * ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - dir * ca).b;
  if (uHasBloom > 0.5) col += (texture2D(tB1, uv).rgb * 0.55 + texture2D(tB2, uv).rgb * 0.6) * uBloom;
  col *= uExposure;
  // Warm golden-hour split tone before the curve.
  float lum0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(vec3(0.92, 0.97, 1.08), vec3(1.06, 1.0, 0.92), smoothstep(0.05, 0.6, lum0));
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float sat = uSat * (1.0 - uLowHealth * 0.6);
  col = mix(vec3(l), col, sat);
  float vig = smoothstep(1.05, 0.25, length(dir * vec2(uRes.x / uRes.y, 1.0) * 0.85));
  col *= mix(1.0, vig, uVignette);
  float edge = smoothstep(0.25, 0.85, length(dir) * 1.45);
  col = mix(col, vec3(0.55, 0.0, 0.0), edge * clamp(uDamage * 0.75 + uLowHealth * 0.35, 0.0, 0.85));
  col = toSRGB(col);
  col += (hash(uv * uRes + fract(uTime)) - 0.5) * 0.022;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  constructor(renderer) {
    this.r = renderer;
    const gl = renderer.getContext();
    this.isWebGL2 = renderer.capabilities.isWebGL2;
    const ext = renderer.extensions;
    this.halfFloat = this.isWebGL2 && (ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float'));
    this.type = this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.maxSamples = this.isWebGL2 ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0) : 0;
    this.samples = 0;
    this.bloomOn = true;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeo, null);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mBright = mk(BRIGHT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThr: { value: 1.0 } });
    this.mBlur = mk(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mComp = mk(COMPOSITE, {
      tScene: { value: null }, tB1: { value: null }, tB2: { value: null },
      uBloom: { value: 0.85 }, uHasBloom: { value: 1 }, uExposure: { value: 1.0 }, uSat: { value: 1.22 },
      uVignette: { value: 0.55 }, uDamage: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uScope: { value: 0 }, uLowHealth: { value: 0 },
    });
    this.w = 0;
    this.h = 0;
    this.rtScene = null;
  }

  makeRT(w, h, samples) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: this.type, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
      samples, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
  }

  setSize(w, h, samples, bloom) {
    samples = Math.min(samples, this.maxSamples);
    if (w === this.w && h === this.h && samples === this.samples && bloom === this.bloomOn && this.rtScene) return;
    this.w = w;
    this.h = h;
    this.samples = samples;
    this.bloomOn = bloom;
    [this.rtScene, this.rtA, this.rtB, this.rtC, this.rtD].forEach((rt) => rt && rt.dispose());
    this.rtScene = this.makeRT(w, h, samples);
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    const ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3);
    const small = (a, b) => new THREE.WebGLRenderTarget(a, b, { type: this.type, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.rtA = small(qw, qh);
    this.rtB = small(qw, qh);
    this.rtC = small(ew, eh);
    this.rtD = small(ew, eh);
    this.mComp.uniforms.uRes.value.set(w, h);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qScene, this.camera);
  }

  blur(src, tmp, w, h) {
    const u = this.mBlur.uniforms;
    u.tSrc.value = src.texture;
    u.uDir.value.set(1 / w, 0);
    this.pass(this.mBlur, tmp);
    u.tSrc.value = tmp.texture;
    u.uDir.value.set(0, 1 / h);
    this.pass(this.mBlur, src);
  }

  render(scene, cam, vmScene, vmCam, showVm, fx) {
    const r = this.r;
    r.autoClear = false;
    r.setRenderTarget(this.rtScene);
    r.clear(true, true, false);
    r.render(scene, cam);
    if (showVm) {
      r.clearDepth();
      r.render(vmScene, vmCam);
    }
    const U = this.mComp.uniforms;
    if (this.bloomOn) {
      const qw = this.rtA.width, qh = this.rtA.height;
      this.mBright.uniforms.tSrc.value = this.rtScene.texture;
      this.mBright.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this.pass(this.mBright, this.rtA);
      this.blur(this.rtA, this.rtB, qw, qh);
      this.mBright.uniforms.tSrc.value = this.rtA.texture;
      this.mBright.uniforms.uTexel.value.set(1 / qw, 1 / qh);
      const thr = this.mBright.uniforms.uThr.value;
      this.mBright.uniforms.uThr.value = 0;
      this.pass(this.mBright, this.rtC);
      this.mBright.uniforms.uThr.value = thr;
      this.blur(this.rtC, this.rtD, this.rtC.width, this.rtC.height);
      U.tB1.value = this.rtA.texture;
      U.tB2.value = this.rtC.texture;
      U.uHasBloom.value = 1;
    } else {
      U.uHasBloom.value = 0;
    }
    U.tScene.value = this.rtScene.texture;
    U.uDamage.value = fx.damage;
    U.uTime.value = fx.time;
    U.uScope.value = fx.scope;
    U.uLowHealth.value = fx.lowHealth;
    U.uExposure.value = fx.exposure;
    this.pass(this.mComp, null);
    r.autoClear = true;
  }
}
