/**
 * Headless boot test for web/src/main.js.
 *
 * Provides a DOM stub and replaces only THREE.WebGLRenderer, so the real
 * scene graph, camera math, raycaster and game loop all execute. If this
 * passes, the only thing untested is pixels on a GPU.
 */

const failures = [];
process.on('unhandledRejection', (e) => failures.push('unhandledRejection: ' + (e && e.message)));
process.on('uncaughtException', (e) => failures.push('uncaughtException: ' + (e && e.message)));

/* ------------------------------------------------------------------ DOM */

const nodes = new Map();

function mkList() {
  const s = new Set();
  return {
    _s: s,
    add(...c) { c.forEach((x) => s.add(x)); },
    remove(...c) { c.forEach((x) => s.delete(x)); },
    toggle(c, on) { if (on === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (on) s.add(c); else s.delete(c); },
    contains(c) { return s.has(c); },
  };
}

function mkNode(tag = 'div', id = '') {
  return {
    tagName: String(tag).toUpperCase(),
    id,
    style: {},
    dataset: {},
    classList: mkList(),
    textContent: '',
    innerHTML: '',
    value: '',
    offsetWidth: 100,
    offsetHeight: 100,
    clientWidth: 1280,
    clientHeight: 720,
    width: 1280,
    height: 720,
    children: [],
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { return c; },
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    requestPointerLock() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext(kind) {
      if (kind !== '2d') return {};
      return make2dContext(this);
    },
  };
}

/**
 * Minimal but honest CanvasRenderingContext2D.
 *
 * The renderer paints its textures procedurally at boot, so the headless boot
 * has to be able to run that code. These stubs record nothing — they just have
 * to accept the same calls a browser would, so a typo in the texture painters
 * fails here instead of on the user's phone.
 */
function make2dContext(canvas) {
  const gradient = () => ({ addColorStop() {} });
  const noop = () => {};
  return {
    canvas,
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowBlur: 0,
    shadowColor: 'transparent',
    globalCompositeOperation: 'source-over',
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => ({}),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop,
    measureText: (t) => ({ width: String(t).length * 6 }),
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fillText: noop,
    strokeText: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    transform: noop,
    setTransform: noop,
    resetTransform: noop,
    drawImage: noop,
    setLineDash: noop,
    getLineDash: () => [],
  };
}

const canvasNode = mkNode('canvas', 'game');

globalThis.document = {
  getElementById(id) {
    if (id === 'game') return canvasNode;
    if (!nodes.has(id)) nodes.set(id, mkNode('div', id));
    return nodes.get(id);
  },
  createElement(tag) { return mkNode(tag); },
  createElementNS(_ns, tag) { return mkNode(tag); },
  body: mkNode('body'),
  documentElement: mkNode('html'),
  addEventListener() {},
  removeEventListener() {},
  exitPointerLock() {},
  pointerLockElement: null,
  querySelector() { return null; },
  querySelectorAll() { return []; },
};

/* ------------------------------------------------------- globals / window */

const rafQueue = [];
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.setTimeout = setTimeout;
globalThis.clearTimeout = clearTimeout;
globalThis.performance = performance;

try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', maxTouchPoints: 0, platform: 'node' },
    configurable: true,
    writable: true,
  });
} catch { /* already defined */ }

/* ---------------------------------------------------------------- import */

let error = null;
try {
  await import('../../src/main.js');
} catch (e) {
  error = e;
}

if (error) {
  console.error('IMPORT FAILED:', error.message);
  console.error(error.stack?.split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

const br = globalThis.__BR__;
if (!br) {
  console.error('window.__BR__ missing — main.js did not finish booting');
  process.exit(1);
}

/* ------------------------------------------------------------ assertions */

console.log('booted               :', !!br.state);
console.log('actors / loot / cover:', br.state.actors.length, '/', br.state.loot.length, '/', br.state.world.obstacles.length);

const hud = br.hud();
console.log('hud                  :', JSON.stringify({
  alive: hud.alive, hp: hud.health, ammo: hud.ammo, reserve: hud.reserve,
  zone: Number(hud.zoneRadius.toFixed(1)), progress: hud.progress,
}));

// Drain the requestAnimationFrame queue a few times so frame() actually runs.
for (let i = 0; i < 5; i++) {
  const queued = rafQueue.splice(0, rafQueue.length);
  for (const fn of queued) fn(performance.now() + i * 16);
}

console.log('frames rendered      :', br.state ? 'ok' : 'no state');

// Start a match exactly like the DEPLOY button does.
br.beginMatch(42);
for (let i = 0; i < 10; i++) {
  const queued = rafQueue.splice(0, rafQueue.length);
  for (const fn of queued) fn(performance.now() + i * 16);
}

console.log('after beginMatch     : running =', br.running, '| seed =', br.state.seed);

const before = br.hud();
const after = br.advance(45);
console.log('after 45s simulation :', JSON.stringify({ alive: after.alive, hp: Number(after.health.toFixed(1)), zone: Number(after.zoneRadius.toFixed(1)) }));

if (!(after.zoneRadius < before.zoneRadius)) failures.push('zone did not shrink during simulation');
if (after.alive > before.alive) failures.push('alive count went up');

const player = br.state.actors.find((a) => a.isPlayer);
const finite = ['x', 'z', 'y', 'yaw', 'health'].every((k) => Number.isFinite(player[k]));
if (!finite) failures.push('player state has NaN');
if (after.alive < 1) failures.push('everyone died instantly');

if (failures.length) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}

console.log('\nDOM BOOT OK — scene builds, frames render, match simulates, no runtime errors');
process.exit(0);
