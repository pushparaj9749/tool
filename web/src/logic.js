/* ==========================================================================
 * BRGame logic core — pure, framework-free, deterministic.
 *
 * NOTHING in this file touches three.js, the DOM, or the wall clock.
 * The renderer (main.js) calls step() with a fixed dt and reads the state;
 * the tests (tests/logic.test.mjs) call the exact same functions headlessly.
 * That is why the game can be verified without a browser.
 * ========================================================================== */

export const CONFIG = {
  botCount: 15,
  mapSize: 160,
  matchDuration: 240,

  movementSpeed: 6,
  lookSensitivity: 0.13,

  magazineSize: 30,
  fireInterval: 0.11,
  reloadDuration: 1.7,
  weaponRange: 120,

  playerRadius: 0.42,
  playerHeight: 1.85,
  playerEyeHeight: 1.35,

  botRadius: 0.42,
  botSpeed: 3.8,
  botSightRange: 48,
  botFireRange: 42,
  botAccuracy: 0.62,
  botBodyDamage: [7, 13],

  headshotDamage: 65,
  bodyDamage: 26,
  killAmmoBonus: 20,

  zoneDamagePerSecond: 7,
  zoneLateDamagePerSecond: 18,
  zoneFinalRadius: 4,

  gravity: 20,
  jumpVelocity: 7,

  startAmmoReserve: 150,
  startMedkits: 3,
  reloadOnEmpty: true,

  lootCount: 24,
  lootPickupRadius: 1.7,
  lootAmmo: 60,
  lootMedkit: 1,

  spawnClearance: 3,
  minPlayerSpawnDistance: 20,

  spawn: { x: 0, z: -15 },
};

