/* ==========================================================================
 * Renderer + input + HUD shell.
 *
 * All game rules live in logic.js; this file only:
 *   - builds three.js meshes from the state,
 *   - feeds raw input into the logic structs,
 *   - pushes the HUD model into the DOM.
 * ========================================================================== */

import * as THREE from '../vendor/three.module.min.js';
import {
  CONFIG,
  createMatch,
  step,
  restart,
  hudModel,
  findPlayer,
  defaultInput,
  currentZoneRadius,
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
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb8cc);
scene.fog = new THREE.Fog(0xa9c8da, 95, 235);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 320);

/* ------------------------------------------------------------------- sky */

{
  const skyGeo = new THREE.SphereGeometry(300, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x2f6f9c) },
      bottom: { value: new THREE.Color(0xcfe3ee) },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vH = normalize(world.xyz).y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; varying float vH;
      void main() {
        gl_FragColor = vec4(mix(bottom, top, clamp(vH * 1.15 + 0.15, 0.0, 1.0)), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

/* ----------------------------------------------------------------- lights */

const hemi = new THREE.HemisphereLight(0xdcefff, 0x44543a, 1.05);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2d6, 2.1);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 260;
sun.shadow.camera.left = -105;
sun.shadow.camera.right = 105;
sun.shadow.camera.top = 105;
sun.shadow.camera.bottom = -105;
sun.shadow.bias = -0.0009;
scene.add(sun);
scene.add(sun.target);

/* ------------------------------------------------------------------ mats */

const MAT = {
  ground: new THREE.MeshStandardMaterial({ color: 0x46603c, roughness: 1 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x968f7a, roughness: 0.92 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x4d5a63, roughness: 0.8 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1f262e, roughness: 0.55, metalness: 0.35 }),
  player: new THREE.MeshStandardMaterial({ color: 0x1e9ef2, roughness: 0.5 }),
  bot: new THREE.MeshStandardMaterial({ color: 0xe0512e, roughness: 0.6 }),
  ammo: new THREE.MeshStandardMaterial({ color: 0xffbf1f, emissive: 0x6a4b00, roughness: 0.4 }),
  medical: new THREE.MeshStandardMaterial({ color: 0x26f073, emissive: 0x0a5c27, roughness: 0.4 }),
  zone: new THREE.MeshBasicMaterial({
    color: 0x38d0ff, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false,
  }),
  zoneWall: new THREE.MeshBasicMaterial({
    color: 0x38d0ff, transparent: true, opacity: 0.10,
    side: THREE.DoubleSide, depthWrite: false,
  }),
  tracer: new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.95 }),
  tracerBot: new THREE.MeshBasicMaterial({ color: 0xff8a5c, transparent: true, opacity: 0.8 }),
};

/* ------------------------------------------------------------ world build */

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const actorViews = new Map();
const lootViews = new Map();
let zoneRing = null;
let zoneWall = null;
const tracers = [];

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);

function clearGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse?.((o) => {
      if (o.geometry && o.geometry !== BOX && o.geometry !== CYL) o.geometry.dispose();
    });
  }
}

function buildWorld(state) {
  clearGroup(worldGroup);
  actorViews.clear();
  lootViews.clear();

  // Ground.
  const ground = new THREE.Mesh(BOX, MAT.ground);
  ground.scale.set(state.cfg.mapSize, 1, state.cfg.mapSize);
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  worldGroup.add(ground);

  // A faint grid so movement reads clearly on a flat plane.
  const grid = new THREE.GridHelper(state.cfg.mapSize, 40, 0x2e442c, 0x2e442c);
  grid.position.y = 0.012;
  grid.material.opacity = 0.32;
  grid.material.transparent = true;
  worldGroup.add(grid);

  // Buildings + low cover.
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
      roof.scale.set(o.hx * 2 + 0.6, 0.4, o.hz * 2 + 0.6);
      roof.position.set(o.x, o.height + 0.2, o.z);
      roof.castShadow = true;
      worldGroup.add(roof);
    }
  }

  // Window panels on the front face.
  for (const w of state.world.windows) {
    const panel = new THREE.Mesh(BOX, MAT.dark);
    panel.scale.set(w.w, w.h, 0.06);
    panel.position.set(w.x, w.y, w.z);
    worldGroup.add(panel);
  }

  // Loot.
  for (const item of state.loot) {
    const mesh = new THREE.Mesh(BOX, item.medical ? MAT.medical : MAT.ammo);
    mesh.scale.setScalar(0.62);
    mesh.position.set(item.x, item.y, item.z);
    mesh.castShadow = true;
    worldGroup.add(mesh);
    lootViews.set(item.id, mesh);
  }

  // Actors.
  for (const actor of state.actors) {
    const view = buildActor(actor);
    worldGroup.add(view.root);
    actorViews.set(actor.id, view);
  }

  buildZone(state);
}

