/* ==========================================================================
 * BRGame logic core v2 — pure, framework-free, deterministic.
 *
 * NOTHING in this file touches three.js, the DOM or the wall clock.
 * The renderer (main.js) calls step() with a frame delta; the tests call the
 * same functions with a fixed delta. That is why the whole game can be
 * verified headlessly.
 *
 * v2 adds: three weapons with distinct ballistics, armour with durability,
 * throwable grenades with radial falloff, damage direction indicators, kill
 * feed with weapon attribution, bot skill tiers, headshot/bodyshot audio
 * cues, match statistics and a spectator camera after death.
 * ========================================================================== */

/* --------------------------------------------------------------- weapons */

/**
 * Weapon table. `spread` is the max angular error in radians, `pellets` > 1
 * makes it a shotgun, `falloff` is the distance at which damage halves.
 */
export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'AR-7 RIFLE',
    magazine: 30,
    reserveMax: 210,
    fireInterval: 0.105,
    reloadDuration: 1.75,
    range: 140,
    pellets: 1,
    spread: 0.010,
    bodyDamage: 26,
    headDamage: 62,
    falloff: 55,
    falloffFloor: 0.45,
    auto: true,
    recoil: 0.011,
    moveSpeed: 1.0,
  },
  smg: {
    id: 'smg',
    name: 'VX-9 SMG',
    magazine: 36,
    reserveMax: 252,
    fireInterval: 0.062,
    reloadDuration: 1.45,
    range: 70,
    pellets: 1,
    spread: 0.028,
    bodyDamage: 13,
    headDamage: 30,
    falloff: 22,
    falloffFloor: 0.35,
    auto: true,
    recoil: 0.007,
    moveSpeed: 1.08,
  },
  shotgun: {
    id: 'shotgun',
    name: 'BRK-12',
    magazine: 6,
    reserveMax: 48,
    fireInterval: 0.72,
    reloadDuration: 2.5,
    range: 34,
    pellets: 9,
    spread: 0.085,
    bodyDamage: 11,
    headDamage: 17,
    falloff: 12,
    falloffFloor: 0.22,
    auto: false,
    recoil: 0.05,
    moveSpeed: 0.94,
  },
};

export const WEAPON_ORDER = ['rifle', 'smg', 'shotgun'];

/* ----------------------------------------------------------------- config */