/* ---------------------------------------------------------------- helpers */

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v) {
  return clamp(v, 0, 1);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Deterministic PRNG so a seed reproduces a whole match exactly. */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return function next() {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

export function rngRange(rng, lo, hi) {
  return lo + (hi - lo) * rng();
}

/** Point on the unit circle at `angle` (y up on the ground plane). */
export function circlePoint(angle, radius = 1) {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/** Distance from the map centre on the ground plane. */
export function centreDistance(x, z) {
  return Math.hypot(x, z);
}

/**
 * Safe-zone radius after `t` seconds of a `duration`-second match.
 * Shrinks linearly from 46 % of the map to CONFIG.zoneFinalRadius.
 */
export function zoneRadiusAt(t, duration = CONFIG.matchDuration, mapSize = CONFIG.mapSize) {
  const from = mapSize * 0.46;
  const k = clamp01(t / Math.max(1, duration));
  return lerp(from, CONFIG.zoneFinalRadius, k);
}

/** True when the actor is standing outside the shrinking circle. */
export function isOutsideZone(x, z, radius) {
  return centreDistance(x, z) > radius;
}

/* ----------------------------------------------------------- collisions */

/** True when (x,z) with `radius` overlaps a circle (cx,cz,cr). */
export function circleHitsCircle(x, z, radius, cx, cz, cr) {
  const r = radius + cr;
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

/**
 * True when (x,z) with `radius` overlaps an axis-aligned box centred at
 * (bx,bz) with half-extents (hx,hz).
 */
export function circleHitsBox(x, z, radius, bx, bz, hx, hz) {
  const dx = Math.abs(x - bx) - hx;
  const dz = Math.abs(z - bz) - hz;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  return outside < radius;
}

/** Push (x,z) out of a circle; returns the corrected position. */
export function pushOutOfCircle(x, z, radius, cx, cz, cr) {
  const r = radius + cr;
  let dx = x - cx;
  let dz = z - cz;
  let d = Math.hypot(dx, dz);
  if (d >= r) return { x, z, hit: false };
  if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
  const k = r / d;
  return { x: cx + dx * k, z: cz + dz * k, hit: true };
}

/** Push (x,z) out of an AABB; returns the corrected position. */
export function pushOutOfBox(x, z, radius, bx, bz, hx, hz) {
  const dx = x - bx;
  const dz = z - bz;
  const px = hx + radius - Math.abs(dx);
  const pz = hz + radius - Math.abs(dz);
  if (px <= 0 || pz <= 0) return { x, z, hit: false };
  if (px < pz) return { x: bx + Math.sign(dx || 1) * (hx + radius), z, hit: true };
  return { x, z: bz + Math.sign(dz || 1) * (hz + radius), hit: true };
}

/**
 * 2-D line-of-sight test from (ax,az) to (bx,bz) against a box.
 * Uses the slab method on the segment. Returns the hit fraction (0..1) or 1.
 */
export function segmentHitsBox(ax, az, bx, bz, cx, cz, hx, hz) {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;

  const minX = cx - hx, maxX = cx + hx;
  const minZ = cz - hz, maxZ = cz + hz;

  for (const axis of [['x', minX, maxX, dx, ax], ['z', minZ, maxZ, dz, az]]) {
    const [, lo, hi, d, origin] = axis;
    if (Math.abs(d) < 1e-9) {
      if (origin < lo || origin > hi) return 1;
      continue;
    }
    let t1 = (lo - origin) / d;
    let t2 = (hi - origin) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return 1;
  }
  return tmin > 0 ? tmin : 1;
}

/* ----------------------------------------------------------------- world */

/**
 * Static cover geometry. Buildings are solid blocks with roofs (no interiors,
 * exactly like the Unity prototype); `cover` are the low blocks you can shoot
 * over but not walk through.
 */
export function generateWorld(cfg = CONFIG, rng = makeRng(1)) {
  const buildings = [];
  const windows = [];

  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      if (x === 0 && z === 0) continue;
      if (rng() < 0.17) continue;

      const px = x * 25 + rngRange(rng, -3, 3);
      const pz = z * 25 + rngRange(rng, -3, 3);
      const width = rngRange(rng, 7, 12);
      const depth = rngRange(rng, 7, 12);
      const height = rngRange(rng, 4, 9);

      buildings.push({
        kind: 'building', x: px, z: pz,
        hx: width / 2, hz: depth / 2, height,
        width, depth,
      });

      for (let w = -1; w <= 1; w++) {
        windows.push({
          x: px + w * 2,
          y: 2.8,
          z: pz - depth / 2 - 0.03,
          w: 1.1, h: 1.2,
        });
      }
    }
  }

  const obstacles = buildings.map((b) => ({
    kind: b.kind, x: b.x, z: b.z, hx: b.hx, hz: b.hz, height: b.height,
  }));

  for (let i = 0; i < 22; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * cfg.mapSize * 0.4;
    const px = Math.cos(angle) * radius;
    const pz = Math.sin(angle) * radius;

    if (Math.hypot(px - cfg.spawn.x, pz - cfg.spawn.z) < 5) continue;

    const size = rngRange(rng, 1.5, 3);
    obstacles.push({
      kind: 'cover', x: px, z: pz,
      hx: size / 2, hz: size / 2, height: 1.3,
    });
  }

  return { buildings, windows, obstacles, mapSize: cfg.mapSize };
}

/** True when a circle at (x,z) is clear of cover and other actors. */
export function positionClear(world, x, z, radius, actors, margin = 2) {
  for (const o of world.obstacles) {
    if (circleHitsBox(x, z, radius + margin, o.x, o.z, o.hx, o.hz)) return false;
  }
  for (const a of actors) {
    if (!a.alive) continue;
    if (circleHitsCircle(x, z, radius, a.x, a.z, 3)) return false;
  }
  return true;
}

/** Random clear spawn point inside 40 % of the map. Falls back to the centre. */
export function findSpawnPoint(world, cfg, rng, actors) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * cfg.mapSize * 0.4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (positionClear(world, x, z, cfg.playerRadius, actors)) return { x, z };
  }
  return { x: 0, z: 0 };
}

/* ----------------------------------------------------------------- actors */

let nextId = 1;

export function makeActor({ x, z, isPlayer = false, rng = Math.random }) {
  return {
    id: nextId++,
    isPlayer,
    x, z,
    y: 0,
    yaw: isPlayer ? 0 : rng() * Math.PI * 2,
    health: 100,
    alive: true,
    verticalVelocity: 0,
    grounded: true,

    thinkTimer: rng() * 0.4,
    shotTimer: 0.4 + rng() * 1.1,
    strafeDirection: rng() < 0.5 ? -1 : 1,
    targetId: null,
    wanderAngle: rng() * Math.PI * 2,
    lastDamageAt: -99,
  };
}