function buildActor(actor) {
  const root = new THREE.Group();

  const bodyMat = (actor.isPlayer ? MAT.player : MAT.bot).clone();
  const baseEmissive = bodyMat.emissive.getHex();
  const body = new THREE.Mesh(CYL, bodyMat);
  body.scale.set(0.42, 0.86, 0.42);
  body.position.y = 0.86;
  body.castShadow = true;
  root.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), bodyMat);
  head.position.y = 1.58;
  head.castShadow = true;
  root.add(head);

  const gun = new THREE.Mesh(BOX, MAT.dark);
  gun.scale.set(0.11, 0.14, 0.8);
  gun.position.set(0.3, 1.24, -0.36);
  root.add(gun);

  // A nose marker so the facing direction is unmistakable at a distance.
  const nose = new THREE.Mesh(BOX, MAT.dark);
  nose.scale.set(0.1, 0.1, 0.12);
  nose.position.set(0, 1.58, -0.28);
  root.add(nose);

  return { root, body, head, gun, dead: false, hitMaterial: bodyMat, baseEmissive };
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

  const segments = 128;
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 3), 3));
  zoneRing = new THREE.LineLoop(ringGeo, new THREE.LineBasicMaterial({ color: 0x38d0ff }));
  zoneRing.position.y = 0.2;
  scene.add(zoneRing);

  const wallGeo = new THREE.CylinderGeometry(1, 1, 26, segments, 1, true);
  zoneWall = new THREE.Mesh(wallGeo, MAT.zoneWall);
  wallGeo.translate(0, 0, 0);
  zoneWall.position.y = 13;
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

/* ------------------------------------------------------------------ tracer */

function spawnTracer(from, to, fromBot) {
  const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  const length = dir.length();
  if (length < 0.01) return;

  const mesh = new THREE.Mesh(BOX, fromBot ? MAT.tracerBot : MAT.tracer);
  mesh.scale.set(0.035, 0.035, length);
  mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  mesh.lookAt(to.x, to.y, to.z);
  scene.add(mesh);
  tracers.push({ mesh, life: fromBot ? 0.06 : 0.055 });
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    if (t.life <= 0) {
      scene.remove(t.mesh);
      tracers.splice(i, 1);
    }
  }
}

/* ----------------------------------------------------------------- effects */

const impactPool = [];
const hitFlash = { life: 0 };

function spawnImpact(point) {
  let mesh = impactPool.pop();
  if (!mesh) {
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true }));
    scene.add(mesh);
  }
  mesh.visible = true;
  mesh.position.set(point.x, point.y, point.z);
  mesh.userData.life = 0.13;
  if (!impactPool.includes(mesh)) impactPool.push(mesh);
  activeImpacts.push(mesh);
}

const activeImpacts = [];

function updateImpacts(dt) {
  for (let i = activeImpacts.length - 1; i >= 0; i--) {
    const mesh = activeImpacts[i];
    mesh.userData.life -= dt;
    const k = Math.max(0, mesh.userData.life / 0.13);
    mesh.scale.setScalar(0.5 + (1 - k) * 1.6);
    mesh.material.opacity = k;
    if (mesh.userData.life <= 0) {
      mesh.visible = false;
      activeImpacts.splice(i, 1);
      mesh.material.opacity = 1;
      impactPool.push(mesh);
    }
  }
}

/* ------------------------------------------------------------------ state */

let state = null;
let running = false;
let yaw = 0;
let pitch = 0;
let lastFrame = performance.now();
const input = defaultInput();

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

/* ------------------------------------------------------------------- HUD */

const el = {
  alive: document.getElementById('alive'),
  kills: document.getElementById('kills'),
  hpFill: document.getElementById('hpFill'),
  hpText: document.getElementById('hpText'),
  zoneLabel: document.getElementById('zoneLabel'),
  timerFill: document.getElementById('timerFill'),
  ammoText: document.getElementById('ammoText'),
  reserveText: document.getElementById('reserveText'),
  toast: document.getElementById('toast'),
  zoneWarning: document.getElementById('zoneWarning'),
  damage: document.getElementById('damage'),
  hitmark: document.getElementById('hitmark'),
  overlay: document.getElementById('overlay'),
  startCard: document.getElementById('startCard'),
  endCard: document.getElementById('endCard'),
  resultTitle: document.getElementById('resultTitle'),
  resultSub: document.getElementById('resultSub'),
  resultKind: document.getElementById('resultKind'),
  endKills: document.getElementById('endKills'),
  endTime: document.getElementById('endTime'),
  endAlive: document.getElementById('endAlive'),
  hint: document.getElementById('hint'),
  touch: document.getElementById('touch'),
};