export const CONFIG = {
  botCount: 15,
  mapSize: 160,
  matchDuration: 240,

  movementSpeed: 6,
  sprintMultiplier: 1.42,
  crouchMultiplier: 0.52,
  lookSensitivity: 0.13,

  playerRadius: 0.42,
  playerHeight: 1.85,
  playerEyeHeight: 1.35,

  botRadius: 0.42,
  botSpeed: 3.8,
  botSightRange: 48,
  botFireRange: 42,
  botBodyDamage: [7, 13],

  /** Skill tier per bot index: accuracy, reaction, damage scale. */
  botTiers: [
    { name: 'ROOKIE', accuracy: 0.44, damage: 0.8, think: 0.75 },
    { name: 'SOLDIER', accuracy: 0.60, damage: 1.0, think: 0.52 },
    { name: 'VETERAN', accuracy: 0.73, damage: 1.15, think: 0.38 },
    { name: 'ELITE', accuracy: 0.84, damage: 1.3, think: 0.28 },
  ],

  headshotDamage: 65,
  bodyDamage: 26,
  killAmmoBonus: 20,

  /** Armour absorbs this fraction of incoming body damage until it breaks. */
  armorAbsorb: 0.5,
  armorMax: 100,
  armorPickup: 50,
  armorHeadshotAbsorb: 0.25,

  grenadeMax: 3,
  grenadeDamage: 120,
  grenadeRadius: 7.5,
  grenadeFuse: 2.6,
  grenadeThrowSpeed: 17,
  grenadeGravity: 22,
  grenadePickup: 1,

  zoneDamagePerSecond: 7,
  zoneLateDamagePerSecond: 18,
  zoneFinalRadius: 4,

  gravity: 20,
  jumpVelocity: 7,

  startAmmoReserve: 150,
  startMedkits: 3,

  lootCount: 30,
  lootPickupRadius: 1.7,
  lootAmmo: 60,
  lootMedkit: 1,

  spawnClearance: 3,
  minPlayerSpawnDistance: 20,

  /** Seconds the camera stays on your body before the spectate prompt. */
  deathCamTime: 1.6,

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

/** Deterministic PRNG so a seed reproduces an entire match exactly. */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

export function rngRange(rng, lo, hi) {
  return lo + (hi - lo) * rng();
}

export function rngPick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

export function circlePoint(angle, radius = 1) {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

export function centreDistance(x, z) {
  return Math.hypot(x, z);
}

export function zoneRadiusAt(t, duration = CONFIG.matchDuration, mapSize = CONFIG.mapSize) {
  const from = mapSize * 0.46;
  const k = clamp01(t / Math.max(1, duration));
  return lerp(from, CONFIG.zoneFinalRadius, k);
}

export function isOutsideZone(x, z, radius) {
  return centreDistance(x, z) > radius;
}

/* ----------------------------------------------------------- collisions */

export function circleHitsCircle(x, z, radius, cx, cz, cr) {
  const r = radius + cr;
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

export function circleHitsBox(x, z, radius, bx, bz, hx, hz) {
  const dx = Math.abs(x - bx) - hx;
  const dz = Math.abs(z - bz) - hz;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  return outside < radius;
}

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

export function pushOutOfBox(x, z, radius, bx, bz, hx, hz) {
  const dx = x - bx;
  const dz = z - bz;
  const px = hx + radius - Math.abs(dx);
  const pz = hz + radius - Math.abs(dz);
  if (px <= 0 || pz <= 0) return { x, z, hit: false };
  if (px < pz) return { x: bx + Math.sign(dx || 1) * (hx + radius), z, hit: true };
  return { x, z: bz + Math.sign(dz || 1) * (hz + radius), hit: true };
}

/** Slab test: entry fraction (0..1) of segment (ax,az)->(bx,bz) into a box. */
export function segmentHitsBox(ax, az, bx, bz, cx, cz, hx, hz) {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;

  const minX = cx - hx, maxX = cx + hx;
  const minZ = cz - hz, maxZ = cz + hz;

  for (const [, lo, hi, d, origin] of [
    ['x', minX, maxX, dx, ax],
    ['z', minZ, maxZ, dz, az],
  ]) {
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

      buildings.push({ kind: 'building', x: px, z: pz, hx: width / 2, hz: depth / 2, height, width, depth });

      for (let w = -1; w <= 1; w++) {
        windows.push({ x: px + w * 2, y: 2.8, z: pz - depth / 2 - 0.03, w: 1.1, h: 1.2 });
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
    obstacles.push({ kind: 'cover', x: px, z: pz, hx: size / 2, hz: size / 2, height: 1.3 });
  }

  return { buildings, windows, obstacles, mapSize: cfg.mapSize };
}

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

export function makeActor({ x, z, isPlayer = false, rng = Math.random, tierIndex = 0 }) {
  const tier = CONFIG.botTiers[clamp(tierIndex, 0, CONFIG.botTiers.length - 1)];
  return {
    id: nextId++,
    isPlayer,
    x, z,
    y: 0,
    yaw: isPlayer ? 0 : rng() * Math.PI * 2,
    health: 100,
    armor: isPlayer ? 0 : Math.round(tierIndex * 12),
    alive: true,
    verticalVelocity: 0,
    grounded: true,
    sprinting: false,
    crouching: false,

    weapon: isPlayer ? 'rifle' : (rngPick(rng, WEAPON_ORDER)),
    ammo: isPlayer ? WEAPONS.rifle.magazine : WEAPONS[rngPick(rng, WEAPON_ORDER)].magazine,

    thinkTimer: rng() * 0.4,
    shotTimer: 0.4 + rng() * 1.1,
    strafeDirection: rng() < 0.5 ? -1 : 1,
    targetId: null,
    wanderAngle: rng() * Math.PI * 2,
    lastDamageAt: -99,
    lastAttackerId: null,
    lastDamageAngle: 0,
    killStreak: 0,

    tier,
    accuracy: tier.accuracy,
    damageScale: tier.damage,
  };
}

export function createMatch(cfg = CONFIG, seed = 1, opts = {}) {
  const rng = makeRng(seed);
  nextId = 1;

  const world = generateWorld(cfg, rng);
  const actors = [];

  const player = makeActor({ x: cfg.spawn.x, z: cfg.spawn.z, isPlayer: true, rng });
  player.armor = opts.playerArmor ?? 50;
  actors.push(player);

  const tiers = [];
  for (let i = 0; i < cfg.botCount; i++) {
    let point = findSpawnPoint(world, cfg, rng, actors);
    for (let attempt = 0; attempt < 40 &&
         Math.hypot(point.x - player.x, point.z - player.z) < cfg.minPlayerSpawnDistance;
         attempt++) {
      point = findSpawnPoint(world, cfg, rng, actors);
    }

    // Later bots are tougher: the first third are rookies, the last are elites.
    const t = Math.floor((i / cfg.botCount) * cfg.botTiers.length);
    tiers.push(t);
    actors.push(makeActor({ x: point.x, z: point.z, rng, tierIndex: t }));
  }

  const loot = [];
  for (let i = 0; i < cfg.lootCount; i++) {
    const point = findSpawnPoint(world, cfg, rng, actors);
    const kind = i % 5 === 0 ? 'grenade' : i % 3 === 0 ? 'medical' : i % 7 === 0 ? 'armor' : 'ammo';
    loot.push({
      id: i + 1,
      x: point.x,
      z: point.z,
      y: 0.5,
      kind,
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
    grenades: [],

    time: 0,
    finished: false,
    result: null,

    player: {
      ammo: WEAPONS.rifle.magazine,
      reserve: cfg.startAmmoReserve,
      medkits: cfg.startMedkits,
      grenades: 2,
      kills: 0,
      reloading: 0,
      nextShotAt: 0,
      damageFlash: 0,
      firedThisFrame: false,
      killFeed: [],
      damageIndicators: [],
      deathTime: null,
      stats: { shots: 0, hits: 0, headshots: 0, damageDealt: 0, grenadeKills: 0 },
      spectating: null,
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

export function currentZoneRadius(state) {
  return zoneRadiusAt(state.time, state.cfg.matchDuration, state.cfg.mapSize);
}

export function matchProgress(state) {
  return clamp01(state.time / Math.max(1, state.cfg.matchDuration));
}

/* ------------------------------------------------------------------ input */

export function defaultInput() {
  return {
    moveX: 0,
    moveZ: 0,
    firing: false,
    jump: false,
    reload: false,
    heal: false,
    restart: false,
    sprint: false,
    crouch: false,
    grenade: false,
    switchWeapon: null,
  };
}

/* ---------------------------------------------------------------- weapons */

export function weaponOf(actor) {
  return WEAPONS[actor.weapon] || WEAPONS.rifle;
}

export function weaponById(id) {
  return WEAPONS[id] || WEAPONS.rifle;
}

/** Damage after distance falloff: full damage inside `falloff`, then a floor. */
export function falloffScale(weapon, distance) {
  if (distance <= weapon.falloff) return 1;
  const over = distance - weapon.falloff;
  const span = Math.max(1, weapon.range - weapon.falloff);
  return Math.max(weapon.falloffFloor, 1 - (over / span) * (1 - weapon.falloffFloor));
}

/** Cycle to the next weapon. Returns the new weapon id. */
export function switchWeapon(state, direction = 1) {
  const player = findPlayer(state);
  const index = WEAPON_ORDER.indexOf(player.weapon);
  const next = WEAPON_ORDER[(index + direction + WEAPON_ORDER.length) % WEAPON_ORDER.length];
  player.weapon = next;
  player.ammo = 0;
  state.player.ammo = 0;
  state.player.reloading = 0;
  state.player.nextShotAt = state.time + 0.35;
  state.events.push({ type: 'weapon', weapon: next, name: WEAPONS[next].name });
  return next;
}

/* ------------------------------------------------------------------ combat */

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

    if (hy <= obstacle.height && t * range < best.t) {
      best = { kind: 'cover', t: t * range, x: hx, y: hy, z: hz, actorId: null };
    }
  }

  for (const actor of state.actors) {
    if (!actor.alive) continue;
    if (actor.id === shooterId) continue;

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
    if (yAt < 0 || yAt > state.cfg.playerHeight) continue;

    if (horizontal < best.t) {
      best = { kind: 'actor', t: horizontal, x: closestX, y: yAt, z: closestZ, actorId: actor.id };
    }
  }

  return best;
}

export function aimDirection(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -cp * Math.sin(yaw), y: Math.sin(pitch), z: -cp * Math.cos(yaw) };
}

/**
 * Resolve one trigger pull for the player.
 * Returns the shot record (possibly several pellets for the shotgun).
 */
export function firePlayerShot(state, yaw, pitch) {
  const cfg = state.cfg;
  const p = state.player;
  const player = findPlayer(state);
  const weapon = weaponOf(player);

  if (!player.alive || p.reloading > 0) return null;
  if (state.time < p.nextShotAt) return null;
  if (p.ammo <= 0) return null;

  p.nextShotAt = state.time + weapon.fireInterval;
  p.ammo -= 1;
  p.firedThisFrame = true;
  p.stats.shots += 1;

  const originX = player.x;
  const originY = cfg.playerEyeHeight - (player.crouching ? 0.35 : 0);
  const originZ = player.z;
  const base = aimDirection(yaw, pitch);

  const pellets = [];
  for (let i = 0; i < weapon.pellets; i++) {
    const jitter = () => (state.rng() - 0.5) * 2 * weapon.spread;
    const dirX = base.x + jitter();
    const dirY = base.y + jitter();
    const dirZ = base.z + jitter();
    const len = Math.hypot(dirX, dirY, dirZ) || 1;

    const hit = traceShot(
      state, originX, originY, originZ,
      dirX / len, dirY / len, dirZ / len,
      player.id, weapon.range,
    );

    const travel = hit.kind === 'miss' ? weapon.range : hit.t;
    const shot = {
      from: { x: originX, y: originY, z: originZ },
      to: {
        x: originX + (dirX / len) * travel,
        y: originY + (dirY / len) * travel,
        z: originZ + (dirZ / len) * travel,
      },
      kind: hit.kind,
      victimId: null,
      damage: 0,
      headshot: false,
      weapon: weapon.id,
    };

    if (hit.kind === 'actor') {
      const victim = getActor(state, hit.actorId);
      if (victim && victim.id !== player.id) {
        const headshot = hit.y - victim.y > 1.5;
        const baseDamage = headshot ? weapon.headDamage : weapon.bodyDamage;
        const damage = baseDamage * falloffScale(weapon, hit.t);
        shot.victimId = victim.id;
        shot.damage = damage;
        shot.headshot = headshot;
        p.stats.hits += 1;
        if (headshot) p.stats.headshots += 1;
        p.stats.damageDealt += applyDamage(state, victim, damage, player, state.time, weapon.id, headshot);
      }
    }

    pellets.push(shot);
  }

  // Recoil kicks the camera up, more for heavy weapons.
  state.events.push({ type: 'shot', shots: pellets, weapon: weapon.id, recoil: weapon.recoil });
  return pellets;
}

/**
 * Apply damage with armour absorption.
 * Returns the amount actually removed from health.
 */
export function applyDamage(state, victim, amount, attacker, now = state.time, weaponId = null, headshot = false) {
  if (!victim.alive) return 0;

  let remaining = amount;

  if (victim.armor > 0) {
    const absorb = headshot ? state.cfg.armorHeadshotAbsorb : state.cfg.armorAbsorb;
    const blocked = Math.min(victim.armor, remaining * absorb);
    victim.armor = Math.max(0, victim.armor - blocked);
    remaining -= blocked;
  }

  const before = victim.health;
  victim.health = Math.max(0, victim.health - remaining);
  const applied = before - victim.health;

  victim.lastDamageAt = now;
  victim.lastAttackerId = attacker ? attacker.id : null;

  if (attacker) {
    const angle = Math.atan2(attacker.x - victim.x, attacker.z - victim.z);
    victim.lastDamageAngle = angle;
  }

  if (victim.isPlayer && attacker) {
    state.player.damageFlash = Math.min(0.42, state.player.damageFlash + 0.2);
    state.player.damageIndicators.push({
      angle: victim.lastDamageAngle,
      health: 0.9,
    });
  }

  if (victim.health > 0) return applied;

  victim.alive = false;
  victim.health = 0;
  victim.deathTime = now;

  state.events.push({
    type: 'death',
    actorId: victim.id,
    byId: attacker ? attacker.id : null,
    weapon: weaponId,
    headshot,
  });

  if (victim.isPlayer) {
    state.player.deathTime = now;
  }

  if (attacker) {
    attacker.killStreak = (attacker.killStreak || 0) + 1;
    if (attacker.isPlayer && !victim.isPlayer) {
      state.player.kills += 1;
      state.player.reserve = Math.min(
        weaponOf(attacker).reserveMax,
        state.player.reserve + state.cfg.killAmmoBonus,
      );
      state.player.killFeed.unshift({
        killer: 'YOU',
        victim: `BOT ${victim.id}`,
        weapon: weaponId || 'rifle',
        headshot,
        t: now,
      });
      state.player.killFeed = state.player.killFeed.slice(0, 5);
    }
  }

  return applied;
}

/* --------------------------------------------------------------- grenades */

/**
 * Throw a grenade. It becomes a physics projectile with a fuse; on expiry it
 * explodes with radial falloff through line-of-sight.
 */
export function throwGrenade(state, yaw, pitch) {
  const player = findPlayer(state);
  if (!player.alive || state.player.grenades <= 0) return null;

  state.player.grenades -= 1;
  const dir = aimDirection(yaw, pitch);
  const cfg = state.cfg;

  const grenade = {
    id: state.grenades.length + 1,
    x: player.x,
    y: cfg.playerEyeHeight,
    z: player.z,
    vx: dir.x * cfg.grenadeThrowSpeed,
    vy: dir.y * cfg.grenadeThrowSpeed + 4.2,
    vz: dir.z * cfg.grenadeThrowSpeed,
    fuse: cfg.grenadeFuse,
    ownerId: player.id,
    exploded: false,
  };

  state.grenades.push(grenade);
  state.events.push({ type: 'throw', grenade });
  return grenade;
}

/** Integrate grenades, bounce them off cover and detonate on fuse expiry. */
export function updateGrenades(state, dt) {
  const cfg = state.cfg;

  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    if (g.exploded) {
      state.grenades.splice(i, 1);
      continue;
    }

    g.vy -= cfg.grenadeGravity * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;

    if (g.y <= 0.1) {
      g.y = 0.1;
      g.vy = Math.abs(g.vy) * 0.34;
      g.vx *= 0.68;
      g.vz *= 0.68;
    }

    for (const o of state.world.obstacles) {
      if (g.y > o.height) continue;
      const res = pushOutOfBox(g.x, g.z, 0.16, o.x, o.z, o.hx, o.hz);
      if (res.hit) {
        const nx = Math.sign(g.x - o.x) || 1;
        const nz = Math.sign(g.z - o.z) || 1;
        g.x = res.x;
        g.z = res.z;
        if (Math.abs(g.x - res.x) > 1e-6) g.vx = -g.vx * 0.4;
        if (Math.abs(g.z - res.z) > 1e-6) g.vz = -g.vz * 0.4;
        void nx; void nz;
      }
    }

    g.fuse -= dt;
    if (g.fuse <= 0) {
      explodeGrenade(state, g);
      g.exploded = true;
      state.grenades.splice(i, 1);
    }
  }
}

export function explodeGrenade(state, g) {
  const cfg = state.cfg;
  const owner = getActor(state, g.ownerId);
  const hits = [];

  for (const actor of state.actors) {
    if (!actor.alive) continue;

    const distance = Math.hypot(actor.x - g.x, actor.z - g.z);
    if (distance > cfg.grenadeRadius) continue;

    // Cover between the blast and the target cuts the damage in half.
    let shielded = false;
    for (const o of state.world.obstacles) {
      if (segmentHitsBox(g.x, g.z, actor.x, actor.z, o.x, o.z, o.hx, o.hz) < 1) {
        shielded = true;
        break;
      }
    }

    const falloff = 1 - clamp01(distance / cfg.grenadeRadius);
    let damage = cfg.grenadeDamage * Math.pow(falloff, 1.35);
    if (shielded) damage *= 0.5;
    if (distance < 1e-3) damage = cfg.grenadeDamage;

    const attacker = owner && owner.id !== actor.id ? owner : null;
    const applied = applyDamage(state, actor, damage, attacker, state.time, 'grenade', false);
    if (attacker && attacker.isPlayer && !actor.alive) {
      state.player.stats.grenadeKills += 1;
    }
    hits.push({ actorId: actor.id, damage: applied, distance });
  }

  state.events.push({
    type: 'explosion',
    x: g.x, y: g.y, z: g.z,
    radius: cfg.grenadeRadius,
    hits,
  });

  return hits;
}

/* -------------------------------------------------------------- movement */

export function moveActor(state, actor, dx, dz) {
  const cfg = state.cfg;
  const radius = actor.isPlayer ? cfg.playerRadius : cfg.botRadius;

  let x = actor.x + dx;
  let z = actor.z + dz;

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

export function updateBot(state, bot, dt) {
  const cfg = state.cfg;
  bot.thinkTimer -= dt;
  bot.shotTimer -= dt;

  const thinkSpeed = bot.tier ? bot.tier.think : 0.5;

  if (bot.thinkTimer <= 0) {
    bot.thinkTimer = thinkSpeed + state.rng() * 0.18;
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
  let faceX = -Math.sin(bot.yaw);
  let faceZ = -Math.cos(bot.yaw);

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

  const speed = cfg.botSpeed * (bot.sprinting ? 1.25 : 1);
  const len = Math.hypot(moveX, moveZ);
  const nx = len > 1 ? moveX / len : moveX;
  const nz = len > 1 ? moveZ / len : moveZ;
  moveActor(state, bot, nx * speed * dt, nz * speed * dt);

  const faceLen = Math.hypot(faceX, faceZ);
  if (faceLen > 0.001) {
    const desired = Math.atan2(-faceX, -faceZ);
    bot.yaw = approachAngle(bot.yaw, desired, dt * 8);
  }
}

function approachAngle(current, target, t) {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * clamp01(t);
}

export function botFire(state, bot, target) {
  const cfg = state.cfg;

  const bx = target.x;
  const bz = target.z;
  for (const o of state.world.obstacles) {
    if (segmentHitsBox(bot.x, bot.z, bx, bz, o.x, o.z, o.hx, o.hz) < 1) return null;
  }

  const accuracy = bot.accuracy ?? cfg.botTiers[1].accuracy;
  const hitRoll = state.rng() < accuracy;
  const yaw = Math.atan2(-(bx - bot.x), -(bz - bot.z));

  const shot = {
    from: { x: bot.x, y: 1.4, z: bot.z },
    to: { x: bx, y: 1.2, z: bz },
    kind: hitRoll ? 'actor' : 'miss',
    victimId: null,
    damage: 0,
    headshot: false,
    weapon: bot.weapon,
  };

  if (hitRoll) {
    const [lo, hi] = cfg.botBodyDamage;
    const scale = bot.damageScale ?? 1;
    const headshot = state.rng() < 0.14;
    const raw = (lo + state.rng() * (hi - lo)) * scale * (headshot ? 2.1 : 1);
    shot.victimId = target.id;
    shot.damage = raw;
    shot.headshot = headshot;
    applyDamage(state, target, raw, bot, state.time, bot.weapon, headshot);
  }

  state.events.push({ type: 'shot', shots: [shot], fromBot: bot.id, yaw });
  return shot;
}

/* ------------------------------------------------------------------- loot */

export function updateLoot(state, player) {
  const cfg = state.cfg;

  for (const item of state.loot) {
    if (item.taken) continue;
    if (!player.alive) continue;
    if (Math.hypot(player.x - item.x, player.z - item.z) > cfg.lootPickupRadius) continue;

    item.taken = true;

    if (item.kind === 'medical') {
      state.player.medkits += cfg.lootMedkit;
      state.events.push({ type: 'loot', kind: 'medical', text: '+1 MEDKIT' });
    } else if (item.kind === 'armor') {
      player.armor = Math.min(cfg.armorMax, player.armor + cfg.armorPickup);
      state.events.push({ type: 'loot', kind: 'armor', text: `+${cfg.armorPickup} ARMOR` });
    } else if (item.kind === 'grenade') {
      state.player.grenades = Math.min(cfg.grenadeMax, state.player.grenades + cfg.grenadePickup);
      state.events.push({ type: 'loot', kind: 'grenade', text: '+1 GRENADE' });
    } else {
      state.player.reserve = Math.min(
        weaponOf(player).reserveMax,
        state.player.reserve + cfg.lootAmmo,
      );
      state.events.push({ type: 'loot', kind: 'ammo', text: `+${cfg.lootAmmo} AMMO` });
    }
  }
}

/* ---------------------------------------------------------------- player */

export function findPlayer(state) {
  return state.actors.find((a) => a.isPlayer);
}

export function playerReload(state) {
  const p = state.player;
  const player = findPlayer(state);
  const weapon = weaponOf(player);

  if (state.finished || !player.alive) return false;
  if (p.reloading > 0 || p.ammo >= weapon.magazine || p.reserve <= 0) return false;

  p.reloading = weapon.reloadDuration;
  state.events.push({ type: 'reload', duration: weapon.reloadDuration });
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

export function updatePlayer(state, input, yaw, dt) {
  const cfg = state.cfg;
  const player = findPlayer(state);
  if (!player.alive) return;

  player.sprinting = !!input.sprint && Math.hypot(input.moveX, input.moveZ) > 0.1;
  player.crouching = !!input.crouch;

  let speed = cfg.movementSpeed * weaponOf(player).moveSpeed;
  if (player.sprinting) speed *= cfg.sprintMultiplier;
  if (player.crouching) speed *= cfg.crouchMultiplier;

  const len = Math.hypot(input.moveX, input.moveZ);
  const mx = len > 1 ? input.moveX / len : input.moveX;
  const mz = len > 1 ? input.moveZ / len : input.moveZ;

  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const worldX = -sin * mz + cos * mx;
  const worldZ = -cos * mz - sin * mx;

  moveActor(state, player, worldX * speed * dt, worldZ * speed * dt);
  applyVertical(state, player, input.jump, dt);

  if (len > 0.01 || input.firing) {
    const desired = input.firing ? yaw : Math.atan2(-worldX, -worldZ);
    player.yaw = approachAngle(player.yaw, desired, clamp01(dt * 14));
  }
}

export function applyZoneDamage(state, dt) {
  const cfg = state.cfg;
  const radius = currentZoneRadius(state);
  const rate = state.time > cfg.matchDuration
    ? cfg.zoneLateDamagePerSecond
    : cfg.zoneDamagePerSecond;

  for (const actor of state.actors) {
    if (!actor.alive) continue;
    if (centreDistance(actor.x, actor.z) > radius) {
      applyDamage(state, actor, rate * dt, null, state.time, 'zone', false);
    }
  }
}

/* ------------------------------------------------------------- spectator */

/** After death the camera can follow a surviving bot. */
export function spectate(state, direction = 1) {
  const bots = aliveBots(state);
  if (!bots.length) return null;

  const current = state.player.spectating;
  const index = current == null ? -1 : bots.findIndex((b) => b.id === current);
  const next = bots[(index + direction + bots.length + 1) % bots.length];
  state.player.spectating = next.id;
  return next.id;
}

/* ------------------------------------------------------------------ frame */

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
      const weapon = weaponOf(player);
      const amount = Math.min(weapon.magazine - p.ammo, p.reserve);
      p.ammo += amount;
      p.reserve -= amount;
      state.events.push({ type: 'reloaded', ammo: p.ammo });
    }
  }

  if (input.switchWeapon) switchWeapon(state, input.switchWeapon);
  if (input.heal) playerHeal(state);
  if (input.reload) playerReload(state);
  if (input.grenade && player.alive) throwGrenade(state, look.yaw, look.pitch);

  updatePlayer(state, input, look.yaw, dt);

  if (input.firing) {
    const shots = firePlayerShot(state, look.yaw, look.pitch);
    if (!shots && p.ammo <= 0) playerReload(state);
  }

  for (const actor of state.actors) {
    if (!actor.alive || actor.isPlayer) continue;
    updateBot(state, actor, dt);
  }

  updateGrenades(state, dt);
  applyZoneDamage(state, dt);
  updateLoot(state, player);

  p.damageFlash = Math.max(0, p.damageFlash - dt);
  for (let i = p.damageIndicators.length - 1; i >= 0; i--) {
    p.damageIndicators[i].health -= dt * 1.6;
    if (p.damageIndicators[i].health <= 0) p.damageIndicators.splice(i, 1);
  }
  for (let i = p.killFeed.length - 1; i >= 0; i--) {
    if (state.time - p.killFeed[i].t > 6) p.killFeed.splice(i, 1);
  }

  const alive = aliveCount(state);

  if (!player.alive) {
    // Give the death camera a beat, then allow spectating.
    if (p.deathTime != null && state.time - p.deathTime > state.cfg.deathCamTime) {
      if (p.spectating == null && alive > 1) spectate(state, 1);
    }
    if (alive <= 1) finish(state, 'ELIMINATED', `Position #${alive + 1}`);
  } else if (alive === 1) {
    finish(state, 'VICTORY!', 'You are the last survivor.');
  }

  return state.events;
}

export function finish(state, title, subtitle) {
  if (state.finished) return;
  state.finished = true;

  const p = state.player;
  const accuracy = p.stats.shots > 0 ? p.stats.hits / p.stats.shots : 0;

  state.result = {
    title,
    subtitle,
    kills: p.kills,
    survived: Math.round(state.time),
    accuracy,
    headshots: p.stats.headshots,
    damageDealt: Math.round(p.stats.damageDealt),
    grenadeKills: p.stats.grenadeKills,
  };
  state.events.push({ type: 'finish', title, subtitle, result: state.result });
}

export function restart(state) {
  return createMatch(state.cfg, state.seed);
}

/* ------------------------------------------------------------------- HUD */

export function hudModel(state) {
  const player = findPlayer(state);
  const p = state.player;
  const weapon = weaponOf(player);

  return {
    alive: aliveCount(state),
    kills: p.kills,
    health: player.health,
    armor: player.armor,
    ammo: p.ammo,
    reserve: p.reserve,
    medkits: p.medkits,
    grenades: p.grenades,
    weapon: weapon.id,
    weaponName: weapon.name,
    playerAlive: player.alive,
    spectating: p.spectating,
    reloading: p.reloading > 0,
    reloadProgress: p.reloading > 0 ? 1 - p.reloading / weapon.reloadDuration : 1,
    zoneRadius: currentZoneRadius(state),
    outsideZone: centreDistance(player.x, player.z) > currentZoneRadius(state),
    progress: matchProgress(state),
    damageFlash: p.damageFlash,
    damageIndicators: p.damageIndicators.map((d) => ({ angle: d.angle, health: d.health })),
    killFeed: p.killFeed.map((k) => ({ ...k })),
    finished: state.finished,
    result: state.result,
    sprinting: player.sprinting,
    crouching: player.crouching,
  };
}