/** Create the full match state: world, player, bots and loot. */
export function createMatch(cfg = CONFIG, seed = 1) {
  const rng = makeRng(seed);
  nextId = 1;

  const world = generateWorld(cfg, rng);
  const actors = [];

  const player = makeActor({ x: cfg.spawn.x, z: cfg.spawn.z, isPlayer: true, rng });
  actors.push(player);

  for (let i = 0; i < cfg.botCount; i++) {
    let point = findSpawnPoint(world, cfg, rng, actors);
    for (let attempt = 0; attempt < 40 &&
         Math.hypot(point.x - player.x, point.z - player.z) < cfg.minPlayerSpawnDistance;
         attempt++) {
      point = findSpawnPoint(world, cfg, rng, actors);
    }
    actors.push(makeActor({ x: point.x, z: point.z, rng }));
  }

  const loot = [];
  for (let i = 0; i < cfg.lootCount; i++) {
    const point = findSpawnPoint(world, cfg, rng, actors);
    loot.push({
      id: i + 1,
      x: point.x,
      z: point.z,
      y: 0.5,
      medical: i % 3 === 0,
      taken: false,
    });
  }

  return {
    cfg,
    seed,
    rng,
    world,
    actors,
    loot,
    time: 0,
    finished: false,
    result: null,

    player: {
      ammo: cfg.magazineSize,
      reserve: cfg.startAmmoReserve,
      medkits: cfg.startMedkits,
      kills: 0,
      reloading: 0,
      nextShotAt: 0,
      damageFlash: 0,
      lastHitHeadshot: false,
      firedThisFrame: false,
    },

    events: [],
  };
}

export function aliveBots(state) {
  return state.actors.filter((a) => a.alive && !a.isPlayer);
}

export function aliveCount(state) {
  return state.actors.reduce((n, a) => n + (a.alive ? 1 : 0), 0);
}

export function getActor(state, id) {
  return state.actors.find((a) => a.id === id) || null;
}

/* ------------------------------------------------------------------- zone */

export function currentZoneRadius(state) {
  return zoneRadiusAt(state.time, state.cfg.matchDuration, state.cfg.mapSize);
}

/** 0..1 progress of the match clock, for HUD bars. */
export function matchProgress(state) {
  return clamp01(state.time / Math.max(1, state.cfg.matchDuration));
}

/* ------------------------------------------------------------------ input */

export function defaultInput() {
  return {
    moveX: 0,
    moveZ: 0,
    lookDeltaX: 0,
    lookDeltaY: 0,
    firing: false,
    jump: false,
    reload: false,
    heal: false,
    restart: false,
  };
}

/* ----------------------------------------------------------------- combat */

/**
 * Hitscan along a ray on the ground plane plus vertical falloff. Actors are
 * vertical capsules; cover blocks the shot when it is tall enough.
 *
 * Returns { kind, x, z, distance, actorId } where kind is
 * 'actor' | 'cover' | 'miss'.
 */
export function traceShot(state, fromX, fromY, fromZ, dirX, dirY, dirZ, shooterId, range) {
  let best = { kind: 'miss', t: Infinity, x: 0, y: 0, z: 0, actorId: null };

  const len = Math.hypot(dirX, dirY, dirZ) || 1;
  const nx = dirX / len, ny = dirY / len, nz = dirZ / len;

  for (const obstacle of state.world.obstacles) {
    const t = segmentHitsBox(
      fromX, fromZ, fromX + nx * range, fromZ + nz * range,
      obstacle.x, obstacle.z, obstacle.hx, obstacle.hz,
    );
    if (t >= 1) continue;

    const hx = fromX + nx * range * t;
    const hz = fromZ + nz * range * t;
    const hy = fromY + ny * range * t;

    // Low cover only blocks shots that are actually below its top.
    if (hy <= obstacle.height && t * range < best.t) {
      best = { kind: 'cover', t: t * range, x: hx, y: hy, z: hz, actorId: null };
    }
  }

  for (const actor of state.actors) {
    if (!actor.alive) continue;
    if (actor.id === shooterId) continue;

    // Cheap reject on the ground plane.
    const relX = actor.x - fromX;
    const relZ = actor.z - fromZ;
    const horizontal = relX * nx + relZ * nz;
    if (horizontal < 0 || horizontal > best.t) continue;

    const closestX = fromX + nx * horizontal;
    const closestZ = fromZ + nz * horizontal;
    const lateral = Math.hypot(actor.x - closestX, actor.z - closestZ);
    const radius = actor.isPlayer ? state.cfg.playerRadius : state.cfg.botRadius;
    if (lateral > radius * 1.35) continue;

    const yAt = fromY + ny * horizontal;
    const height = actor.isPlayer ? state.cfg.playerHeight : state.cfg.playerHeight;
    if (yAt < 0 || yAt > height) continue;

    if (horizontal < best.t) {
      best = {
        kind: 'actor', t: horizontal,
        x: closestX, y: yAt, z: closestZ, actorId: actor.id,
      };
    }
  }

  return best;
}