let toastTimer = 0;

function showToast(text, seconds = 1.2) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  toastTimer = seconds;
}

function flashHit(headshot) {
  el.hitmark.classList.remove('show', 'head');
  void el.hitmark.offsetWidth;
  el.hitmark.classList.add('show');
  if (headshot) el.hitmark.classList.add('head');
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

  el.zoneLabel.textContent = `SAFE ZONE ${Math.ceil(hud.zoneRadius)}m`;
  el.timerFill.style.width = `${(hud.progress * 100).toFixed(1)}%`;

  if (hud.reloading) {
    el.ammoText.textContent = 'RELOADING';
    el.ammoText.classList.add('small');
  } else {
    el.ammoText.textContent = `${hud.ammo}`;
    el.ammoText.classList.remove('small');
  }
  el.reserveText.textContent =
    `RESERVE ${hud.reserve} · MEDKIT ${hud.medkits}`;

  el.zoneWarning.classList.toggle('on', hud.outsideZone && !hud.finished);
  el.damage.style.opacity = (hud.damageFlash > 0 ? hud.damageFlash * 4.2 : 0).toFixed(2);

  if (hud.finished) showEnd(hud);
}

function showEnd(hud) {
  if (!running) return;
  running = false;
  el.overlay.classList.remove('hidden');
  el.startCard.style.display = 'none';
  el.endCard.style.display = '';

  const win = hud.result && hud.result.title.startsWith('VICTORY');
  el.resultTitle.textContent = hud.result ? hud.result.title : 'MATCH OVER';
  el.resultTitle.className = win ? 'win' : 'lose';
  el.resultSub.textContent = hud.result ? hud.result.subtitle : '';
  el.resultKind.textContent = win ? 'MATCH WON' : 'MATCH OVER';
  el.endKills.textContent = hud.kills;
  el.endTime.textContent = `${Math.ceil(state.time)}s`;
  el.endAlive.textContent = hud.alive;

  document.exitPointerLock?.();
}

/* ----------------------------------------------------------------- input */

const keys = new Set();
let mouseLook = false;
let touchLook = null;
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
  if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
  if (e.code === 'Escape') document.exitPointerLock?.();
});
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
  pitch = Math.max(-0.75, Math.max(-1.2, Math.min(1.15, pitch)));
});

/* --- touch --- */

function stickRadiusPx() { return 65; }

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
    const max = stickRadiusPx();
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

let touchLookLast = null;

lookZone.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier !== touchLook) continue;
    const dx = t.clientX - touchLookLast.x;
    const dy = t.clientY - touchLookLast.y;
    touchLookLast = { x: t.clientX, y: t.clientY };
    yaw -= dx * 0.0052;
    pitch -= dy * 0.0052;
    pitch = Math.max(-1.2, Math.min(1.15, pitch));
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
  // Desktop click fallback so the same buttons work with a mouse.
  node.addEventListener('mousedown', start);
  node.addEventListener('mouseup', end);
}

bindHoldButton('btnFire',
  () => { input.firing = true; },
  () => { input.firing = false; });
bindHoldButton('btnReload', () => { input.reload = true; });
bindHoldButton('btnHeal', () => { input.heal = true; });
bindHoldButton('btnJump', () => { input.jump = true; });

function readKeyboardMove() {
  if (stickTouchId !== null) {
    return { x: stickValue.x, z: -stickValue.y };
  }
  let x = 0;
  let z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (x === 0 && z === 0) return { x: 0, z: 0 };
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}

/* --------------------------------------------------------------- camera */

const camPivot = new THREE.Vector3();
const camOffset = new THREE.Vector3(0.62, 0.32, 4.5);
const camDesired = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const cameraSmooth = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
raycaster.far = 6;

