/* Headless tests for the BR logic core — no browser, no three.js, no DOM.
 * Run: node --test web/tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIG,
  makeRng,
  clamp,
  clamp01,
  lerp,
  circleHitsBox,
  circleHitsCircle,
  pushOutOfBox,
  pushOutOfCircle,
  segmentHitsBox,
  zoneRadiusAt,
  isOutsideZone,
  circlePoint,
  centreDistance,
  generateWorld,
  createMatch,
  aliveCount,
  aliveBots,
  findPlayer,
  moveActor,
  applyVertical,
  traceShot,
  firePlayerShot,
  damageActor,
  botFire,
  updateBot,
  updateLoot,
  updatePlayer,
  playerReload,
  playerHeal,
  applyZoneDamage,
  step,
  restart,
  hudModel,
  defaultInput,
} from '../src/logic.js';

/* --------------------------------------------------------------- helpers */

const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (eps ${eps})`);

function newState(seed = 1234) {
  return createMatch(CONFIG, seed);
}

/** Player + a fresh bot at an exact spot, no random spawn involved. */
function duelState(seed = 7) {
  const state = newState(seed);
  state.actors = state.actors.filter((a) => a.isPlayer);
  state.loot = [];
  state.world.obstacles = [];
  const player = findPlayer(state);
  player.x = 0; player.z = 0; player.health = 100; player.alive = true;
  state.player.ammo = CONFIG.magazineSize;
  state.player.reserve = 100;
  return state;
}

function addBot(state, x, z) {
  const bot = {
    id: 9999 + state.actors.length,
    isPlayer: false,
    x, z, y: 0, yaw: 0,
    health: 100,
    alive: true,
    verticalVelocity: 0,
    grounded: true,
    thinkTimer: 0,
    shotTimer: 0,
    strafeDirection: 1,
    targetId: null,
    wanderAngle: 0,
    lastDamageAt: -99,
  };
  state.actors.push(bot);
  return bot;
}

/* ------------------------------------------------------------- pure math */

test('clamp / lerp / clamp01 basics', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
  assert.equal(clamp01(1.4), 1);
  assert.equal(clamp01(-0.2), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(10, 0, 0.25), 7.5);
});

test('rng is deterministic per seed and in [0,1)', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
  const c = makeRng(43);
  assert.notEqual(makeRng(42)(), c(), 'different seeds must diverge');
});

test('circlePoint and centreDistance', () => {
  const p = circlePoint(0, 10);
  close(p.x, 10); close(p.z, 0);
  const q = circlePoint(Math.PI / 2, 5);
  close(q.x, 0); close(q.z, 5);
  close(centreDistance(3, 4), 5);
});

/* --------------------------------------------------------- zone geometry */

test('zone shrinks from 46% of the map to the final radius', () => {
  const start = zoneRadiusAt(0);
  const end = zoneRadiusAt(CONFIG.matchDuration);
  close(start, CONFIG.mapSize * 0.46);
  close(end, CONFIG.zoneFinalRadius);
  assert.ok(start > end);
});

test('zone radius is monotonic and clamped past the deadline', () => {
  let previous = Infinity;
  for (let t = 0; t <= CONFIG.matchDuration; t += 10) {
    const r = zoneRadiusAt(t);
    assert.ok(r <= previous + 1e-9, `radius grew at t=${t}`);
    previous = r;
  }
  close(zoneRadiusAt(CONFIG.matchDuration * 10), CONFIG.zoneFinalRadius);
});

test('isOutsideZone uses the circle, not a square', () => {
  assert.equal(isOutsideZone(10, 0, 20), false);
  assert.equal(isOutsideZone(0, 10, 20), false);
  // 15,15 is inside the bounding box of radius 20 but outside the circle.
  assert.equal(isOutsideZone(15, 15, 20), true);
});

/* ------------------------------------------------------------ collisions */

test('circle vs box: face, corner and clear cases', () => {
  // Box centred at origin, half extents 5x5.
  assert.equal(circleHitsBox(0, 0, 0.5, 0, 0, 5, 5), true, 'inside');
  assert.equal(circleHitsBox(5.2, 0, 0.5, 0, 0, 5, 5), true, 'touching face');
  assert.equal(circleHitsBox(5.6, 0, 0.5, 0, 0, 5, 5), false, 'clear of face');
  assert.equal(circleHitsBox(5.3, 5.3, 0.5, 0, 0, 5, 5), true, 'corner overlap');
  assert.equal(circleHitsBox(5.5, 5.5, 0.5, 0, 0, 5, 5), false, 'clear of corner');
});

test('pushOutOfBox resolves along the shallowest axis', () => {
  const res = pushOutOfBox(5.1, 0, 0.5, 0, 0, 5, 5);
  assert.equal(res.hit, true);
  close(res.x, 5.5);       // pushed out on X, not Z
  close(res.z, 0);

  const resZ = pushOutOfBox(0, 5.1, 0.5, 0, 0, 5, 5);
  close(resZ.z, 5.5);

  const clear = pushOutOfBox(9, 9, 0.5, 0, 0, 5, 5);
  assert.equal(clear.hit, false);
});

test('pushOutOfCircle works, including the degenerate centre case', () => {
  const res = pushOutOfCircle(0.1, 0, 0.5, 0, 0, 1);
  assert.equal(res.hit, true);
  close(Math.hypot(res.x, res.z), 1.5, 1e-6);

  const centre = pushOutOfCircle(0, 0, 0.5, 0, 0, 1);
  assert.equal(centre.hit, true);
  close(Math.hypot(centre.x, centre.z), 1.5, 1e-6);

  const clear = pushOutOfCircle(10, 0, 0.5, 0, 0, 1);
  assert.equal(clear.hit, false);
});

test('circleHitsCircle', () => {
  assert.equal(circleHitsCircle(0, 0, 1, 1.5, 0, 1), true);
  assert.equal(circleHitsCircle(0, 0, 1, 2.1, 0, 1), false);
});

/* --------------------------------------------------------- line of sight */

test('segmentHitsBox returns the entry fraction or 1', () => {
  // Straight through the middle: enters at x=-5 of a 10-wide box from -10.
  const t = segmentHitsBox(-10, 0, 10, 0, 0, 0, 5, 5);
  close(t, 0.25, 1e-9);
  assert.equal(segmentHitsBox(-10, 20, 10, 20, 0, 0, 5, 5), 1, 'passes beside');
  assert.equal(segmentHitsBox(-10, 0, -6, 0, 0, 0, 5, 5), 1, 'stops before');
});

test('segmentHitsBox is axis-symmetric', () => {
  const a = segmentHitsBox(-10, 0, 10, 0, 0, 0, 5, 5);
  const b = segmentHitsBox(0, -10, 0, 10, 0, 0, 5, 5);
  close(a, b, 1e-9);
});

/* ----------------------------------------------------------- world build */

test('world generation is deterministic and stays inside the map', () => {
  const w1 = generateWorld(CONFIG, makeRng(99));
  const w2 = generateWorld(CONFIG, makeRng(99));
  assert.deepEqual(w1, w2);

  const limit = CONFIG.mapSize / 2;
  for (const o of w1.obstacles) {
    assert.ok(Math.abs(o.x) <= limit, `obstacle x ${o.x} outside map`);
    assert.ok(Math.abs(o.z) <= limit, `obstacle z ${o.z} outside map`);
    assert.ok(o.hx > 0 && o.hz > 0 && o.height > 0);
  }
  // Centre cell is skipped and ~17 % of the rest are randomly dropped.
  assert.ok(w1.buildings.length > 0 && w1.buildings.length <= 24,
    `unexpected building count ${w1.buildings.length}`);

  for (const b of w1.buildings) {
    assert.ok(b.width >= 7 && b.width <= 12);
    assert.ok(b.depth >= 7 && b.depth <= 12);
    assert.ok(b.height >= 4 && b.height <= 9);
  }
});

test('createMatch is reproducible and spawns everyone clear of cover', () => {
  const a = newState(2024);
  const b = newState(2024);

  assert.equal(a.actors.length, CONFIG.botCount + 1);
  assert.equal(a.loot.length, CONFIG.lootCount);

  for (let i = 0; i < a.actors.length; i++) {
    close(a.actors[i].x, b.actors[i].x, 1e-9);
    close(a.actors[i].z, b.actors[i].z, 1e-9);
  }

  const player = findPlayer(a);
  assert.equal(player.isPlayer, true);
  close(player.x, CONFIG.spawn.x);
  close(player.z, CONFIG.spawn.z);

  for (const actor of a.actors) {
    assert.equal(actor.health, 100);
    assert.equal(actor.alive, true);
  }

  for (const actor of a.actors) {
    for (const o of a.world.obstacles) {
      assert.equal(
        circleHitsBox(actor.x, actor.z, CONFIG.playerRadius, o.x, o.z, o.hx, o.hz),
        false,
        `actor ${actor.id} spawned inside ${o.kind}`,
      );
    }
  }

  for (const actor of a.actors.slice(1)) {
    assert.ok(
      Math.hypot(actor.x - player.x, actor.z - player.z) >= CONFIG.minPlayerSpawnDistance - 1e-6,
      'bot spawned too close to the player',
    );
  }
});

test('hudModel reports the starting state', () => {
  const state = newState(3);
  const hud = hudModel(state);
  assert.equal(hud.alive, CONFIG.botCount + 1);
  assert.equal(hud.kills, 0);
  assert.equal(hud.health, 100);
  assert.equal(hud.ammo, CONFIG.magazineSize);
  assert.equal(hud.reserve, CONFIG.startAmmoReserve);
  assert.equal(hud.medkits, CONFIG.startMedkits);
  assert.equal(hud.reloading, false);
  assert.equal(hud.finished, false);
  assert.equal(hud.outsideZone, false);
});

/* -------------------------------------------------------------- movement */

test('moveActor stops at cover instead of walking through it', () => {
  const state = newState(11);
  state.actors = state.actors.filter((a) => a.isPlayer);
  state.world.obstacles = [{ kind: 'cover', x: 2, z: 0, hx: 1, hz: 1, height: 1.3 }];

  const player = findPlayer(state);
  player.x = 0; player.z = 0;

  for (let i = 0; i < 60; i++) moveActor(state, player, 0.1, 0);

  // Box face is at x = 1, plus the player radius.
  assert.ok(player.x <= 1 + 1e-6, `walked through the box: x=${player.x}`);
  close(player.x, 1 - CONFIG.playerRadius, 1e-6);
});

test('moveActor keeps the player inside the map bounds', () => {
  const state = newState(12);
  state.actors = state.actors.filter((a) => a.isPlayer);
  state.world.obstacles = [];
  const player = findPlayer(state);
  player.x = 0; player.z = 0;

  for (let i = 0; i < 400; i++) moveActor(state, player, 1, 1);

  const limit = CONFIG.mapSize / 2 - 1;
  close(player.x, limit, 1e-6);
  close(player.z, limit, 1e-6);
});

test('actors cannot overlap each other', () => {
  const state = newState(13);
  state.actors = state.actors.filter((a) => a.isPlayer);
  state.world.obstacles = [];
  const player = findPlayer(state);
  player.x = 0; player.z = 0;
  const bot = addBot(state, 0, 0.1);

  for (let i = 0; i < 40; i++) moveActor(state, player, 0, 0.1);

  const distance = Math.hypot(player.x - bot.x, player.z - bot.z);
  assert.ok(distance >= CONFIG.playerRadius + CONFIG.botRadius - 1e-3,
    `actors overlap: ${distance}`);
});

test('jump goes up, gravity brings the actor back to the floor', () => {
  const state = newState(14);
  const player = findPlayer(state);

  applyVertical(state, player, true, 1 / 60);
  assert.ok(player.y > 0, 'jump must lift the actor');
  assert.equal(player.grounded, false);

  let peak = player.y;
  for (let i = 0; i < 600; i++) {
    applyVertical(state, player, false, 1 / 60);
    peak = Math.max(peak, player.y);
    if (player.grounded && i > 5) break;
  }
  assert.equal(player.grounded, true);
  close(player.y, 0, 1e-9);
  close(player.verticalVelocity, 0, 1e-9);

  // v²/2g => 7²/40 ≈ 1.2 m peak.
  assert.ok(peak > 1.0 && peak < 1.6, `unexpected jump peak ${peak}`);
});

test('a buffered jump is not replayed on landing', () => {
  const state = newState(15);
  const player = findPlayer(state);

  applyVertical(state, player, true, 1 / 60); // jump
  for (let i = 0; i < 120; i++) {
    applyVertical(state, player, false, 1 / 60);
    if (player.grounded) break;
  }
  assert.equal(player.grounded, true, 'should have landed');
  assert.ok(player.y < 0.01, 'should be on the floor');

  applyVertical(state, player, false, 1 / 60);
  assert.equal(player.grounded, true);
  assert.equal(player.verticalVelocity, 0);
});

/* ---------------------------------------------------------------- combat */

test('traceShot finds a bot straight ahead', () => {
  const state = duelState();
  const bot = addBot(state, 0, -10); // directly north (-Z)
  const hit = traceShot(state, 0, 1.35, 0, 0, 0, -1, 1, CONFIG.weaponRange);
  assert.equal(hit.kind, 'actor');
  assert.equal(hit.actorId, bot.id);
  close(hit.t, 10, 0.05);
});

test('traceShot misses when off axis', () => {
  const state = duelState();
  addBot(state, 10, -10);
  const hit = traceShot(state, 0, 1.35, 0, 0, 0, -1, 1, CONFIG.weaponRange);
  assert.equal(hit.kind, 'miss');
});

test('cover blocks the shot', () => {
  const state = duelState();
  const bot = addBot(state, 0, -20);
  state.world.obstacles = [{ kind: 'building', x: 0, z: -10, hx: 3, hz: 3, height: 6 }];

  const hit = traceShot(state, 0, 1.35, 0, 0, 0, -1, 1, CONFIG.weaponRange);
  assert.equal(hit.kind, 'cover');
  close(hit.t, 7, 0.05);
  assert.equal(hit.actorId, null);
  assert.ok(bot.alive);
});

test('low cover does NOT block a shot aimed above it', () => {
  const state = duelState();
  const bot = addBot(state, 0, -20);
  state.world.obstacles = [{ kind: 'cover', x: 0, z: -10, hx: 3, hz: 3, height: 1.3 }];

  // Aim slightly upward so the ray clears the 1.3 m block.
  const hit = traceShot(state, 0, 1.35, 0, 0, 0.02, -1, 1, CONFIG.weaponRange);
  assert.equal(hit.kind, 'actor');
  assert.equal(hit.actorId, bot.id);
});

test('a shot never hits the shooter', () => {
  const state = duelState();
  const player = findPlayer(state);
  const hit = traceShot(state, player.x, 1.35, player.z, 0, 0, -1, player.id, 5);
  assert.equal(hit.kind, 'miss');
});

test('firePlayerShot consumes ammo, respects the fire interval and damages', () => {
  const state = duelState();
  const bot = addBot(state, 0, -10);
  const startAmmo = state.player.ammo;

  const first = firePlayerShot(state, 0, 0);
  assert.ok(first, 'first shot must fire');
  assert.equal(state.player.ammo, startAmmo - 1);
  assert.equal(bot.health, 100 - CONFIG.bodyDamage);

  // Same instant: rate limited.
  const second = firePlayerShot(state, 0, 0);
  assert.equal(second, null);
  assert.equal(state.player.ammo, startAmmo - 1);

  // After the interval it fires again.
  state.time += CONFIG.fireInterval;
  const third = firePlayerShot(state, 0, 0);
  assert.ok(third);
  assert.equal(state.player.ammo, startAmmo - 2);
});

test('headshots do more damage than body shots', () => {
  const state = duelState();
  const bot = addBot(state, 0, -10);

  // Aim so the ray is above 1.5 m when it reaches the bot 10 m away.
  const dy = 1.6 - CONFIG.playerEyeHeight;
  const pitch = Math.atan2(dy, 10);

  const head = traceShot(state, 0, CONFIG.playerEyeHeight, 0, 0, Math.sin(pitch), -Math.cos(pitch), 1, CONFIG.weaponRange);
  assert.equal(head.kind, 'actor');
  assert.equal(head.actorId, bot.id);
  assert.ok(head.y - bot.y > 1.5, `headshot height check failed: ${head.y}`);

  // The same shot at chest height is a body shot.
  const body = traceShot(state, 0, CONFIG.playerEyeHeight, 0, 0, -0.04, -1, 1, CONFIG.weaponRange);
  assert.equal(body.kind, 'actor');
  assert.ok(body.y - bot.y <= 1.5, `body shot read as a headshot: ${body.y}`);

  assert.ok(CONFIG.headshotDamage > CONFIG.bodyDamage);
});

test('killing a bot grants a kill and bonus ammo, never negative health', () => {
  const state = duelState();
  const bot = addBot(state, 0, -10);
  const player = findPlayer(state);
  const reserveBefore = state.player.reserve;

  damageActor(state, bot, 500, player, state.time);

  assert.equal(bot.alive, false);
  assert.equal(bot.health, 0);
  assert.equal(state.player.kills, 1);
  assert.equal(state.player.reserve, reserveBefore + CONFIG.killAmmoBonus);
  assert.ok(state.events.some((e) => e.type === 'death'));
});

test('damaging an already-dead actor does nothing', () => {
  const state = duelState();
  const bot = addBot(state, 0, -10);
  const player = findPlayer(state);
  damageActor(state, bot, 500, player, state.time);
  const kills = state.player.kills;

  damageActor(state, bot, 500, player, state.time);
  assert.equal(state.player.kills, kills, 'double kill on one corpse');
  assert.equal(state.player.reserve, 100 + CONFIG.killAmmoBonus);
});

test('player death is reported as ELIMINATED', () => {
  const state = duelState();
  const player = findPlayer(state);
  addBot(state, 0, -10);
  damageActor(state, player, 200, null, state.time);

  step(state, defaultInput(), { yaw: 0, pitch: 0 }, 1 / 60);
  assert.equal(state.finished, true);
  assert.equal(state.result.title, 'ELIMINATED');
  assert.ok(/Position #\d+/.test(state.result.subtitle));
});

test('killing the last bot wins the match', () => {
  const state = duelState();
  const bot = addBot(state, 0, -10);
  const player = findPlayer(state);
  damageActor(state, bot, 500, player, state.time);

  step(state, defaultInput(), { yaw: 0, pitch: 0 }, 1 / 60);
  assert.equal(state.finished, true);
  assert.equal(state.result.title, 'VICTORY!');
});

/* ------------------------------------------------------------ bots + zone */

test('bot shoots and can damage the player', () => {
  const state = duelState(21);
  state.player.ammo = 30;
  const bot = addBot(state, 0, -12);
  bot.shotTimer = 0;
  const player = findPlayer(state);

  // Force a large number of shots; accuracy is 62 %.
  let damaged = false;
  for (let i = 0; i < 40 && !damaged; i++) {
    bot.shotTimer = 0;
    state.rng = makeRng(i + 1);
    botFire(state, bot, player);
    damaged = player.health < 100;
  }
  assert.ok(damaged, 'bot never landed a hit in 40 attempts');
});

test('bot fire is blocked by cover', () => {
  const state = duelState(22);
  const bot = addBot(state, 0, -12);
  const player = findPlayer(state);
  state.world.obstacles = [{ kind: 'building', x: 0, z: -6, hx: 2, hz: 2, height: 5 }];

  for (let i = 0; i < 30; i++) {
    state.rng = makeRng(i + 1);
    const shot = botFire(state, bot, player);
    assert.equal(shot, null, 'shot passed through a building');
  }
  assert.equal(player.health, 100);
});

test('bot runs toward the centre when the zone catches it', () => {
  const state = duelState(23);
  state.actors = state.actors.filter((a) => a.isPlayer);
  const player = findPlayer(state);
  player.x = 0; player.z = 0;

  const bot = addBot(state, 70, 0);
  bot.thinkTimer = 99; // no target acquisition, isolate zone behaviour
  const before = centreDistance(bot.x, bot.z);

  // Zone radius at t=0 is 73.6, so a bot at 70 is not yet outside. Move it out.
  bot.x = 78;
  const startDistance = centreDistance(bot.x, bot.z);

  for (let i = 0; i < 120; i++) updateBot(state, bot, 1 / 60);

  const endDistance = centreDistance(bot.x, bot.z);
  assert.ok(endDistance < startDistance,
    `bot did not move toward the zone: ${startDistance} -> ${endDistance}`);
  assert.ok(endDistance < before + 10);
});

test('zone damage shrinks health outside and spares inside', () => {
  const state = duelState(24);
  const player = findPlayer(state);
  player.x = 0; player.z = 0;

  const bot = addBot(state, 500, 500); // way outside
  const inside = addBot(state, 1, 1);

  state.time = 200; // zone has shrunk a lot
  const before = bot.health;
  applyZoneDamage(state, 1.0);
  assert.ok(bot.health < before, 'outside actor took no zone damage');
  close(bot.health, before - CONFIG.zoneDamagePerSecond, 1e-6);
  assert.equal(inside.health, 100, 'inside actor took zone damage');
});

test('zone ramps up after the match deadline', () => {
  const state = duelState(25);
  const bot = addBot(state, 500, 500);
  state.time = CONFIG.matchDuration + 1;
  const before = bot.health;
  applyZoneDamage(state, 1.0);
  close(bot.health, before - CONFIG.zoneLateDamagePerSecond, 1e-6);
});

/* ------------------------------------------------------------ economy */

test('reload moves ammo from reserve and takes time', () => {
  const state = duelState();
  // A lone player would instantly win, which ends the match and stops step().
  addBot(state, 60, 60);
  state.player.ammo = 5;
  state.player.reserve = 40;

  assert.equal(playerReload(state), true);
  assert.equal(state.player.reloading, CONFIG.reloadDuration);

  // Reload is a no-op while one is already running.
  assert.equal(playerReload(state), false);

  for (let i = 0; i < 200; i++) step(state, defaultInput(), { yaw: 0, pitch: 0 }, 1 / 60);

  assert.equal(state.player.ammo, CONFIG.magazineSize);
  assert.equal(state.player.reserve, 40 - (CONFIG.magazineSize - 5));
  assert.equal(state.player.reloading, 0);
});

test('reload refuses on a full magazine or empty reserve', () => {
  const state = duelState();
  state.player.ammo = CONFIG.magazineSize;
  assert.equal(playerReload(state), false);

  state.player.ammo = 0;
  state.player.reserve = 0;
  assert.equal(playerReload(state), false);
});

test('heal costs a medkit, caps at 100 and refuses at full health', () => {
  const state = duelState();
  const player = findPlayer(state);
  player.health = 40;

  assert.equal(playerHeal(state), true);
  assert.equal(player.health, 90);
  assert.equal(state.player.medkits, CONFIG.startMedkits - 1);

  assert.equal(playerHeal(state), true);
  assert.equal(player.health, 100, 'heal overshot 100');

  assert.equal(playerHeal(state), false, 'healed at full health');
  assert.equal(state.player.medkits, CONFIG.startMedkits - 2);
});

test('heal refuses with no medkits or while dead', () => {
  const state = duelState();
  const player = findPlayer(state);

  player.health = 10;
  state.player.medkits = 0;
  assert.equal(playerHeal(state), false);

  state.player.medkits = 3;
  player.alive = false;
  assert.equal(playerHeal(state), false);
});

test('loot is picked up once and grants the right reward', () => {
  const state = duelState();
  const player = findPlayer(state);
  player.x = 0; player.z = 0;

  state.loot = [
    { id: 1, x: 0.5, z: 0, y: 0.5, medical: false, taken: false },
    { id: 2, x: 0, z: 0.5, y: 0.5, medical: true, taken: false },
    { id: 3, x: 50, z: 50, y: 0.5, medical: false, taken: false },
  ];

  const reserve = state.player.reserve;
  const medkits = state.player.medkits;

  updateLoot(state, player);

  assert.equal(state.loot[0].taken, true);
  assert.equal(state.loot[1].taken, true);
  assert.equal(state.loot[2].taken, false, 'picked up loot from far away');
  assert.equal(state.player.reserve, reserve + CONFIG.lootAmmo);
  assert.equal(state.player.medkits, medkits + 1);

  // Idempotent: a second pass must not double-grant.
  updateLoot(state, player);
  assert.equal(state.player.reserve, reserve + CONFIG.lootAmmo);
});

/* ------------------------------------------------------------- full sims */

test('a full match runs to completion without throwing', () => {
  const state = newState(777);
  const input = defaultInput();
  const look = { yaw: 0, pitch: 0 };
  const dt = 1 / 60;

  let frames = 0;
  while (!state.finished && frames < 60 * 400) {
    step(state, input, look, dt);
    frames++;
  }

  assert.ok(state.finished, `match never ended after ${frames} frames`);
  assert.ok(state.result && state.result.title);
  assert.ok(state.time <= 400 + 1);
});

test('every bot ends up dead or the player does — no immortal ghosts', () => {
  const state = newState(4242);
  const input = defaultInput();
  const look = { yaw: 0, pitch: 0 };

  let frames = 0;
  while (!state.finished && frames < 60 * 400) {
    step(state, input, look, 1 / 60);
    frames++;
  }

  const player = findPlayer(state);
  const aliveBotsLeft = aliveBots(state).length;
  assert.ok(player.health >= 0);
  assert.ok(aliveBotsLeft >= 0);
  if (state.result.title === 'VICTORY!') assert.equal(aliveBotsLeft, 0);
  else assert.equal(player.alive, false);
});

test('stepping a finished match is a no-op', () => {
  const state = duelState();
  const player = findPlayer(state);
  addBot(state, 0, -10);
  damageActor(state, player, 500, null, state.time);
  step(state, defaultInput(), { yaw: 0, pitch: 0 }, 1 / 60);
  assert.equal(state.finished, true);

  const timeAfter = state.time;
  const events = step(state, defaultInput(), { yaw: 0, pitch: 0 }, 1 / 60);
  assert.equal(state.time, timeAfter, 'clock advanced after the match ended');
  assert.deepEqual(events, []);
});

test('restart produces a fresh, playable match', () => {
  const state = newState(31);
  const player = findPlayer(state);
  damageActor(state, player, 500, null, state.time);

  const fresh = restart(state);
  assert.equal(fresh.finished, false);
  assert.equal(fresh.player.kills, 0);
  assert.equal(fresh.player.ammo, CONFIG.magazineSize);
  assert.equal(aliveCount(fresh), CONFIG.botCount + 1);
  assert.equal(findPlayer(fresh).health, 100);
});

test('player movement is camera-relative', () => {
  const state = duelState();
  const player = findPlayer(state);
  player.x = 0; player.z = 0;

  // Facing yaw 0 means looking down -Z, so forward (moveZ = 1) goes -Z.
  const input = { ...defaultInput(), moveX: 0, moveZ: 1 };
  for (let i = 0; i < 10; i++) {
    updatePlayer(state, input, 0, 1 / 60);
  }
  assert.ok(player.z < -0.5, `expected movement toward -Z, got z=${player.z}`);
  close(player.x, 0, 1e-6);

  // Turning 90° should move along +X for the same input.
  const state2 = duelState();
  const p2 = findPlayer(state2);
  p2.x = 0; p2.z = 0;
  for (let i = 0; i < 10; i++) {
    updatePlayer(state2, input, Math.PI / 2, 1 / 60);
  }
  assert.ok(p2.x < -0.5 || p2.x > 0.5, `turn did not change the axis: x=${p2.x}`);
});

test('no NaN leaks into the state after a long run', () => {
  const state = newState(555);
  const input = defaultInput();
  for (let i = 0; i < 60 * 90 && !state.finished; i++) {
    step(state, input, { yaw: 0.3, pitch: 0.1 }, 1 / 60);
  }

  for (const a of state.actors) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z), `actor ${a.id} NaN position`);
    assert.ok(Number.isFinite(a.health), `actor ${a.id} NaN health`);
    assert.ok(Number.isFinite(a.yaw), `actor ${a.id} NaN yaw`);
  }
  for (const item of state.loot) {
    assert.ok(Number.isFinite(item.x) && Number.isFinite(item.z));
  }
  assert.ok(Number.isFinite(state.player.ammo));
  assert.ok(Number.isFinite(state.player.reserve));
});