/** Aim direction from yaw/pitch (radians) in the project's convention. */
export function aimDirection(yaw, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: cp * Math.sin(yaw) * -1 + 0 * cp,
    y: Math.sin(pitch),
    z: cp * Math.cos(yaw) * -1,
  };
}

/**
 * Resolves one player shot. Applies damage, ammo, tracer and kill rewards.
 * `yaw`/`pitch` are radians; the caller passes its current camera angles.
 */
export function firePlayerShot(state, yaw, pitch) {
  const cfg = state.cfg;
  const p = state.player;
  const player = findPlayer(state);
  if (!player.alive || p.reloading > 0) return null;
  if (state.time < p.nextShotAt) return null;
  if (p.ammo <= 0) {
    if (cfg.reloadOnEmpty) return null;
    return null;
  }

  p.nextShotAt = state.time + cfg.fireInterval;
  p.ammo -= 1;
  p.firedThisFrame = true;

  const dir = aimDirection(yaw, pitch);
  const ox = player.x;
  const oy = cfg.playerEyeHeight;
  const oz = player.z;

  const hit = traceShot(state, ox, oy, oz, dir.x, dir.y, dir.z, player.id, cfg.weaponRange);

  const shot = {
    from: { x: ox, y: oy, z: oz },
    to: {
      x: ox + dir.x * (hit.kind === 'miss' ? cfg.weaponRange : hit.t),
      y: oy + dir.y * (hit.kind === 'miss' ? cfg.weaponRange : hit.t),
      z: oz + dir.z * (hit.kind === 'miss' ? cfg.weaponRange : hit.t),
    },
    kind: hit.kind,
    victimId: null,
    damage: 0,
    headshot: false,
  };

  if (hit.kind === 'actor') {
    const victim = getActor(state, hit.actorId);
    if (victim && victim.id !== player.id) {
      const headshot = hit.y - victim.y > 1.5;
      const damage = headshot ? cfg.headshotDamage : cfg.bodyDamage;
      shot.victimId = victim.id;
      shot.damage = damage;
      shot.headshot = headshot;
      damageActor(state, victim, damage, player, state.time);
    }
  }

  state.events.push({ type: 'shot', shot });
  return shot;
}

/** Applies damage, handles death and the kill reward. */
export function damageActor(state, victim, amount, attacker, now = state.time) {
  if (!victim.alive) return;

  victim.health = Math.max(0, victim.health - amount);
  victim.lastDamageAt = now;
  if (victim.isPlayer) state.player.damageFlash = 0.18;

  if (victim.health > 0) return;

  victim.alive = false;
  victim.health = 0;
  state.events.push({ type: 'death', actorId: victim.id, byId: attacker ? attacker.id : null });

  if (attacker && attacker.isPlayer && !victim.isPlayer) {
    state.player.kills += 1;
    state.player.reserve += state.cfg.killAmmoBonus;
  }
}

/* -------------------------------------------------------------- movement */

/**
 * Moves an actor along (dx,dz) and resolves every obstacle it would enter.
 * Returns true when a collision was resolved.
 */