function updateCamera(dt, instant) {
  const player = findPlayer(state);
  const view = actorViews.get(player.id);
  if (!view) return;

  camPivot.set(player.x, CONFIG.playerEyeHeight + 0.25, player.z);

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  tmpDir.copy(camOffset).applyQuaternion(q);

  camDesired.copy(camPivot).add(tmpDir);

  // Keep the camera out of geometry by shortening the boom.
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

  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  sun.target.position.set(player.x, 0, player.z);
  sun.position.set(player.x + 60, 90, player.z + 40);
}

/* ------------------------------------------------------------------ loop */

function syncViews(dt) {
  for (const actor of state.actors) {
    const view = actorViews.get(actor.id);
    if (!view) continue;

    view.root.position.set(actor.x, actor.y, actor.z);
    view.root.rotation.y = actor.yaw;

    if (!actor.alive && !view.dead) {
      view.dead = true;
      view.root.rotation.z = Math.PI / 2;
      view.root.position.y = 0.24;
      view.hitMaterial.color.setHex(0x2a323a);
      view.hitMaterial.emissiveIntensity = 1;
      view.head.material = view.hitMaterial;
    }

    // Hit flash: each actor owns its material so the flash does not leak
    // onto every other actor sharing the same shader.
    const lit = actor.alive && state.time - actor.lastDamageAt < 0.12;
    view.hitMaterial.emissive.setHex(lit ? 0xffffff : view.baseEmissive);
    view.hitMaterial.emissiveIntensity = lit ? 1.3 : 1;
  }

  for (const item of state.loot) {
    const mesh = lootViews.get(item.id);
    if (!mesh) continue;
    if (item.taken) {
      mesh.visible = false;
      continue;
    }
    mesh.rotation.y += dt * 1.6;
    mesh.position.y = item.y + Math.sin(state.time * 2.4 + item.id) * 0.11;
  }

  updateZoneMesh(state);
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === 'shot') {
      spawnTracer(ev.shot.from, ev.shot.to, ev.fromBot != null);
      if (ev.shot.kind !== 'miss') spawnImpact(ev.shot.to);
      if (ev.shot.victimId != null && ev.fromBot == null) {
        flashHit(ev.shot.headshot);
        showToast(ev.shot.headshot ? 'HEADSHOT' : 'HIT', 0.45);
      }
    } else if (ev.type === 'loot') {
      showToast(ev.text, 1.0);
    } else if (ev.type === 'death' && ev.actorId === findPlayer(state).id) {
      showToast('ELIMINATED', 2);
    } else if (ev.type === 'reload') {
      showToast('RELOADING', 1.2);
    } else if (ev.type === 'heal') {
      showToast('+50 HEALTH', 1.0);
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);

  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  updateTracers(dt);
  updateImpacts(dt);

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) el.toast.classList.remove('show');
  }

  if (state) {
    if (running) {
      const move = readKeyboardMove();
      input.moveX = move.x;
      input.moveZ = move.z;

      const events = step(state, input, { yaw, pitch }, dt);
      handleEvents(events);

      input.reload = false;
      input.heal = false;
      input.jump = false;
    }

    syncViews(dt);
    updateCamera(dt, false);
    updateHud();
  }

  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ boot */

function beginMatch(fresh) {
  state = fresh;
  yaw = 0;
  pitch = -0.06;
  lastFrame = performance.now();

  Object.assign(input, defaultInput());

  buildWorld(state);

  const player = findPlayer(state);
  camera.position.set(player.x, 2.4, player.z + 5);
  updateCamera(0.016, true);

  el.overlay.classList.add('hidden');
  el.startCard.style.display = 'none';
  el.endCard.style.display = 'none';

  const useTouch = isTouch;
  el.touch.classList.toggle('on', useTouch);
  el.hint.textContent = useTouch
    ? 'left half = move · right half = look'
    : 'WASD move · right mouse look · click fire';

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
  renderer.setSize(innerWidth, innerHeight, false);
});

// Show a preview behind the menu so the start screen is not a black box.
state = createMatch(CONFIG, 20261108);
buildWorld(state);
updateCamera(0.016, true);
updateHud();

requestAnimationFrame(frame);

/* Expose a small debug handle for automated smoke tests. */
window.__BR__ = {
  get state() { return state; },
  get running() { return running; },
  beginMatch: (seed = 1) => beginMatch(createMatch(CONFIG, seed)),
  hud: () => (state ? hudModel(state) : null),
  advance(seconds, dt = 1 / 60) {
    if (!state) return null;
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n && !state.finished; i++) {
      step(state, { ...defaultInput(), moveX: 0, moveZ: 0 }, { yaw, pitch }, dt);
    }
    return hudModel(state);
  },
};
