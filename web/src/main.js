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

/* ------------------------------------------------------------------ mats */

const MAT = {
  ground: new THREE.MeshStandardMaterial({ color: 0x445c3a, roughness: 0.99, metalness: 0.0 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x9c9480, roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x4a5761, roughness: 0.75, metalness: 0.15 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b222a, roughness: 0.45, metalness: 0.55 }),
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
    const body = new THREE.Mesh(BOX, isBuilding ? MAT.wall : MAT.roof);
    body.scale.set(o.hx * 2, o.height, o.hz * 2);
    body.position.set(o.x, o.height / 2, o.z);
    body.castShadow = true;
    body.receiveShadow = true;
    worldGroup.add(body);

    if (isBuilding) {
      const roof = new THREE.Mesh(BOX, MAT.roof);
      roof.scale.set(o.hx * 2 + 0.7, 0.42, o.hz * 2 + 0.7);
      roof.position.set(o.x, o.height + 0.21, o.z);
      roof.castShadow = true;
      worldGroup.add(roof);
    }
  }

  for (const w of state.world.windows) {
    const panel = new THREE.Mesh(BOX, MAT.dark);
    panel.scale.set(w.w, w.h, 0.06);
    panel.position.set(w.x, w.y, w.z);
    worldGroup.add(panel);
  }

  for (const item of state.loot) {
    const mat = item.kind === 'medical' ? MAT.medical
      : item.kind === 'armor' ? MAT.armor
      : item.kind === 'grenade' ? MAT.grenade
      : MAT.ammo;

    const mesh = new THREE.Mesh(BOX, mat);
    mesh.scale.setScalar(item.kind === 'grenade' ? 0.4 : 0.55);
    mesh.position.set(item.x, item.y, item.z);
    mesh.castShadow = true;

    // A faint glow card under each pickup makes loot findable at a distance.
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ color: mat.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.44;
    mesh.add(halo);

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

function buildActor(actor) {
  const root = new THREE.Group();

  const bodyMat = (actor.isPlayer ? MAT.player : MAT.bot).clone();
  const baseEmissive = bodyMat.emissive.getHex();

  // Torso is a capsule-ish cylinder, legs are two boxes.
  const torso = new THREE.Mesh(CYL, bodyMat);
  torso.scale.set(0.36, 0.5, 0.36);
  torso.position.y = 1.16;
  torso.castShadow = true;
  root.add(torso);

  const hips = new THREE.Mesh(CYL, bodyMat);
  hips.scale.set(0.32, 0.3, 0.32);
  hips.position.y = 0.72;
  hips.castShadow = true;
  root.add(hips);

  const legL = new THREE.Mesh(BOX, MAT.dark);
  legL.scale.set(0.16, 0.62, 0.18);
  legL.position.set(-0.13, 0.31, 0);
  root.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.13;
  root.add(legR);

  const head = new THREE.Mesh(SPH, bodyMat);
  head.scale.setScalar(0.25);
  head.position.y = 1.6;
  head.castShadow = true;
  root.add(head);

  const visor = new THREE.Mesh(BOX, MAT.dark);
  visor.scale.set(0.22, 0.09, 0.06);
  visor.position.set(0, 1.62, -0.23);
  root.add(visor);

  const gun = new THREE.Mesh(BOX, MAT.dark);
  gun.scale.set(0.1, 0.13, 0.78);
  gun.position.set(0.28, 1.18, -0.34);
  root.add(gun);

  // Muzzle-flash sprite parented to the gun.
  const muzzle = new THREE.Mesh(SPH, MAT.flash);
  muzzle.scale.setScalar(0.16);
  muzzle.position.set(0.28, 1.18, -0.78);
  muzzle.visible = false;
  root.add(muzzle);

  return { root, torso, head, gun, muzzle, dead: false, hitMaterial: bodyMat, baseEmissive, legL, legR };
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

function buildViewmodel() {
  if (viewmodel) {
    camera.remove(viewmodel.root);
  }
  const root = new THREE.Group();

  const body = new THREE.Mesh(BOX, MAT.dark);
  body.scale.set(0.06, 0.075, 0.52);
  root.add(body);

  const barrel = new THREE.Mesh(BOX, MAT.dark);
  barrel.scale.set(0.032, 0.032, 0.34);
  barrel.position.set(0, 0.012, -0.4);
  root.add(barrel);

  const sight = new THREE.Mesh(BOX, MAT.dark);
  sight.scale.set(0.03, 0.055, 0.06);
  sight.position.set(0, 0.07, -0.06);
  root.add(sight);

  const muzzle = new THREE.Mesh(SPH, MAT.flash);
  muzzle.scale.setScalar(0.1);
  muzzle.position.set(0, 0.012, -0.6);
  muzzle.visible = false;
  root.add(muzzle);

  root.position.set(0.26, -0.24, -0.52);
  root.rotation.set(0, 0.04, 0);
  root.visible = false;
  camera.add(root);

  viewmodel = { root, body, barrel, muzzle, recoil: 0, kick: 0 };
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
let shake = 0;
let lastFrame = performance.now();
let menuAngle = 0;
const input = defaultInput();

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

/* -------------------------------------------------------------------- HUD */

const el = {
  alive: document.getElementById('alive'),
  kills: document.getElementById('kills'),
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
    viewmodel.body.scale.z = weapon.id === 'shotgun' ? 0.46 : weapon.id === 'smg' ? 0.42 : 0.52;
    viewmodel.barrel.scale.z = weapon.id === 'shotgun' ? 0.3 : 0.34;

    const bob = target.sprinting ? Math.sin(state.time * 16) * 0.014 : Math.sin(state.time * 7) * 0.005;
    viewmodel.root.position.y = -0.24 + bob;
    viewmodel.root.position.z = -0.52 + viewmodel.kick;
    viewmodel.root.rotation.x = viewmodel.recoil * 0.7;

    viewmodel.recoil *= 0.86;
    viewmodel.kick *= 0.82;

    viewmodel.muzzle.visible = viewmodel.muzzleTime > 0;
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

    // Running bob on the legs.
    if (actor.sprinting) {
      const swing = Math.sin(state.time * 14 + actor.id) * 0.25;
      view.legL.rotation.x = swing;
      view.legR.rotation.x = -swing;
    } else {
      view.legL.rotation.x *= 0.9;
      view.legR.rotation.x *= 0.9;
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
    mesh.rotation.y += dt * 1.5;
    mesh.position.y = item.y + Math.sin(state.time * 2.2 + item.id) * 0.1;
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
          showToast(hit.headshot ? 'HEADSHOT' : 'HIT', 0.4, hit.headshot ? 'crit' : '');
        }
      }
    } else if (ev.type === 'loot') {
      showToast(ev.text, 0.9, 'loot');
    } else if (ev.type === 'reload') {
      showToast('RELOADING', 0.8);
    } else if (ev.type === 'heal') {
      showToast('+50 HEALTH', 0.9, 'heal');
    } else if (ev.type === 'weapon') {
      showToast(ev.name, 0.7, 'weapon');
    } else if (ev.type === 'explosion') {
      spawnExplosion(ev.x, ev.y, ev.z, ev.radius);
    } else if (ev.type === 'death') {
      if (ev.actorId === player.id) showToast('ELIMINATED', 3, 'bad');
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