export function moveActor(state, actor, dx, dz) {
  const cfg = state.cfg;
  const radius = actor.isPlayer ? cfg.playerRadius : cfg.botRadius;

  let x = actor.x + dx;
  let z = actor.z + dz;

  // Two relaxation passes: pushing out of one box can push into another.
  for (let pass = 0; pass < 2; pass++) {
    for (const o of state.world.obstacles) {
      const res = pushOutOfBox(x, z, radius, o.x, o.z, o.hx, o.hz);
      if (res.hit) { x = res.x; z = res.z; }
    }
    for (const other of state.actors) {
      if (!other.alive || other === actor) continue;
      const res = pushOutOfCircle(x, z, radius, other.x, other.z,
        other.isPlayer ? cfg.playerRadius : cfg.botRadius);
      if (res.hit) { x = res.x; z = res.z; }
    }
  }

  const limit = cfg.mapSize * 0.5 - 1;
  x = clamp(x, -limit, limit);
  z = clamp(z, -limit, limit);

  actor.x = x;
  actor.z = z;
}

/** Vertical motion: gravity + jump, ground at y = 0. */
export function applyVertical(state, actor, jumpRequested, dt) {
  const cfg = state.cfg;
  actor.grounded = actor.y <= 0.0001;

  if (actor.grounded) {
    if (actor.verticalVelocity < 0) actor.verticalVelocity = 0;
    if (jumpRequested) {
      actor.verticalVelocity = cfg.jumpVelocity;
      actor.y = 0.001;
      actor.grounded = false;
    }
  }

  actor.verticalVelocity -= cfg.gravity * dt;
  actor.y += actor.verticalVelocity * dt;

  if (actor.y <= 0) {
    actor.y = 0;
    actor.verticalVelocity = 0;
    actor.grounded = true;
  }
}

/* ------------------------------------------------------------------- bots */

/**
 * One bot tick. Behaviour mirrors the Unity version: acquire the nearest
 * target within sight, advance to ~18 m, strafe when close, run for the zone
 * when it is outside, steer around obstacles, then shoot.
 */
export function updateBot(state, bot, dt) {
  const cfg = state.cfg;
  bot.thinkTimer -= dt;
  bot.shotTimer -= dt;

  if (bot.thinkTimer <= 0) {
    bot.thinkTimer = 0.35 + state.rng() * 0.3;
    let nearest = cfg.botSightRange;
    let target = null;

    for (const candidate of state.actors) {
      if (!candidate.alive || candidate.id === bot.id) continue;
      const distance = Math.hypot(candidate.x - bot.x, candidate.z - bot.z);
      if (distance < nearest) {
        nearest = distance;
        target = candidate;
      }
    }
    bot.targetId = target ? target.id : null;
    if (state.rng() < 0.18) bot.strafeDirection *= -1;
  }

  const radius = currentZoneRadius(state);
  const fromCentre = centreDistance(bot.x, bot.z);
  const needsZone = fromCentre > radius - 5;
  const target = bot.targetId != null ? getActor(state, bot.targetId) : null;

  let moveX = 0;
  let moveZ = 0;
  let faceX = Math.sin(bot.yaw) * -1;
  let faceZ = Math.cos(bot.yaw) * -1;

  if (needsZone) {
    const d = fromCentre || 1;
    moveX = -bot.x / d;
    moveZ = -bot.z / d;
    faceX = moveX;
    faceZ = moveZ;
  }

  if (target && target.alive) {
    const toX = target.x - bot.x;
    const toZ = target.z - bot.z;
    const distance = Math.hypot(toX, toZ) || 0.0001;
    const dirX = toX / distance;
    const dirZ = toZ / distance;
    faceX = dirX;
    faceZ = dirZ;

    if (!needsZone) {
      if (distance > 18) {
        moveX = dirX;
        moveZ = dirZ;
      } else {
        // Strafe perpendicular to the target.
        moveX = -dirZ * bot.strafeDirection * 0.65;
        moveZ = dirX * bot.strafeDirection * 0.65;
      }
    }

    if (distance < cfg.botFireRange && bot.shotTimer <= 0) {
      bot.shotTimer = 0.5 + state.rng() * 0.55;
      botFire(state, bot, target);
    }
  } else if (!needsZone) {
    bot.wanderAngle += dt * 0.6;
    moveX = Math.sin(bot.wanderAngle) * 0.5;
    moveZ = Math.cos(bot.wanderAngle) * 0.5;
    faceX = moveX;
    faceZ = moveZ;
  }

  // Obstacle steering: if the path ahead is blocked, rotate the move vector.
  const moveLen = Math.hypot(moveX, moveZ);
  if (moveLen > 0.01) {
    const probe = 1.8;
    const px = bot.x + (moveX / moveLen) * probe;
    const pz = bot.z + (moveZ / moveLen) * probe;
    for (const o of state.world.obstacles) {
      if (o.height < 0.9) continue;
      if (circleHitsBox(px, pz, cfg.botRadius, o.x, o.z, o.hx, o.hz)) {
        const a = bot.strafeDirection * 85 * Math.PI / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const rx = moveX * cos - moveZ * sin;
        const rz = moveX * sin + moveZ * cos;
        moveX = rx;
        moveZ = rz;
        break;
      }
    }
  }

  const speed = cfg.botSpeed;
  const len = Math.hypot(moveX, moveZ);
  const nx = len > 1 ? moveX / len : moveX;
  const nz = len > 1 ? moveZ / len : moveZ;
  moveActor(state, bot, nx * speed * dt, nz * speed * dt);

  const faceLen = Math.hypot(faceX, faceZ);
  if (faceLen > 0.001) {
    const desired = Math.atan2(faceX, faceZ);
    bot.yaw = approachAngle(bot.yaw, desired, dt * 8);
  }
}

