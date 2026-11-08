/* ==========================================================================
 * Renderer + input + HUD shell (v2).
 *
 * All game rules live in logic.js; this file only:
 *   - builds three.js meshes from the state,
 *   - feeds raw input into the logic structs,
 *   - pushes the HUD model into the DOM.
 *
 * Visual pass: PCF shadows, ACES tonemapping, UnrealBloom, a sky shader,
 * muzzle flash, impact sparks, grenade arcs/blasts, tracers, weapon
 * viewmodel, screen shake and a spectator camera.
 * ========================================================================== */

import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

import {
  CONFIG,
  WEAPONS,
  createMatch,
  step,
  restart,
  hudModel,
  findPlayer,
  defaultInput,
  currentZoneRadius,
  spectate,
  switchWeapon,
  applyAimAssist,
  findAimTarget,
  findBulletTarget,
} from './logic.js';

/* ------------------------------------------------------------------ setup */

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const LOW_END = (navigator.hardwareConcurrency || 4) <= 2;
if (LOW_END) renderer.setPixelRatio(1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb8cc);
scene.fog = new THREE.Fog(0xa9c8da, 90, 240);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 340);
const menuCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 500);

/* ------------------------------------------------------------------- sky */

const skyUniforms = {
  top: { value: new THREE.Color(0x1d5c96) },
  mid: { value: new THREE.Color(0x7fb5d8) },
  bottom: { value: new THREE.Color(0xe6d3ad) },
  sunDir: { value: new THREE.Vector3(60, 90, 40).normalize() },
};

{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        uniform vec3 sunDir; varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = h < 0.5 ? mix(bottom, mid, h * 2.0)
                             : mix(mid, top, (h - 0.5) * 2.0);
          float sun = pow(max(dot(vDir, sunDir), 0.0), 260.0);
          float halo = pow(max(dot(vDir, sunDir), 0.0), 12.0) * 0.28;
          col += vec3(1.0, 0.92, 0.74) * (sun * 2.2 + halo);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  scene.add(sky);
}

/* ----------------------------------------------------------------- lights */

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x46543a, 0.95);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff0d0, 2.6);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW_END ? 1024 : 2048, LOW_END ? 1024 : 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 300;
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110;
sun.shadow.camera.bottom = -110;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// Warm rim from the opposite side so silhouettes read against the sky.
const rim = new THREE.DirectionalLight(0x6fa8ff, 0.55);
rim.position.set(-70, 40, -60);
scene.add(rim);

/* ------------------------------------------------------------------ audio */

/**
 * Procedural sound engine.
 *
 * No audio files ship with the build (nothing to download them from), so every
 * sound is synthesised: filtered noise bursts for gunfire, a swept sine for
 * explosions, short clicks for the HUD. A tiny stereo panner per shot keeps
 * left/right information, which is most of what makes a shooter feel alive.
 */
const AUDIO = {
  ctx: null,
  master: null,
  noiseBuffer: null,
  muted: false,
  ready: false,
};

function initAudio() {
  if (AUDIO.ready) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  try {
    AUDIO.ctx = new Ctx();
  } catch {
    return;
  }

  const comp = AUDIO.ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 22;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.22;

  AUDIO.master = AUDIO.ctx.createGain();
  AUDIO.master.gain.value = 0.55;

  AUDIO.master.connect(comp);
  comp.connect(AUDIO.ctx.destination);

  // Two seconds of white noise, reused by every gunshot.
  const len = Math.floor(AUDIO.ctx.sampleRate * 2);
  const buffer = AUDIO.ctx.createBuffer(1, len, AUDIO.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x3fffffff) - 1;
  }
  AUDIO.noiseBuffer = buffer;
  AUDIO.ready = true;
}

function audioNode(pan = 0) {
  if (!AUDIO.ready) initAudio();
  if (!AUDIO.ready || AUDIO.muted) return null;
  if (AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume().catch(() => {});

  const gain = AUDIO.ctx.createGain();
  const panner = AUDIO.ctx.createStereoPanner?.();
  if (panner) {
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner);
    panner.connect(AUDIO.master);
  } else {
    gain.connect(AUDIO.master);
  }
  return { gain, ctx: AUDIO.ctx };
}

/** Stereo position of a world point relative to the camera. */
function panFor(x, z) {
  const dx = x - camera.position.x;
  const dz = z - camera.position.z;
  const len = Math.hypot(dx, dz) || 1;
  // Camera right vector on the ground plane.
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return ((dx / len) * rx + (dz / len) * rz) * 0.85;
}

/** Distance attenuation, 1 close by, 0 far away. */
function gainFor(x, z, falloff = 55) {
  const d = Math.hypot(x - camera.position.x, z - camera.position.z);
  return Math.max(0, 1 - d / falloff);
}

function noiseBurst({ duration, filter, freqStart, freqEnd, q = 1, gain = 1, pan = 0, type = 'lowpass' }) {
  const node = audioNode(pan);
  if (!node) return;
  const { ctx } = node;
  const now = ctx.currentTime;

  const src = ctx.createBufferSource();
  src.buffer = AUDIO.noiseBuffer;
  src.loop = true;

  const biquad = ctx.createBiquadFilter();
  biquad.type = type;
  biquad.Q.value = q;
  biquad.frequency.setValueAtTime(freqStart, now);
  biquad.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(gain, now + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0008, now + duration);

  src.connect(biquad);
  biquad.connect(env);
  env.connect(node.gain);

  src.start(now);
  src.stop(now + duration + 0.02);
  if (filter) filter(biquad, now);
}

function tone({ freq, to, duration, type = 'sine', gain = 0.4, pan = 0, delay = 0 }) {
  const node = audioNode(pan);
  if (!node) return;
  const { ctx } = node;
  const now = ctx.currentTime + delay;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), now + duration);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(gain, now + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0006, now + duration);

  osc.connect(env);
  env.connect(node.gain);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

const SFX = {
  shot(weaponId, pan, vol) {
    if (vol <= 0.02) return;
    if (weaponId === 'shotgun') {
      noiseBurst({ duration: 0.34, freqStart: 2600, freqEnd: 180, q: 0.7, gain: 0.95 * vol, pan });
      tone({ freq: 150, to: 48, duration: 0.26, type: 'sawtooth', gain: 0.3 * vol, pan });
    } else if (weaponId === 'smg') {
      noiseBurst({ duration: 0.1, freqStart: 3600, freqEnd: 700, q: 1.1, gain: 0.6 * vol, pan });
    } else {
      noiseBurst({ duration: 0.16, freqStart: 3000, freqEnd: 420, q: 0.9, gain: 0.8 * vol, pan });
      tone({ freq: 210, to: 70, duration: 0.12, type: 'square', gain: 0.16 * vol, pan });
    }
  },
  distantShot(pan, vol) {
    if (vol <= 0.02) return;
    noiseBurst({ duration: 0.3, freqStart: 900, freqEnd: 140, q: 0.6, gain: 0.5 * vol, pan, type: 'lowpass' });
  },
  hit(headshot) {
    tone({ freq: headshot ? 1500 : 1050, to: headshot ? 2100 : 1250, duration: 0.09, type: 'triangle', gain: 0.3 });
    if (headshot) tone({ freq: 2400, to: 3000, duration: 0.07, type: 'sine', gain: 0.2, delay: 0.03 });
  },
  hurt() {
    noiseBurst({ duration: 0.22, freqStart: 700, freqEnd: 120, q: 0.8, gain: 0.5, type: 'lowpass' });
    tone({ freq: 120, to: 62, duration: 0.2, type: 'sine', gain: 0.28 });
  },
  reload() {
    for (const [d, f] of [[0, 420], [0.09, 300], [0.2, 520]]) {
      tone({ freq: f, to: f * 0.7, duration: 0.05, type: 'square', gain: 0.1, delay: d });
    }
  },
  explode(x, z) {
    const vol = Math.max(0.15, gainFor(x, z, 90));
    const pan = panFor(x, z);
    noiseBurst({ duration: 0.9, freqStart: 1800, freqEnd: 55, q: 0.6, gain: vol, pan });
    tone({ freq: 96, to: 28, duration: 0.75, type: 'sine', gain: 0.5 * vol, pan });
  },
  pickup() {
    tone({ freq: 660, to: 990, duration: 0.11, type: 'triangle', gain: 0.22 });
    tone({ freq: 990, to: 1320, duration: 0.1, type: 'sine', gain: 0.16, delay: 0.07 });
  },
  weaponSwitch() {
    tone({ freq: 320, to: 480, duration: 0.07, type: 'square', gain: 0.12 });
  },
  death() {
    tone({ freq: 320, to: 60, duration: 0.9, type: 'sawtooth', gain: 0.3 });
    noiseBurst({ duration: 0.7, freqStart: 600, freqEnd: 60, q: 0.5, gain: 0.35, type: 'lowpass' });
  },
  zoneWarn() {
    tone({ freq: 880, to: 880, duration: 0.12, type: 'square', gain: 0.14 });
    tone({ freq: 660, to: 660, duration: 0.12, type: 'square', gain: 0.14, delay: 0.16 });
  },
};

/* -------------------------------------------------------------- textures */

/**
 * Procedural texture atlas built at boot.
 *
 * The project ships no binary art (the sandbox cannot download any), so the
 * "assets" are painted into canvases here: grass with clumps and dry patches,
 * weathered concrete, painted metal, sandbags and a wall with boarded windows.
 * They cost a few milliseconds and give the world the surface detail that flat
 * vertex colours cannot.
 */
const TEX = {};

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx, size };
}