function approachAngle(current, target, t) {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * clamp01(t);
}

/** One bot shot: line-of-sight check, accuracy roll, damage. */
export function botFire(state, bot, target) {
  const cfg = state.cfg;

  // Line of sight on the ground plane (cover blocks it).
  const bx = target.x;
  const bz = target.z;
  let blocked = false;
  for (const o of state.world.obstacles) {
    if (segmentHitsBox(bot.x, bot.z, bx, bz, o.x, o.z, o.hx, o.hz) < 1) {
      blocked = true;
      break;
    }
  }
  if (blocked) return null;

  const hitRoll = state.rng() < cfg.botAccuracy;
  const dir = Math.atan2(bx - bot.x, bz - bot.z);

  const shot = {
    from: { x: bot.x, y: 1.4, z: bot.z },
    to: { x: bx, y: 1.2, z: bz },
    kind: hitRoll ? 'actor' : 'miss',
    victimId: null,
    damage: 0,
    headshot: false,
  };

  if (hitRoll) {
    const [lo, hi] = cfg.botBodyDamage;
    const damage = lo + state.rng() * (hi - lo);
    shot.victimId = target.id;
    shot.damage = damage;
    damageActor(state, target, damage, bot, state.time);
  }

  state.events.push({ type: 'shot', shot, fromBot: bot.id, yaw: dir });
  return shot;
}

/* ------------------------------------------------------------------- loot */

export function updateLoot(state, player) {
  const cfg = state.cfg;

  for (const item of state.loot) {
    if (item.taken) continue;
    if (!player.alive) continue;

    const distance = Math.hypot(player.x - item.x, player.z - item.z);
    if (distance > cfg.lootPickupRadius) continue;

    item.taken = true;
    if (item.medical) {
      state.player.medkits += cfg.lootMedkit;
      state.events.push({ type: 'loot', medical: true, text: '+1 MEDKIT' });
    } else {
      state.player.reserve += cfg.lootAmmo;
      state.events.push({ type: 'loot', medical: false, text: '+60 AMMO' });
    }
  }
}

/* ------------------------------------------------------------------ player */

export function findPlayer(state) {
  return state.actors.find((a) => a.isPlayer);
}

/** Reload / heal requests from the player. */
export function playerReload(state) {
  const cfg = state.cfg;
  const p = state.player;
  const player = findPlayer(state);
  if (state.finished || !player.alive) return false;
  if (p.reloading > 0 || p.ammo >= cfg.magazineSize || p.reserve <= 0) return false;

  p.reloading = cfg.reloadDuration;
  state.events.push({ type: 'reload' });
  return true;
}

export function playerHeal(state) {
  const p = state.player;
  const player = findPlayer(state);
  if (state.finished || !player.alive || p.medkits <= 0 || player.health >= 100) return false;

  p.medkits -= 1;
  player.health = Math.min(100, player.health + 50);
  state.events.push({ type: 'heal' });
  return true;
}