function toTexture(canvas, repeat = 1, { srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy?.() ?? 4);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Deterministic noise so the world looks the same every run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(ctx, size, rng, count, colors, minR, maxR, alpha = 0.5) {
  for (let i = 0; i < count; i++) {
    const c = colors[(rng() * colors.length) | 0];
    ctx.fillStyle = c;
    ctx.globalAlpha = alpha * (0.35 + rng() * 0.65);
    const r = minR + rng() * (maxR - minR);
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, r, r * (0.6 + rng() * 0.8), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintGrass() {
  const { canvas, ctx, size } = makeCanvas(512);
  const rng = mulberry32(1337);

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#4a6338');
  grad.addColorStop(0.5, '#40592f');
  grad.addColorStop(1, '#37502a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  speckle(ctx, size, rng, 900, ['#57913c', '#2f4a24', '#648c3e', '#3d5b2c'], 2, 9, 0.45);
  speckle(ctx, size, rng, 500, ['#7a8f3f', '#8e7a3a', '#6d6a30'], 1.5, 6, 0.28);

  // Blade strokes give the grass a directional grain.
  for (let i = 0; i < 2600; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const h = 3 + rng() * 9;
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(104,150,64,0.34)' : 'rgba(46,68,32,0.34)';
    ctx.lineWidth = 0.7 + rng() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 4, y - h);
    ctx.stroke();
  }

  // Worn dirt patches where the fights happen.
  for (let i = 0; i < 16; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 18 + rng() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(92,74,44,0.5)');
    g.addColorStop(1, 'rgba(92,74,44,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function paintConcrete() {
  const { canvas, ctx, size } = makeCanvas(512);
  const rng = mulberry32(90210);

  ctx.fillStyle = '#8b8474';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, rng, 1400, ['#9b9482', '#7a7364', '#a69e8b'], 1.5, 10, 0.35);

  // Panel seams: a building reads as concrete, not a solid block.
  ctx.strokeStyle = 'rgba(58,54,46,0.55)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const p = (size / 4) * i;
    ctx.beginPath();
    ctx.moveTo(p, 0); ctx.lineTo(p, size);
    ctx.moveTo(0, p); ctx.lineTo(size, p);
    ctx.stroke();
  }

  // Grime creeping up from the bottom edge.
  const grime = ctx.createLinearGradient(0, size, 0, size * 0.45);
  grime.addColorStop(0, 'rgba(40,38,30,0.55)');
  grime.addColorStop(1, 'rgba(40,38,30,0)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, size, size);

  // Cracks.
  ctx.strokeStyle = 'rgba(48,44,38,0.45)';
  for (let i = 0; i < 14; i++) {
    ctx.lineWidth = 0.8 + rng() * 1.4;
    let x = rng() * size;
    let y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let seg = 0; seg < 6; seg++) {
      x += (rng() - 0.5) * 40;
      y += (rng() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return canvas;
}

function paintMetalPainted(color, rust = true) {
  const { canvas, ctx, size } = makeCanvas(256);
  const rng = mulberry32(color);

  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, size, size);

  speckle(ctx, size, rng, 500, ['#000000', '#ffffff'], 1, 5, 0.06);

  // Horizontal panel ribs.
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 2;
  for (let y = size / 8; y < size; y += size / 8) {
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(size, y);
    ctx.stroke();
  }

  if (rust) {
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(${120 + rng() * 40},${60 + rng() * 30},${28 + rng() * 20},${0.15 + rng() * 0.3})`;
      const x = rng() * size;
      const y = rng() * size;
      const r = 3 + rng() * 16;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

function paintSandbag() {
  const { canvas, ctx, size } = makeCanvas(256);
  const rng = mulberry32(4242);

  ctx.fillStyle = '#7d7350';
  ctx.fillRect(0, 0, size, size);

  // Staggered courses of bags.
  const rows = 6;
  const cols = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const w = size / cols;
      const h = size / rows;
      const x = c * w + (r % 2 ? w * 0.5 : 0);
      const y = r * h;

      ctx.fillStyle = `hsl(${46 + rng() * 12}, ${24 + rng() * 14}%, ${34 + rng() * 16}%)`;
      ctx.beginPath();
      ctx.roundRect?.(x + 1.5, y + 1.5, w - 3, h - 3, h * 0.42);
      if (!ctx.roundRect) ctx.rect(x + 1.5, y + 1.5, w - 3, h - 3);
      ctx.fill();

      ctx.strokeStyle = 'rgba(38,34,22,0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Stitching.
      ctx.strokeStyle = 'rgba(180,168,130,0.4)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y + h * 0.5);
      ctx.lineTo(x + w * 0.8, y + h * 0.5);
      ctx.stroke();
    }
  }
  return canvas;
}

function paintCrate() {
  const { canvas, ctx, size } = makeCanvas(256);
  const rng = mulberry32(777);

  ctx.fillStyle = '#6f5334';
  ctx.fillRect(0, 0, size, size);

  // Planks.
  const planks = 5;
  for (let i = 0; i < planks; i++) {
    const h = size / planks;
    ctx.fillStyle = `hsl(${26 + rng() * 8}, ${34 + rng() * 12}%, ${26 + rng() * 14}%)`;
    ctx.fillRect(0, i * h + 1, size, h - 2);
    ctx.strokeStyle = 'rgba(30,20,10,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, i * h, size, h);

    // Grain.
    for (let g = 0; g < 26; g++) {
      ctx.strokeStyle = `rgba(40,26,14,${0.08 + rng() * 0.16})`;
      ctx.lineWidth = 0.7;
      const y = i * h + rng() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + (rng() - 0.5) * 4, size * 0.7, y + (rng() - 0.5) * 4, size, y);
      ctx.stroke();
    }
  }

  // Steel banding around the crate.
  ctx.fillStyle = 'rgba(52,54,58,0.85)';
  ctx.fillRect(0, size * 0.14, size, 7);
  ctx.fillRect(0, size * 0.79, size, 7);
  return canvas;
}

function buildTextures() {
  TEX.grass = toTexture(paintGrass(), 34);
  TEX.concrete = toTexture(paintConcrete(), 1);
  TEX.metalBlue = toTexture(paintMetalPainted(0x3f5568), 1);
  TEX.metalRust = toTexture(paintMetalPainted(0x6b4a33), 1);
  TEX.sandbag = toTexture(paintSandbag(), 1);
  TEX.crate = toTexture(paintCrate(), 1);

  // Normal-ish roughness breakup; a cheap way to kill the plastic look.
  TEX.rough = toTexture(paintConcrete(), 1, { srgb: false });
}

/* ------------------------------------------------------------------ mats */

// Paint the textures before anything references them.
buildTextures();

const MAT = {
  ground: new THREE.MeshStandardMaterial({ map: TEX.grass, color: 0x9fb389, roughness: 0.98, metalness: 0.0 }),
  wall: new THREE.MeshStandardMaterial({ map: TEX.concrete, color: 0xc4bda9, roughness: 0.92 }),
  roof: new THREE.MeshStandardMaterial({ map: TEX.metalRust, color: 0x8f9aa3, roughness: 0.72, metalness: 0.2 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b222a, roughness: 0.45, metalness: 0.55 }),
  sandbag: new THREE.MeshStandardMaterial({ map: TEX.sandbag, color: 0xbfb48c, roughness: 0.97 }),
  crate: new THREE.MeshStandardMaterial({ map: TEX.crate, color: 0xc9ab80, roughness: 0.86 }),
  crateMetal: new THREE.MeshStandardMaterial({ map: TEX.metalBlue, color: 0xa8b8c6, roughness: 0.5, metalness: 0.55 }),
  player: new THREE.MeshStandardMaterial({ color: 0x1e9ef2, roughness: 0.42, metalness: 0.2 }),
  bot: new THREE.MeshStandardMaterial({ color: 0xe0512e, roughness: 0.55, metalness: 0.1 }),
  ammo: new THREE.MeshStandardMaterial({ color: 0xffbf1f, emissive: 0x8a5c00, emissiveIntensity: 1.4, roughness: 0.3 }),
  medical: new THREE.MeshStandardMaterial({ color: 0x26f073, emissive: 0x0a7a33, emissiveIntensity: 1.4, roughness: 0.3 }),
  armor: new THREE.MeshStandardMaterial({ color: 0x59b6ff, emissive: 0x123f66, emissiveIntensity: 1.5, roughness: 0.25, metalness: 0.6 }),
  grenade: new THREE.MeshStandardMaterial({ color: 0xb8ff4a, emissive: 0x3d6b00, emissiveIntensity: 1.2, roughness: 0.4 }),
  zone: new THREE.MeshBasicMaterial({ color: 0x38d0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  tracer: new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
  tracerBot: new THREE.MeshBasicMaterial({ color: 0xff9a5c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
};

/* ------------------------------------------------------------ world build */

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const actorViews = new Map();
const lootViews = new Map();
const grenadeViews = new Map();
let zoneRing = null;
let zoneWall = null;
let zonePulse = 0;

const tracers = [];
const impacts = [];
const explosions = [];

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const SPH = new THREE.SphereGeometry(1, 12, 10);

function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse?.((o) => {
      if (!o.geometry) return;
      if (o.geometry === BOX || o.geometry === CYL || o.geometry === SPH) return;
      o.geometry.dispose();
    });
  }
}

function buildWorld(state) {
  disposeGroup(worldGroup);
  actorViews.clear();
  lootViews.clear();
  grenadeViews.clear();

  const ground = new THREE.Mesh(BOX, MAT.ground);
  ground.scale.set(state.cfg.mapSize, 1, state.cfg.mapSize);
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  worldGroup.add(ground);

  const grid = new THREE.GridHelper(state.cfg.mapSize, 40, 0x2b3d28, 0x2b3d28);
  grid.position.y = 0.012;
  grid.material.opacity = 0.28;
  grid.material.transparent = true;
  worldGroup.add(grid);

  for (const o of state.world.obstacles) {
    const isBuilding = o.kind === 'building';
    worldGroup.add(buildObstacle(o, isBuilding));
  }

  // Props break up the boxy silhouette: barrels, crates and rocks scattered
  // deterministically so a spot looks the same on every run.
  buildProps(state);

  for (const w of state.world.windows) {
    const panel = new THREE.Mesh(BOX, MAT.dark);
    panel.scale.set(w.w, w.h, 0.06);
    panel.position.set(w.x, w.y, w.z);
    worldGroup.add(panel);
  }

  for (const item of state.loot) {
    const mesh = buildLoot(item);
    mesh.position.set(item.x, item.y, item.z);
    worldGroup.add(mesh);
    lootViews.set(item.id, mesh);
  }

  for (const actor of state.actors) {
    const view = buildActor(actor);
    worldGroup.add(view.root);
    actorViews.set(actor.id, view);
  }

  buildZone(state);
  buildViewmodel();
}

/**
 * One cover object, dressed up instead of being a bare cube.
 *
 *  - building  : concrete shell, boarded windows on all four faces, roof slab,
 *                corner pilasters, a skirting band and a doorway
 *  - sandbag   : stacked bag courses with a slight batter
 *  - crate     : wooden box with steel banding and a lid
 *  - rock      : faceted low-poly boulder
 */
function buildObstacle(o, isBuilding) {
  const group = new THREE.Group();
  group.position.set(o.x, 0, o.z);

  if (isBuilding) {
    const wallMat = MAT.wall;
    const body = new THREE.Mesh(BOX, wallMat);
    body.scale.set(o.hx * 2, o.height, o.hz * 2);
    body.position.y = o.height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Skirting: a darker concrete band stops the walls floating visually.
    const skirt = new THREE.Mesh(BOX, MAT.dark);
    skirt.scale.set(o.hx * 2 + 0.16, 0.55, o.hz * 2 + 0.16);
    skirt.position.y = 0.28;
    skirt.castShadow = true;
    group.add(skirt);

    const roof = new THREE.Mesh(BOX, MAT.roof);
    roof.scale.set(o.hx * 2 + 0.9, 0.4, o.hz * 2 + 0.9);
    roof.position.y = o.height + 0.2;
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);

    // Parapet so the roofline is not a single flat slab.
    for (const [sx, sz, px, pz] of [
      [o.hx * 2 + 0.9, 0.28, 0, o.hz + 0.45],
      [o.hx * 2 + 0.9, 0.28, 0, -(o.hz + 0.45)],
      [0.28, o.hz * 2 + 0.9, o.hx + 0.45, 0],
      [0.28, o.hz * 2 + 0.9, -(o.hx + 0.45), 0],
    ]) {
      const rail = new THREE.Mesh(BOX, MAT.wall);
      rail.scale.set(sx, 0.5, sz);
      rail.position.set(px, o.height + 0.65, pz);
      rail.castShadow = true;
      group.add(rail);
    }

    // Corner pilasters.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pilaster = new THREE.Mesh(BOX, MAT.wall);
        pilaster.scale.set(0.5, o.height, 0.5);
        pilaster.position.set(sx * (o.hx - 0.15), o.height / 2, sz * (o.hz - 0.15));
        pilaster.castShadow = true;
        group.add(pilaster);
      }
    }

    // Boarded windows on the two long faces.
    const windowMat = MAT.dark;
    const boardMat = MAT.crate;
    const rows = o.height > 5 ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const wy = o.height * (rows === 1 ? 0.55 : 0.35 + r * 0.4);
      const count = Math.max(1, Math.floor(o.hx / 2.2));
      for (let i = 0; i < count; i++) {
        const wx = -o.hx + ((i + 0.5) * (o.hx * 2)) / count;

        for (const side of [-1, 1]) {
          const win = new THREE.Mesh(BOX, windowMat);
          win.scale.set(1.5, 1.1, 0.12);
          win.position.set(wx, wy, side * (o.hz + 0.01));
          group.add(win);

          // Two boards nailed across, at odd angles.
          for (const tilt of [-0.22, 0.18]) {
            const board = new THREE.Mesh(BOX, boardMat);
            board.scale.set(1.65, 0.22, 0.09);
            board.position.set(wx, wy + tilt * 1.6, side * (o.hz + 0.09));
            board.rotation.z = tilt;
            board.castShadow = true;
            group.add(board);
          }
        }
      }
    }

    // A doorway on one short face.
    const door = new THREE.Mesh(BOX, MAT.dark);
    door.scale.set(1.3, 2.3, 0.12);
    door.position.set(0, 1.15, -(o.hz + 0.02));
    group.add(door);

    return group;
  }

  if (o.kind === 'sandbag') {
    // Three battered courses of bags, each course slightly smaller.
    const courses = Math.max(2, Math.round(o.height / 0.34));
    for (let c = 0; c < courses; c++) {
      const shrink = 1 - c * 0.028;
      const course = new THREE.Mesh(BOX, MAT.sandbag);
      course.scale.set(o.hx * 2 * shrink, 0.33, o.hz * 2 * shrink);
      course.position.y = 0.17 + c * 0.33;
      course.castShadow = true;
      course.receiveShadow = true;
      group.add(course);
    }
    return group;
  }

  if (o.kind === 'rock') {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const rock = new THREE.Mesh(geo, MAT.crateMetal);
    rock.scale.set(o.hx * 1.15, o.height * 0.75, o.hz * 1.15);
    rock.position.y = o.height * 0.45;
    rock.rotation.set(0.3, o.x * 0.7, 0.15);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
    return group;
  }

  // Default: a wooden crate with banding.
  const crate = new THREE.Mesh(BOX, MAT.crate);
  crate.scale.set(o.hx * 2, o.height, o.hz * 2);
  crate.position.y = o.height / 2;
  crate.castShadow = true;
  crate.receiveShadow = true;
  group.add(crate);

  const lid = new THREE.Mesh(BOX, MAT.crateMetal);
  lid.scale.set(o.hx * 2 + 0.08, 0.1, o.hz * 2 + 0.08);
  lid.position.y = o.height + 0.02;
  group.add(lid);

  return group;
}

/**
 * Scatter barrels, rocks, stumps and debris. Purely cosmetic, so it never
 * touches collision — but it is what makes the map stop looking like a
 * physics test scene.
 */
function buildProps(state) {
  const rng = mulberry32(20240607);
  const half = state.cfg.mapSize / 2 - 6;
  const free = (x, z) => {
    for (const o of state.world.obstacles) {
      if (Math.abs(x - o.x) < o.hx + 2.4 && Math.abs(z - o.z) < o.hz + 2.4) return false;
    }
    return true;
  };

  const barrelMat = MAT.crateMetal;
  const woodMat = MAT.crate;
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1, 7);

  let placed = 0;
  for (let attempt = 0; attempt < 900 && placed < 150; attempt++) {
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    if (!free(x, z)) continue;

    const kind = rng();
    const yaw = rng() * Math.PI * 2;

    if (kind < 0.3) {
      // Oil barrel.
      const barrel = new THREE.Mesh(CYL, barrelMat);
      barrel.scale.set(0.42, 0.95, 0.42);
      barrel.position.set(x, 0.475, z);
      barrel.rotation.y = yaw;
      barrel.castShadow = true;
      barrel.receiveShadow = true;
      worldGroup.add(barrel);
      placed++;
    } else if (kind < 0.55) {
      // Small crate stack.
      const count = rng() > 0.5 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const crate = new THREE.Mesh(BOX, woodMat);
        const s = 0.55 + rng() * 0.35;
        crate.scale.setScalar(s);
        crate.position.set(x + (i ? s * 0.6 : 0), s / 2 + (i ? s * 0.55 : 0), z);
        crate.rotation.y = yaw + i * 0.4;
        crate.castShadow = true;
        crate.receiveShadow = true;
        worldGroup.add(crate);
      }
      placed++;
    } else if (kind < 0.78) {
      // Boulder cluster.
      for (let i = 0; i < 2 + ((rng() * 3) | 0); i++) {
        const rock = new THREE.Mesh(rockGeo, barrelMat);
        const s = 0.3 + rng() * 0.55;
        rock.scale.set(s, s * 0.72, s * 0.9);
        rock.position.set(x + (rng() - 0.5) * 2.2, s * 0.5, z + (rng() - 0.5) * 2.2);
        rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        rock.castShadow = true;
        rock.receiveShadow = true;
        worldGroup.add(rock);
      }
      placed++;
    } else if (kind < 0.94) {
      // Tree stump / dead trunk.
      const stump = new THREE.Mesh(trunkGeo, woodMat);
      const h = 0.6 + rng() * 1.6;
      stump.scale.set(1, h, 1);
      stump.position.set(x, h / 2, z);
      stump.rotation.z = (rng() - 0.5) * 0.16;
      stump.castShadow = true;
      worldGroup.add(stump);
      placed++;
    } else {
      // Scattered debris planks.
      for (let i = 0; i < 3; i++) {
        const plank = new THREE.Mesh(BOX, woodMat);
        plank.scale.set(1.4 + rng(), 0.09, 0.24);
        plank.position.set(x + (rng() - 0.5) * 2, 0.05, z + (rng() - 0.5) * 2);
        plank.rotation.y = rng() * Math.PI;
        plank.castShadow = true;
        worldGroup.add(plank);
      }
      placed++;
    }
  }
}

/**
 * A fighter, not a capsule.
 *
 * Layered gear reads far better at range: helmet with a brim, ballistic vest
 * with pouches, shoulder pads, a backpack, a belt, knee pads and two-segment
 * limbs so the walk cycle actually bends. Everything is primitives, so it costs
 * almost nothing, but the silhouette stops looking like a stack of cylinders.
 */
/**
 * Pickups with a readable silhouette, plus a slowly rotating halo so they are
 * findable from 40 m away without a marker cluttering the screen.
 */
function buildLoot(item) {
  const group = new THREE.Group();
  const mat = item.kind === 'medical' ? MAT.medical
    : item.kind === 'armor' ? MAT.armor
    : item.kind === 'grenade' ? MAT.grenade
    : MAT.ammo;

  if (item.kind === 'medical') {
    // Medkit: pale box with a red cross on the lid.
    const box = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.6 }));
    box.scale.set(0.5, 0.3, 0.36);
    box.castShadow = true;
    group.add(box);

    const crossMat = new THREE.MeshStandardMaterial({ color: 0xd8202a, emissive: 0x5c0a0e, emissiveIntensity: 1.2, roughness: 0.5 });
    for (const [sx, sz] of [[0.26, 0.07], [0.07, 0.26]]) {
      const bar = new THREE.Mesh(BOX, crossMat);
      bar.scale.set(sx, 0.03, sz);
      bar.position.y = 0.16;
      group.add(bar);
    }
  } else if (item.kind === 'armor') {
    // Armour plate: a curved ceramic slab on a stand.
    const plate = new THREE.Mesh(BOX, MAT.armor);
    plate.scale.set(0.42, 0.5, 0.13);
    plate.rotation.x = -0.2;
    plate.position.y = 0.26;
    plate.castShadow = true;
    group.add(plate);

    const rim = new THREE.Mesh(BOX, MAT.dark);
    rim.scale.set(0.47, 0.09, 0.16);
    rim.position.y = 0.03;
    group.add(rim);
  } else if (item.kind === 'grenade') {
    // Frag grenade: body, top cap, lever.
    const body = new THREE.Mesh(SPH, MAT.grenade);
    body.scale.set(0.17, 0.2, 0.17);
    body.position.y = 0.2;
    body.castShadow = true;
    group.add(body);

    const cap = new THREE.Mesh(CYL, MAT.dark);
    cap.scale.set(0.07, 0.07, 0.07);
    cap.position.y = 0.4;
    group.add(cap);

    const lever = new THREE.Mesh(BOX, MAT.dark);
    lever.scale.set(0.03, 0.18, 0.05);
    lever.position.set(0.08, 0.3, 0);
    group.add(lever);
  } else {
    // Ammo: open crate with visible rounds.
    const crate = new THREE.Mesh(BOX, MAT.crate);
    crate.scale.set(0.44, 0.24, 0.3);
    crate.position.y = 0.12;
    crate.castShadow = true;
    group.add(crate);

    for (let i = 0; i < 5; i++) {
      const round = new THREE.Mesh(CYL, MAT.ammo);
      round.scale.set(0.035, 0.16, 0.035);
      round.rotation.z = Math.PI / 2;
      round.position.set(-0.14 + i * 0.07, 0.28, 0);
      group.add(round);
    }
  }

  // Halo: a ring on the ground plus a soft dome of light.
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.72, 20),
    new THREE.MeshBasicMaterial({
      color: mat.color, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.46;
  group.add(halo);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 10, 8),
    new THREE.MeshBasicMaterial({
      color: mat.color, transparent: true, opacity: 0.1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  glow.position.y = 0.24;
  group.add(glow);

  group.userData.halo = halo;
  group.userData.glow = glow;
  return group;
}

function buildActor(actor) {
  const root = new THREE.Group();

  const bodyMat = (actor.isPlayer ? MAT.player : MAT.bot).clone();
  const baseEmissive = bodyMat.emissive.getHex();
  const gearMat = new THREE.MeshStandardMaterial({
    color: actor.isPlayer ? 0x1a2733 : 0x2c1d18,
    roughness: 0.82,
    metalness: 0.12,
  });
  const padMat = new THREE.MeshStandardMaterial({
    color: actor.isPlayer ? 0x2e4a60 : 0x4a2c22,
    roughness: 0.7,
    metalness: 0.18,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x8d6a4f, roughness: 0.8 });
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x0a1218,
    roughness: 0.12,
    metalness: 0.85,
    emissive: actor.isPlayer ? 0x1d8fd6 : 0xd6401d,
    emissiveIntensity: 1.6,
  });

  const add = (mesh, parent = root) => {
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // --- torso: chest + abdomen, slightly tapered -------------------------
  const chest = add(new THREE.Mesh(CYL, bodyMat));
  chest.scale.set(0.37, 0.34, 0.30);
  chest.position.y = 1.24;

  const abdomen = add(new THREE.Mesh(CYL, gearMat));
  abdomen.scale.set(0.31, 0.16, 0.26);
  abdomen.position.y = 0.98;

  // Ballistic vest slab over the chest, with two pouches.
  const vest = add(new THREE.Mesh(BOX, gearMat));
  vest.scale.set(0.56, 0.42, 0.32);
  vest.position.y = 1.2;

  for (const px of [-0.14, 0.14]) {
    const pouch = add(new THREE.Mesh(BOX, padMat));
    pouch.scale.set(0.17, 0.15, 0.09);
    pouch.position.set(px, 1.06, -0.19);
  }

  // Shoulder pads.
  for (const sx of [-1, 1]) {
    const pad = add(new THREE.Mesh(SPH, padMat));
    pad.scale.set(0.14, 0.11, 0.14);
    pad.position.set(sx * 0.32, 1.4, 0);
  }

  // Backpack.
  const pack = add(new THREE.Mesh(BOX, gearMat));
  pack.scale.set(0.38, 0.44, 0.2);
  pack.position.set(0, 1.2, 0.21);

  // Belt.
  const belt = add(new THREE.Mesh(CYL, MAT.dark));
  belt.scale.set(0.33, 0.06, 0.29);
  belt.position.y = 0.9;

  // --- hips and legs, two segments each so knees bend --------------------
  const hips = add(new THREE.Mesh(CYL, bodyMat));
  hips.scale.set(0.32, 0.16, 0.26);
  hips.position.y = 0.83;

  const makeLeg = (side) => {
    const thighPivot = new THREE.Group();
    thighPivot.position.set(side * 0.14, 0.8, 0);
    root.add(thighPivot);

    const thigh = add(new THREE.Mesh(BOX, bodyMat), thighPivot);
    thigh.scale.set(0.17, 0.42, 0.19);
    thigh.position.y = -0.21;

    const kneePivot = new THREE.Group();
    kneePivot.position.y = -0.42;
    thighPivot.add(kneePivot);

    const shin = add(new THREE.Mesh(BOX, gearMat), kneePivot);
    shin.scale.set(0.15, 0.36, 0.17);
    shin.position.y = -0.18;

    // Knee pad.
    const knee = add(new THREE.Mesh(SPH, padMat), kneePivot);
    knee.scale.set(0.1, 0.09, 0.1);
    knee.position.set(0, 0.01, -0.06);

    // Boot.
    const boot = add(new THREE.Mesh(BOX, MAT.dark), kneePivot);
    boot.scale.set(0.18, 0.12, 0.28);
    boot.position.set(0, -0.36, -0.04);

    return { thighPivot, kneePivot };
  };

  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // --- arms ------------------------------------------------------------
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.34, 1.36, 0);
    root.add(shoulder);

    const upper = add(new THREE.Mesh(BOX, bodyMat), shoulder);
    upper.scale.set(0.13, 0.3, 0.14);
    upper.position.y = -0.15;

    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);

    const fore = add(new THREE.Mesh(BOX, gearMat), elbow);
    fore.scale.set(0.12, 0.26, 0.13);
    fore.position.y = -0.13;

    const glove = add(new THREE.Mesh(SPH, MAT.dark), elbow);
    glove.scale.setScalar(0.085);
    glove.position.y = -0.27;

    return { shoulder, elbow };
  };

  const armL = makeArm(-1);
  const armR = makeArm(1);

  // --- head: neck, skull, helmet, visor, headset ------------------------
  const neck = add(new THREE.Mesh(CYL, skinMat));
  neck.scale.set(0.09, 0.08, 0.09);
  neck.position.y = 1.5;

  const head = add(new THREE.Mesh(SPH, skinMat));
  head.scale.setScalar(0.21);
  head.position.y = 1.63;

  const helmet = add(new THREE.Mesh(SPH, padMat));
  helmet.scale.set(0.235, 0.2, 0.235);
  helmet.position.y = 1.69;

  const brim = add(new THREE.Mesh(CYL, padMat));
  brim.scale.set(0.25, 0.03, 0.25);
  brim.position.y = 1.66;

  const visor = add(new THREE.Mesh(BOX, lensMat));
  visor.scale.set(0.32, 0.09, 0.05);
  visor.position.set(0, 1.63, -0.19);

  // Headset cup on one side.
  const cup = add(new THREE.Mesh(CYL, MAT.dark));
  cup.scale.set(0.07, 0.05, 0.07);
  cup.rotation.z = Math.PI / 2;
  cup.position.set(-0.2, 1.64, 0);

  // --- weapon in the right hand, muzzle parented to it ------------------
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0.28, 1.16, -0.1);
  root.add(gunPivot);

  const gun = add(new THREE.Mesh(BOX, MAT.dark), gunPivot);
  gun.scale.set(0.09, 0.12, 0.62);
  gun.position.z = -0.3;

  const stock = add(new THREE.Mesh(BOX, gearMat), gunPivot);
  stock.scale.set(0.08, 0.1, 0.2);
  stock.position.z = 0.02;

  const magazine = add(new THREE.Mesh(BOX, gearMat), gunPivot);
  magazine.scale.set(0.06, 0.16, 0.1);
  magazine.position.set(0, -0.13, -0.24);

  const sight = add(new THREE.Mesh(BOX, MAT.dark), gunPivot);
  sight.scale.set(0.05, 0.05, 0.12);
  sight.position.set(0, 0.09, -0.3);

  const muzzle = add(new THREE.Mesh(SPH, MAT.flash), gunPivot);
  muzzle.scale.setScalar(0.15);
  muzzle.position.z = -0.64;
  muzzle.visible = false;

  return {
    root, torso: chest, head, gun, muzzle,
    dead: false, hitMaterial: bodyMat, baseEmissive,
    legL: legL.thighPivot, legR: legR.thighPivot,
    kneeL: legL.kneePivot, kneeR: legR.kneePivot,
    armL: armL.shoulder, armR: armR.shoulder,
    gunPivot,
  };
}

function buildZone(state) {
  if (zoneRing) {
    scene.remove(zoneRing);
    zoneRing.geometry.dispose();
  }
  if (zoneWall) {
    scene.remove(zoneWall);
    zoneWall.geometry.dispose();
  }

  const segments = 140;
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 3), 3));
  zoneRing = new THREE.LineLoop(ringGeo, new THREE.LineBasicMaterial({ color: 0x5ce4ff }));
  zoneRing.position.y = 0.22;
  scene.add(zoneRing);

  zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 30, segments, 1, true), MAT.zone);
  zoneWall.position.y = 15;
  scene.add(zoneWall);

  updateZoneMesh(state);
}

function updateZoneMesh(state) {
  const radius = currentZoneRadius(state);
  const pos = zoneRing.geometry.attributes.position;
  const n = pos.count;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos.setXYZ(i, Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  pos.needsUpdate = true;
  zoneRing.geometry.computeBoundingSphere();
  zoneWall.scale.set(radius, 1, radius);
}

/* ------------------------------------------------------------- viewmodel */

let viewmodel = null;

/**
 * First-person weapon. Each gun gets its own silhouette so swapping weapons is
 * visible without reading the HUD, and gloved hands hold the thing so it does
 * not float in space.
 */
function buildViewmodel() {
  if (viewmodel) {
    camera.remove(viewmodel.root);
  }

  const root = new THREE.Group();
  const gunRoot = new THREE.Group();
  root.add(gunRoot);

  const metal = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.46, metalness: 0.72 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.86, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x3a4550, roughness: 0.55, metalness: 0.45 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1e2429, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x8d6a4f, roughness: 0.82 });

  const part = (geo, mat, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    gunRoot.add(m);
    return m;
  };

  // ---- receiver / body -------------------------------------------------
  const body = part(BOX, metal, 0.075, 0.085, 0.46, 0, 0, -0.16);

  // Upper rail with teeth.
  const rail = part(BOX, accent, 0.05, 0.022, 0.36, 0, 0.052, -0.2);
  for (let i = 0; i < 7; i++) {
    part(BOX, accent, 0.056, 0.014, 0.014, 0, 0.066, -0.36 + i * 0.048);
  }

  // ---- stock, grip, trigger guard -------------------------------------
  part(BOX, polymer, 0.055, 0.075, 0.2, 0, -0.012, 0.1);          // stock
  part(BOX, polymer, 0.05, 0.12, 0.07, 0, -0.09, 0.045);          // grip
  part(BOX, polymer, 0.03, 0.05, 0.09, 0, -0.055, -0.1);          // trigger guard

  // ---- magazine --------------------------------------------------------
  const magazine = part(BOX, accent, 0.048, 0.16, 0.075, 0, -0.115, -0.2);
  magazine.rotation.x = -0.12;

  // ---- barrel + muzzle device -----------------------------------------
  const barrel = part(CYL, metal, 0.02, 0.28, 0.02, 0, 0.012, -0.52);
  barrel.rotation.x = Math.PI / 2;

  const brake = part(CYL, accent, 0.032, 0.07, 0.032, 0, 0.012, -0.66);
  brake.rotation.x = Math.PI / 2;

  // ---- optic -----------------------------------------------------------
  const sightBase = part(BOX, metal, 0.036, 0.03, 0.1, 0, 0.078, -0.16);
  const sight = part(BOX, accent, 0.042, 0.05, 0.055, 0, 0.104, -0.16);
  // Glowing dot in the optic — reads instantly in the dark.
  const dot = part(SPH, new THREE.MeshBasicMaterial({ color: 0xff3b3b }), 0.008, 0.008, 0.008, 0, 0.104, -0.19);

  // ---- hands -----------------------------------------------------------
  const rightGlove = part(SPH, gloveMat, 0.055, 0.05, 0.065, 0.02, -0.1, 0.04);
  const rightArm = part(CYL, skinMat, 0.032, 0.22, 0.032, 0.05, -0.16, 0.16);
  rightArm.rotation.set(1.25, 0, 0.35);

  const leftGlove = part(SPH, gloveMat, 0.055, 0.05, 0.065, -0.02, -0.035, -0.4);
  const leftArm = part(CYL, skinMat, 0.032, 0.3, 0.032, -0.09, -0.13, -0.22);
  leftArm.rotation.set(1.35, 0, -0.5);

  // ---- muzzle flash ----------------------------------------------------
  const muzzle = new THREE.Mesh(SPH, MAT.flash);
  muzzle.scale.setScalar(0.1);
  muzzle.position.set(0, 0.012, -0.72);
  muzzle.visible = false;
  gunRoot.add(muzzle);

  // A second, wider card behind the flash sells the bloom.
  const flashCard = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  flashCard.position.set(0, 0.012, -0.7);
  flashCard.visible = false;
  gunRoot.add(flashCard);

  root.position.set(0.26, -0.24, -0.52);
  root.rotation.set(0, 0.04, 0);
  root.visible = false;
  camera.add(root);

  viewmodel = {
    root, gunRoot, body, barrel, magazine, muzzle, flashCard, dot,
    recoil: 0, kick: 0, muzzleTime: 0,
  };
  if (!scene.children.includes(camera)) scene.add(camera);
}

/* ------------------------------------------------------------------ tracer */

function spawnTracer(from, to, fromBot, weaponId) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.02) return;

  const thin = weaponId === 'shotgun' ? 0.018 : weaponId === 'smg' ? 0.022 : 0.03;
  const mesh = new THREE.Mesh(BOX, (fromBot ? MAT.tracerBot : MAT.tracer).clone());
  mesh.scale.set(thin, thin, length);
  mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  mesh.lookAt(to.x, to.y, to.z);
  scene.add(mesh);
  tracers.push({ mesh, life: fromBot ? 0.06 : 0.05, max: fromBot ? 0.06 : 0.05 });
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.mesh.material.opacity = Math.max(0, t.life / t.max);
    if (t.life <= 0) {
      scene.remove(t.mesh);
      t.mesh.material.dispose();
      tracers.splice(i, 1);
    }
  }
}

/* --------------------------------------------------------------- particles */

function spawnImpact(point, kind) {
  const count = kind === 'actor' ? 7 : 5;
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({
      color: kind === 'actor' ? 0xff4d4d : 0xffe0a0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    mesh.scale.setScalar(0.05 + Math.random() * 0.05);
    mesh.position.set(point.x, point.y, point.z);

    impacts.push({
      mesh,
      vx: (Math.random() - 0.5) * 5.5,
      vy: Math.random() * 4.5 + 0.8,
      vz: (Math.random() - 0.5) * 5.5,
      life: 0.42,
      max: 0.42,
    });
    scene.add(mesh);
  }
}

function updateImpacts(dt) {
  for (let i = impacts.length - 1; i >= 0; i--) {
    const p = impacts[i];
    p.life -= dt;
    p.vy -= 16 * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    if (p.mesh.position.y < 0.03) {
      p.mesh.position.y = 0.03;
      p.vy *= -0.34;
      p.vx *= 0.7;
      p.vz *= 0.7;
    }
    p.mesh.material.opacity = Math.max(0, p.life / p.max);
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      impacts.splice(i, 1);
    }
  }
}

function spawnExplosion(x, y, z, radius) {
  const core = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({
    color: 0xffc857, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  core.position.set(x, y, z);
  core.scale.setScalar(0.6);
  scene.add(core);

  const shell = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({
    color: 0xff7a2f, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
  }));
  shell.position.set(x, y, z);
  shell.scale.setScalar(0.8);
  scene.add(shell);

  explosions.push({ core, shell, life: 0.55, max: 0.55, radius });
  spawnImpact({ x, y, z }, 'cover');
  spawnImpact({ x, y, z }, 'cover');

  // Screen shake, scaled by how close the blast was to the player.
  const player = findPlayer(state);
  if (player) {
    const distance = Math.hypot(player.x - x, player.z - z);
    if (distance < radius * 3) {
      shake = Math.max(shake, 0.9 * (1 - distance / (radius * 3)));
    }
  }
}

function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.life -= dt;
    const k = 1 - e.life / e.max;
    e.core.scale.setScalar(0.6 + k * e.radius * 1.15);
    e.core.material.opacity = Math.max(0, 1 - k * 1.5);
    e.shell.scale.setScalar(0.8 + k * e.radius);
    e.shell.material.opacity = Math.max(0, 0.45 * (1 - k));

    if (e.life <= 0) {
      scene.remove(e.core); scene.remove(e.shell);
      e.core.material.dispose(); e.shell.material.dispose();
      explosions.splice(i, 1);
    }
  }
}

/* --------------------------------------------------------------- grenades */

function syncGrenades(state, dt) {
  for (const g of state.grenades) {
    let mesh = grenadeViews.get(g.id);
    if (!mesh) {
      mesh = new THREE.Mesh(SPH, MAT.grenade);
      mesh.scale.setScalar(0.14);
      mesh.castShadow = true;
      scene.add(mesh);
      grenadeViews.set(g.id, mesh);
    }
    mesh.position.set(g.x, g.y, g.z);
    mesh.rotation.x += dt * 9;
    mesh.rotation.z += dt * 7;
    // Blink faster as the fuse runs out.
    const blink = g.fuse < 1 ? (Math.sin(g.fuse * 42) > 0 ? 2.4 : 0.4) : 1.2;
    mesh.material.emissiveIntensity = blink;
  }

  for (const [id, mesh] of grenadeViews) {
    if (state.grenades.some((g) => g.id === id)) continue;
    scene.remove(mesh);
    grenadeViews.delete(id);
  }
}

/* ------------------------------------------------------------------ state */

let state = null;
let running = false;
let yaw = 0;
let pitch = 0;
let pitchKick = 0;
let assistTarget = null;   // { actorId, weight, head } while a lock is live
let assistFlash = 0;       // 0..1, pulses when the lock snaps on
let shake = 0;
let lastFrame = performance.now();
let menuAngle = 0;
const input = defaultInput();

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

/* -------------------------------------------------------------------- HUD */

const el = {
  alive: document.getElementById('alive'),
  kills: document.getElementById('kills'),
  lockRing: document.getElementById('lockRing'),
  lockLabel: document.getElementById('lockLabel'),
  hpFill: document.getElementById('hpFill'),
  hpText: document.getElementById('hpText'),
  armorFill: document.getElementById('armorFill'),
  armorWrap: document.getElementById('armorWrap'),
  zoneLabel: document.getElementById('zoneLabel'),
  timerFill: document.getElementById('timerFill'),
  ammoText: document.getElementById('ammoText'),
  reserveText: document.getElementById('reserveText'),
  weaponName: document.getElementById('weaponName'),
  grenadeCount: document.getElementById('grenadeCount'),
  toast: document.getElementById('toast'),
  zoneWarning: document.getElementById('zoneWarning'),
  damage: document.getElementById('damage'),
  hitmark: document.getElementById('hitmark'),
  killFeed: document.getElementById('killFeed'),
  damageRing: document.getElementById('damageRing'),
  overlay: document.getElementById('overlay'),
  startCard: document.getElementById('startCard'),
  endCard: document.getElementById('endCard'),
  resultTitle: document.getElementById('resultTitle'),
  resultSub: document.getElementById('resultSub'),
  resultKind: document.getElementById('resultKind'),
  endKills: document.getElementById('endKills'),
  endTime: document.getElementById('endTime'),
  endAlive: document.getElementById('endAlive'),
  endAcc: document.getElementById('endAcc'),
  endHs: document.getElementById('endHs'),
  endDmg: document.getElementById('endDmg'),
  hint: document.getElementById('hint'),
  touch: document.getElementById('touch'),
  spectate: document.getElementById('spectate'),
};

let toastTimer = 0;

function showToast(text, seconds = 1.2, cls = '') {
  el.toast.textContent = text;
  el.toast.className = 'show ' + cls;
  toastTimer = seconds;
}

function flashHit(headshot) {
  el.hitmark.classList.remove('show', 'head');
  void el.hitmark.offsetWidth;
  el.hitmark.classList.add('show');
  if (headshot) el.hitmark.classList.add('head');
}

let lastFeedHash = '';

const lockVec = new THREE.Vector3();

/**
 * Draws the lock-on ring over the enemy the default aim has grabbed. It moves
 * with the target, shrinks as the lock tightens and flashes white on a snap,
 * which is exactly the readability a mobile shooter needs.
 */
function updateLockRing(hud) {
  if (!el.lockRing) return;

  const on = assistTarget && running && hud.playerAlive && !hud.finished;
  if (!on) {
    el.lockRing.classList.remove('on');
    if (el.lockLabel) el.lockLabel.classList.remove('on');
    return;
  }

  const actor = state.actors.find((a) => a.id === assistTarget.actorId && a.alive);
  if (!actor) {
    el.lockRing.classList.remove('on');
    if (el.lockLabel) el.lockLabel.classList.remove('on');
    return;
  }

  lockVec.set(actor.x, (Number.isFinite(actor.y) ? actor.y : 0) + 1.05, actor.z);
  lockVec.project(camera);

  // Behind the camera or off-screen: hide rather than draw a mirrored ring.
  if (lockVec.z > 1 || Math.abs(lockVec.x) > 1.15 || Math.abs(lockVec.y) > 1.15) {
    el.lockRing.classList.remove('on');
    if (el.lockLabel) el.lockLabel.classList.remove('on');
    return;
  }

  const x = (lockVec.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-lockVec.y * 0.5 + 0.5) * window.innerHeight;

  // Tight lock -> small, bright ring. Loose lock -> wide, dim ring.
  const weight = Math.max(0, Math.min(1, assistTarget.weight / 0.6));
  const size = 96 - weight * 34;
  const flash = assistFlash;

  el.lockRing.style.transform =
    `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${(size / 64).toFixed(3)})`;
  el.lockRing.style.opacity = (0.5 + weight * 0.5).toFixed(2);
  el.lockRing.style.borderColor = flash > 0.35 ? '#ffffff' : '#ff4d5e';
  el.lockRing.style.boxShadow =
    `0 0 ${(10 + weight * 22 + flash * 26).toFixed(0)}px rgba(255,60,80,${(0.35 + weight * 0.5).toFixed(2)})`;
  el.lockRing.classList.add('on');

  if (el.lockLabel) {
    el.lockLabel.textContent = assistTarget.head ? 'HEAD' : 'LOCK';
    el.lockLabel.style.transform = `translate(${x.toFixed(1)}px, ${(y - size * 0.62).toFixed(1)}px) translate(-50%, -50%)`;
    el.lockLabel.style.opacity = (0.45 + weight * 0.55).toFixed(2);
    el.lockLabel.classList.add('on');
  }
}

function updateHud() {
  if (!state) return;
  const hud = hudModel(state);

  el.alive.textContent = hud.alive;
  el.kills.textContent = hud.kills;

  const hp = Math.max(0, Math.round(hud.health));
  el.hpFill.style.width = `${Math.max(0, Math.min(100, hud.health))}%`;
  el.hpFill.style.background = hud.health < 30 ? '#ff4d4d' : hud.health < 60 ? '#ffc34d' : '#4dff87';
  el.hpText.textContent = `HP ${hp}`;

  el.armorFill.style.width = `${Math.max(0, Math.min(100, (hud.armor / CONFIG.armorMax) * 100))}%`;
  el.armorWrap.style.opacity = hud.armor > 0 ? '1' : '0.25';

  el.zoneLabel.textContent = `SAFE ZONE ${Math.ceil(hud.zoneRadius)}m`;
  el.timerFill.style.width = `${(hud.progress * 100).toFixed(1)}%`;

  if (hud.reloading) {
    el.ammoText.textContent = 'RELOAD';
    el.ammoText.classList.add('small');
  } else {
    el.ammoText.textContent = `${hud.ammo}`;
    el.ammoText.classList.remove('small');
  }
  el.reserveText.textContent = `/ ${hud.reserve}  ·  MED ${hud.medkits}`;
  el.weaponName.textContent = hud.weaponName;
  el.grenadeCount.textContent = `${hud.grenades}`;

  updateLockRing(hud);

  el.zoneWarning.classList.toggle('on', hud.outsideZone && !hud.finished && hud.playerAlive);
  el.damage.style.opacity = (hud.damageFlash > 0 ? hud.damageFlash * 2.4 : 0).toFixed(2);

  // Directional damage indicators.
  const ring = el.damageRing;
  if (hud.damageIndicators.length) {
    ring.innerHTML = hud.damageIndicators.map((d) => {
      const deg = (d.angle * 180) / Math.PI;
      return `<i style="transform:rotate(${deg}deg) translateY(-118px);opacity:${Math.max(0, d.health).toFixed(2)}"></i>`;
    }).join('');
  } else if (ring.innerHTML) {
    ring.innerHTML = '';
  }

  // Kill feed: rebuild only when it actually changes.
  const hash = hud.killFeed.map((k) => `${k.t}|${k.victim}|${k.weapon}`).join(',');
  if (hash !== lastFeedHash) {
    lastFeedHash = hash;
    el.killFeed.innerHTML = hud.killFeed.map((k) => {
      const w = WEAPONS[k.weapon] ? WEAPONS[k.weapon].name : 'BLAST';
      return `<div class="feedRow"><b>YOU</b><span>${w}</span><i>${k.headshot ? 'HS' : ''}</i><em>BOT ${k.victim.replace('BOT ', '')}</em></div>`;
    }).join('');
  }

  // Spectator banner.
  if (hud.spectating != null) {
    el.spectate.classList.add('on');
    const target = state.actors.find((a) => a.id === hud.spectating);
    el.spectate.textContent = target
      ? `SPECTATING BOT ${target.id} · ${target.tier ? target.tier.name : ''}  [Q / E]`
      : 'SPECTATING';
  } else {
    el.spectate.classList.remove('on');
  }

  if (hud.finished) showEnd(hud);
}

function showEnd(hud) {
  if (!running) return;
  running = false;
  el.overlay.classList.remove('hidden');
  el.startCard.style.display = 'none';
  el.endCard.style.display = '';

  const win = hud.result && hud.result.title.startsWith('VICTORY');
  const r = hud.result || {};
  el.resultTitle.textContent = r.title || 'MATCH OVER';
  el.resultTitle.className = win ? 'win' : 'lose';
  el.resultSub.textContent = r.subtitle || '';
  el.resultKind.textContent = win ? 'MATCH WON' : 'MATCH OVER';
  el.endKills.textContent = r.kills ?? 0;
  el.endTime.textContent = `${r.survived ?? 0}s`;
  el.endAlive.textContent = hud.alive;
  el.endAcc.textContent = `${Math.round((r.accuracy ?? 0) * 100)}%`;
  el.endHs.textContent = r.headshots ?? 0;
  el.endDmg.textContent = r.damageDealt ?? 0;

  document.exitPointerLock?.();
}

/* ------------------------------------------------------------------ input */

const keys = new Set();
let mouseLook = false;
let touchLook = null;
let touchLookLast = null;
let stickTouchId = null;
let stickOrigin = { x: 0, y: 0 };
let stickValue = { x: 0, y: 0 };

const stickBase = document.getElementById('stickBase');
const stickKnob = document.getElementById('stickKnob');
const stickZone = document.getElementById('stickZone');
const lookZone = document.getElementById('lookZone');

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyR') input.reload = true;
  if (e.code === 'KeyH') input.heal = true;
  if (e.code === 'KeyG') input.grenade = true;
  if (e.code === 'KeyQ') { input.switchWeapon = -1; }
  if (e.code === 'Digit1') { playerWeapon('rifle'); }
  if (e.code === 'Digit2') { playerWeapon('smg'); }
  if (e.code === 'Digit3') { playerWeapon('shotgun'); }
  if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
  if (e.code === 'Escape') document.exitPointerLock?.();
  if (!running) return;
  if (e.code === 'KeyE' || e.code === 'Tab') {
    if (state && state.player.spectating != null) {
      e.preventDefault();
      spectate(state, 1);
    }
  }
});

function playerWeapon(id) {
  if (!state || !running) return;
  const player = findPlayer(state);
  const index = ['rifle', 'smg', 'shotgun'].indexOf(id) + 1;
  const delta = index - (['rifle', 'smg', 'shotgun'].indexOf(player.weapon) + 1);
  if (delta !== 0) switchWeapon(state, delta);
}

addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

canvas.addEventListener('mousedown', (e) => {
  if (!running) return;
  if (e.button === 2) {
    mouseLook = true;
    canvas.requestPointerLock?.();
  }
  if (e.button === 0) input.firing = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) {
    mouseLook = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
  }
  if (e.button === 0) input.firing = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());

const LOOK_SPEED = 0.0022;

addEventListener('mousemove', (e) => {
  if (!running) return;
  const locked = document.pointerLockElement === canvas;
  if (!locked && !mouseLook) return;
  yaw -= e.movementX * LOOK_SPEED * 1.6;
  pitch -= e.movementY * LOOK_SPEED * 1.6;
  pitch = Math.max(-1.15, Math.min(1.05, pitch));
});

/* --- touch --- */

stickZone.addEventListener('touchstart', (e) => {
  if (!running || stickTouchId !== null) return;
  const t = e.changedTouches[0];
  stickTouchId = t.identifier;
  stickOrigin = { x: t.clientX, y: t.clientY };
  stickBase.style.left = `${t.clientX}px`;
  stickBase.style.top = `${t.clientY}px`;
  stickBase.classList.add('on');
  stickKnob.style.left = `${t.clientX}px`;
  stickKnob.style.top = `${t.clientY}px`;
  e.preventDefault();
}, { passive: false });

stickZone.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier !== stickTouchId) continue;
    let dx = t.clientX - stickOrigin.x;
    let dy = t.clientY - stickOrigin.y;
    const len = Math.hypot(dx, dy);
    const max = 65;
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
    stickValue = { x: dx / max, y: dy / max };
    stickKnob.style.left = `${stickOrigin.x + dx}px`;
    stickKnob.style.top = `${stickOrigin.y + dy}px`;
    e.preventDefault();
  }
}, { passive: false });

function endStick(e) {
  for (const t of e.changedTouches) {
    if (t.identifier !== stickTouchId) continue;
    stickTouchId = null;
    stickValue = { x: 0, y: 0 };
    stickBase.classList.remove('on');
  }
}
stickZone.addEventListener('touchend', endStick);
stickZone.addEventListener('touchcancel', endStick);

lookZone.addEventListener('touchstart', (e) => {
  if (!running || touchLook !== null) return;
  touchLook = e.changedTouches[0].identifier;
  touchLookLast = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  e.preventDefault();
}, { passive: false });

lookZone.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier !== touchLook) continue;
    const dx = t.clientX - touchLookLast.x;
    const dy = t.clientY - touchLookLast.y;
    touchLookLast = { x: t.clientX, y: t.clientY };
    yaw -= dx * 0.0052;
    pitch -= dy * 0.0052;
    pitch = Math.max(-1.15, Math.min(1.05, pitch));
    e.preventDefault();
  }
}, { passive: false });

function endLook(e) {
  for (const t of e.changedTouches) {
    if (t.identifier !== touchLook) continue;
    touchLook = null;
  }
}
lookZone.addEventListener('touchend', endLook);
lookZone.addEventListener('touchcancel', endLook);

function bindHoldButton(id, on, off) {
  const node = document.getElementById(id);
  const start = (e) => { e.preventDefault(); node.classList.add('down'); on(); };
  const end = (e) => { e.preventDefault(); node.classList.remove('down'); off?.(); };
  node.addEventListener('touchstart', start, { passive: false });
  node.addEventListener('touchend', end, { passive: false });
  node.addEventListener('touchcancel', end, { passive: false });
  node.addEventListener('mousedown', start);
  node.addEventListener('mouseup', end);
}

bindHoldButton('btnFire', () => { input.firing = true; }, () => { input.firing = false; });

// Browsers only allow audio after a gesture, so unlock on the first click/key.
const unlockAudio = () => {
  initAudio();
  if (AUDIO.ctx?.state === 'suspended') AUDIO.ctx.resume().catch(() => {});
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio, { once: false });
window.addEventListener('keydown', unlockAudio, { once: false });
bindHoldButton('btnReload', () => { input.reload = true; });
bindHoldButton('btnHeal', () => { input.heal = true; });
bindHoldButton('btnJump', () => { input.jump = true; });
bindHoldButton('btnGrenade', () => { input.grenade = true; });
bindHoldButton('btnSwap', () => { input.switchWeapon = 1; });

function readMove() {
  if (stickTouchId !== null) {
    return { x: stickValue.x, z: -stickValue.y, magnitude: Math.hypot(stickValue.x, stickValue.y) };
  }
  let x = 0;
  let z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (x === 0 && z === 0) return { x: 0, z: 0, magnitude: 0 };
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len, magnitude: 1 };
}

/* ----------------------------------------------------------------- camera */

const camPivot = new THREE.Vector3();
const camOffset = new THREE.Vector3(0.6, 0.34, 4.4);
const camDesired = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

function updateCamera(dt, instant) {
  const player = findPlayer(state);
  const spectateId = state.player.spectating;
  const target = spectateId != null ? state.actors.find((a) => a.id === spectateId) : player;
  if (!target) return;

  const eye = (target.crouching ? 1.0 : CONFIG.playerEyeHeight) + 0.26;
  camPivot.set(target.x, target.y + eye, target.z);

  const shakeX = shake > 0 ? (Math.random() - 0.5) * shake * 0.16 : 0;
  const shakeY = shake > 0 ? (Math.random() - 0.5) * shake * 0.16 : 0;

  const viewPitch = spectateId != null ? pitch * 0.6 : pitch + pitchKick;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(viewPitch, yaw, 0, 'YXZ'));
  tmpDir.copy(camOffset).applyQuaternion(q);

  camDesired.copy(camPivot).add(tmpDir);

  raycaster.set(camPivot, tmpDir.clone().normalize());
  raycaster.far = tmpDir.length();
  const hits = raycaster.intersectObjects(worldGroup.children, false);
  let distance = tmpDir.length();
  for (const hit of hits) {
    if (hit.distance < distance) distance = Math.max(0.45, hit.distance - 0.22);
    break;
  }
  camDesired.copy(camPivot).add(tmpDir.normalize().multiplyScalar(distance));

  if (instant) {
    camera.position.copy(camDesired);
  } else {
    const k = 1 - Math.pow(0.0001, dt);
    camera.position.lerp(camDesired, Math.min(1, k * 1.15));
  }

  camera.position.x += shakeX;
  camera.position.y += shakeY;
  camera.rotation.set(viewPitch, yaw, shake * 0.03 * (Math.random() - 0.5), 'YXZ');

  sun.target.position.set(target.x, 0, target.z);
  sun.position.set(target.x + 55, 85, target.z + 45);

  // Viewmodel follows the camera, hides while dead or spectating.
  if (viewmodel) {
    viewmodel.root.visible = running && target.isPlayer && target.alive;
    const weapon = WEAPONS[target.weapon] || WEAPONS.rifle;

    // Silhouette per weapon: the shotgun is stubby and thick, the SMG compact
    // with a long magazine, the rifle long. Swapping is instantly readable.
    const shape = weapon.id === 'shotgun'
      ? { bodyZ: 0.4, barrelZ: 0.22, magY: -0.09, magZ: -0.16, scale: 1.08 }
      : weapon.id === 'smg'
        ? { bodyZ: 0.34, barrelZ: 0.24, magY: -0.14, magZ: -0.14, scale: 0.94 }
        : { bodyZ: 0.46, barrelZ: 0.28, magY: -0.115, magZ: -0.2, scale: 1 };
    viewmodel.body.scale.z = shape.bodyZ;
    viewmodel.barrel.scale.y = shape.barrelZ;
    viewmodel.magazine.position.y = shape.magY;
    viewmodel.magazine.position.z = shape.magZ;
    viewmodel.gunRoot.scale.setScalar(shape.scale);

    // Sprint / walk bob plus a touch of sway when idle.
    const bobY = target.sprinting ? Math.sin(state.time * 16) * 0.018 : Math.sin(state.time * 7) * 0.005;
    const bobX = target.sprinting ? Math.cos(state.time * 8) * 0.012 : Math.sin(state.time * 3.5) * 0.003;

    viewmodel.root.position.set(0.26 + bobX, -0.24 + bobY, -0.52 + viewmodel.kick);
    viewmodel.root.rotation.x = viewmodel.recoil * 0.7;
    viewmodel.root.rotation.z = bobX * 0.6 + viewmodel.recoil * 0.12;

    viewmodel.recoil *= Math.pow(0.02, dt);
    viewmodel.kick *= Math.pow(0.0008, dt);

    const flashOn = viewmodel.muzzleTime > 0;
    viewmodel.muzzle.visible = flashOn;
    if (viewmodel.flashCard) {
      viewmodel.flashCard.visible = flashOn;
      if (flashOn) {
        const f = 0.7 + Math.random() * 0.6;
        viewmodel.flashCard.scale.setScalar(f);
        viewmodel.flashCard.rotation.z += 0.7;
        viewmodel.flashCard.material.opacity = 0.6 + Math.random() * 0.35;
      }
    }
    viewmodel.muzzleTime = Math.max(0, (viewmodel.muzzleTime || 0) - dt);
  }
}

/* ------------------------------------------------------------------ loop */

function syncViews(dt) {
  for (const actor of state.actors) {
    const view = actorViews.get(actor.id);
    if (!view) continue;

    view.root.position.set(actor.x, actor.y, actor.z);
    view.root.rotation.y = actor.yaw;

    // Walk cycle: hips swing, knees bend on the back stroke, arms counter-swing.
    // Speed scales with sprinting / crouching so the feet do not skate.
    const speed = actor.sprinting ? 14 : actor.crouching ? 6.5 : 9.5;
    const amp = actor.sprinting ? 0.62 : actor.crouching ? 0.22 : 0.38;
    const phase = state.time * speed + actor.id;

    if (actor.alive) {
      const swing = Math.sin(phase) * amp;
      view.legL.rotation.x = swing;
      view.legR.rotation.x = -swing;

      // Knees only bend in one direction.
      view.kneeL.rotation.x = Math.max(0, -swing) * 1.35;
      view.kneeR.rotation.x = Math.max(0, swing) * 1.35;

      // Opposite arms swing back as the legs come forward.
      view.armL.rotation.x = -swing * 0.75;
      view.armR.rotation.x = swing * 0.35 - 0.42;   // right arm holds the gun up

      // A little vertical bob and torso counter-rotation sell the weight.
      view.root.position.y += Math.abs(Math.sin(phase)) * (actor.sprinting ? 0.05 : 0.022);
      view.torso.rotation.z = Math.sin(phase) * 0.035;
    }

    // Gun points where the actor looks; the head follows the pitch a little.
    if (actor.alive) {
      const aiming = state.time - actor.lastDamageAt < 1.2 || actor.shotTimer > 0;
      view.gunPivot.rotation.x = aiming ? (actor.pitch || 0) * 0.8 - 0.05 : -0.18;
      view.head.rotation.x = Math.max(-0.5, Math.min(0.4, (actor.pitch || 0) * 0.5));
    }

    if (!actor.alive && !view.dead) {
      view.dead = true;
      view.root.rotation.z = Math.PI / 2;
      view.root.position.y = 0.24;
      view.hitMaterial.color.setHex(0x2a323a);
      view.hitMaterial.emissiveIntensity = 1;
      view.head.material = view.hitMaterial;
      view.muzzle.visible = false;
    }

    const lit = actor.alive && state.time - actor.lastDamageAt < 0.12;
    view.hitMaterial.emissive.setHex(lit ? 0xffffff : view.baseEmissive);
    view.hitMaterial.emissiveIntensity = lit ? 1.6 : 1;
  }

  for (const item of state.loot) {
    const mesh = lootViews.get(item.id);
    if (!mesh) continue;
    if (item.taken) {
      mesh.visible = false;
      continue;
    }
    // Bob, spin, and pulse the halo so pickups read at range.
    mesh.rotation.y += dt * 1.1;
    mesh.position.y = item.y + Math.sin(state.time * 2.2 + item.id) * 0.08;

    const halo = mesh.userData?.halo;
    if (halo) {
      halo.rotation.z -= dt * 0.8;
      halo.material.opacity = 0.3 + Math.sin(state.time * 3 + item.id) * 0.14;
    }
    const glow = mesh.userData?.glow;
    if (glow) glow.material.opacity = 0.07 + Math.sin(state.time * 2.4 + item.id) * 0.04;
  }

  syncGrenades(state, dt);

  zonePulse += dt;
  MAT.zone.opacity = 0.16 + Math.sin(zonePulse * 2.4) * 0.05;
  updateZoneMesh(state);
}

function muzzleFlashFor(actorId) {
  const view = actorViews.get(actorId);
  if (!view) return;
  view.muzzle.visible = true;
  view.muzzle.scale.setScalar(0.2 + Math.random() * 0.12);
  setTimeout(() => { if (view.muzzle) view.muzzle.visible = false; }, 45);
}

function handleEvents(events) {
  const player = findPlayer(state);

  for (const ev of events) {
    if (ev.type === 'shot') {
      const fromBot = ev.fromBot != null;
      const shooterId = fromBot ? ev.fromBot : player.id;

      for (const shot of ev.shots) {
        spawnTracer(shot.from, shot.to, fromBot, shot.weapon);
        if (shot.kind !== 'miss') spawnImpact(shot.to, shot.kind);
      }

      muzzleFlashFor(shooterId);
      if (viewmodel) viewmodel.muzzleTime = 0.045;

      // Gunfire, panned and attenuated per shooter.
      if (fromBot) {
        const shooter = state.actors.find((a) => a.id === ev.fromBot);
        if (shooter) {
          const vol = gainFor(shooter.x, shooter.z);
          const pan = panFor(shooter.x, shooter.z);
          if (vol > 0.35) SFX.shot(ev.weapon, pan, vol);
          else SFX.distantShot(pan, vol * 2);
        }
      } else {
        SFX.shot(ev.weapon, 0, 1);
      }

      if (!fromBot) {
        const weapon = WEAPONS[ev.weapon] || WEAPONS.rifle;
        pitchKick = Math.min(0.14, pitchKick + (ev.recoil || 0.01) * 1.9);
        shake = Math.min(1.2, shake + (weapon.id === 'shotgun' ? 0.34 : 0.09));
        if (viewmodel) {
          viewmodel.recoil += weapon.id === 'shotgun' ? 0.5 : 0.16;
          viewmodel.kick += weapon.id === 'shotgun' ? 0.075 : 0.028;
        }

        const hit = ev.shots.find((s) => s.victimId != null);
        if (hit) {
          flashHit(hit.headshot);
          SFX.hit(hit.headshot);
          showToast(hit.headshot ? 'HEADSHOT' : 'HIT', 0.4, hit.headshot ? 'crit' : '');
        }
      }
    } else if (ev.type === 'loot') {
      SFX.pickup();
      showToast(ev.text, 0.9, 'loot');
    } else if (ev.type === 'reload') {
      SFX.reload();
      showToast('RELOADING', 0.8);
    } else if (ev.type === 'heal') {
      SFX.pickup();
      showToast('+50 HEALTH', 0.9, 'heal');
    } else if (ev.type === 'weapon') {
      SFX.weaponSwitch();
      showToast(ev.name, 0.7, 'weapon');
    } else if (ev.type === 'explosion') {
      spawnExplosion(ev.x, ev.y, ev.z, ev.radius);
      SFX.explode(ev.x, ev.z);
    } else if (ev.type === 'damage' && ev.victimId === player.id) {
      SFX.hurt();
    } else if (ev.type === 'death') {
      const dead = state.actors.find((a) => a.id === ev.actorId);
      if (ev.actorId === player.id) {
        SFX.death();
        showToast('ELIMINATED', 3, 'bad');
      } else if (dead) {
        SFX.death();
      }
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);

  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  updateTracers(dt);
  updateImpacts(dt);
  updateExplosions(dt);

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) el.toast.classList.remove('show');
  }

  if (state) {
    if (running) {
      const move = readMove();
      input.moveX = move.x;
      input.moveZ = move.z;
      input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      input.crouch = keys.has('ControlLeft') || keys.has('KeyC');

      // Free-Fire-style default aim: pull the view onto the nearest enemy
      // inside the cone, then let the regular shot code fire.
      if (!isTouch || input.firing || input.aiming) {
        const assisted = applyAimAssist(state, yaw, pitch, dt);
        if (assisted.target && assisted.target.actorId !== assistTarget?.actorId) {
          assistFlash = 1;
        }
        yaw = assisted.yaw;
        pitch = assisted.pitch;
        assistTarget = assisted.target;
      } else {
        assistTarget = null;
      }

      const events = step(state, input, { yaw, pitch }, dt);
      handleEvents(events);

      input.reload = false;
      input.heal = false;
      input.jump = false;
      input.grenade = false;
      input.switchWeapon = null;
    }

    syncViews(dt);
    updateCamera(dt, false);
    updateHud();

    assistFlash = Math.max(0, assistFlash - dt * 3.2);
    pitchKick *= Math.pow(0.02, dt);
    shake = Math.max(0, shake - dt * 3.4);
  } else {
    // Attract mode: slow orbit over the map behind the start menu.
    menuAngle += dt * 0.08;
    menuCamera.position.set(
      Math.cos(menuAngle) * 62,
      34,
      Math.sin(menuAngle) * 62,
    );
    menuCamera.lookAt(0, 0, 0);
  }

  composer.render();
}

/* ---------------------------------------------------------------- compose */

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  LOW_END ? 0.24 : 0.42,   // strength
  0.72,                    // radius
  0.86,                    // threshold
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ boot */

function beginMatch(fresh) {
  state = fresh;
  yaw = 0;
  pitch = -0.05;
  pitchKick = 0;
  shake = 0;
  lastFrame = performance.now();

  Object.assign(input, defaultInput());

  buildWorld(state);

  const player = findPlayer(state);
  camera.position.set(player.x, 2.4, player.z + 5);
  updateCamera(0.016, true);

  el.overlay.classList.add('hidden');
  el.startCard.style.display = 'none';
  el.endCard.style.display = 'none';
  lastFeedHash = '';

  el.touch.classList.toggle('on', isTouch);
  el.hint.textContent = isTouch
    ? 'left = move · right = look · FIRE / GRENADE / SWAP'
    : 'WASD move · Shift sprint · C crouch · RMB look · LMB fire · G grenade · Q swap';

  running = true;
  showToast('SURVIVE. LAST FIGHTER WINS.', 2.4);
}

document.getElementById('btnStart').addEventListener('click', () => {
  beginMatch(createMatch(CONFIG, (Math.random() * 1e9) | 0));
  canvas.focus?.();
});

document.getElementById('btnAgain').addEventListener('click', () => {
  beginMatch(restart(state));
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  menuCamera.aspect = innerWidth / innerHeight;
  menuCamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
});

// Preview world behind the menu.
state = createMatch(CONFIG, 20261108);
buildWorld(state);

// Camera starts in attract mode; `running` flips it to the gameplay camera.
running = false;
requestAnimationFrame(frame);

/* Debug handle for automated smoke tests. */
window.__BR__ = {
  get state() { return state; },
  get running() { return running; },
  beginMatch: (seed = 1) => beginMatch(createMatch(CONFIG, seed)),
  hud: () => (state ? hudModel(state) : null),
  spectate: (dir = 1) => spectate(state, dir),
  advance(seconds, dt = 1 / 60) {
    if (!state) return null;
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n && !state.finished; i++) {
      step(state, { ...defaultInput(), moveX: 0, moveZ: 0 }, { yaw, pitch }, dt);
    }
    return hudModel(state);
  },
};