/** Player movement + facing for one frame. */
export function updatePlayer(state, input, yaw, dt) {
  const cfg = state.cfg;
  const player = findPlayer(state);
  if (!player.alive) return;

  const len = Math.hypot(input.moveX, input.moveZ);
  const mx = len > 1 ? input.moveX / len : input.moveX;
  const mz = len > 1 ? input.moveZ / len : input.moveZ;

  // Move relative to where the camera is looking.
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const worldX = -sin * mz + cos * mx;
  const worldZ = -cos * mz - sin * mx;

  moveActor(state, player, worldX * cfg.movementSpeed * dt, worldZ * cfg.movementSpeed * dt);
  applyVertical(state, player, input.jump, dt);

  if (len > 0.01 || input.firing) {
    const desired = input.firing ? yaw : Math.atan2(worldX, worldZ);
    player.yaw = approachAngle(player.yaw, desired, clamp01(dt * 14));
  }
}

/** Damage everyone outside the circle. */
export function applyZoneDamage(state, dt) {
  const cfg = state.cfg;
  const radius = currentZoneRadius(state);
  const rate = state.time > cfg.matchDuration
    ? cfg.zoneLateDamagePerSecond
    : cfg.zoneDamagePerSecond;

  for (const actor of state.actors) {
    if (!actor.alive) continue;
    if (centreDistance(actor.x, actor.z) > radius) {
      damageActor(state, actor, rate * dt, null, state.time);
    }
  }
}

/* ------------------------------------------------------------------ frame */

/**
 * Advance the whole match by dt seconds.
 *
 * `input` is the struct from defaultInput(); `look` is { yaw, pitch } in
 * radians. Returns the list of events produced this frame.
 */
export function step(state, input, look, dt) {
  if (state.finished) {
    state.events = [];
    return state.events;
  }

  state.events = [];
  state.time += dt;

  const player = findPlayer(state);
  const p = state.player;
  p.firedThisFrame = false;

  // Reload timer.
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) {
      p.reloading = 0;
      const amount = Math.min(state.cfg.magazineSize - p.ammo, p.reserve);
      p.ammo += amount;
      p.reserve -= amount;
      state.events.push({ type: 'reloaded', ammo: p.ammo });
    }
  }

  // Requests.
  if (input.heal) playerHeal(state);
  if (input.reload) playerReload(state);

  updatePlayer(state, input, look.yaw, dt);

  if (input.firing) {
    const shot = firePlayerShot(state, look.yaw, look.pitch);
    if (!shot && p.ammo <= 0) playerReload(state);
  }

  for (const actor of state.actors) {
    if (!actor.alive || actor.isPlayer) continue;
    updateBot(state, actor, dt);
  }

  applyZoneDamage(state, dt);
  updateLoot(state, player);

  p.damageFlash = Math.max(0, p.damageFlash - dt);

  // Win / lose.
  const alive = aliveCount(state);
  if (!player.alive) {
    finish(state, 'ELIMINATED', `Position #${alive + 1}`);
  } else if (alive === 1) {
    finish(state, 'VICTORY!', 'You are the last survivor.');
  }

  return state.events;
}

export function finish(state, title, subtitle) {
  if (state.finished) return;
  state.finished = true;
  state.result = { title, subtitle };
  state.events.push({ type: 'finish', title, subtitle });
}

/** Fresh match that keeps the same seed (PLAY AGAIN). */
export function restart(state) {
  return createMatch(state.cfg, state.seed);
}

/* ------------------------------------------------------------------- HUD */

/** Everything the HUD needs, so the DOM layer does no game logic. */
export function hudModel(state) {
  const player = findPlayer(state);
  const p = state.player;

  return {
    alive: aliveCount(state),
    kills: p.kills,
    health: player.health,
    ammo: p.ammo,
    reserve: p.reserve,
    medkits: p.medkits,
    reloading: p.reloading > 0,
    reloadProgress: p.reloading > 0
      ? 1 - p.reloading / state.cfg.reloadDuration
      : 1,
    zoneRadius: currentZoneRadius(state),
    outsideZone: centreDistance(player.x, player.z) > currentZoneRadius(state),
    progress: matchProgress(state),
    damageFlash: p.damageFlash,
    finished: state.finished,
    result: state.result,
  };
}
