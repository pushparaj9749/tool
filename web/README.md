# BATTLE ROYALE — playable in the browser

A complete battle-royale shooter that runs in any modern browser. **No Unity, no engine, no
build step, no install.** Open the page and play.

This is the browser port of `unity/BattleRoyale/BRGame.cs` — same rules, same tuning
constants, same HUD layout — but rendered with three.js so it runs anywhere.

## Play it

```bash
node web/serve.mjs 8080      # or: npm start   (from web/)
# open http://localhost:8080
```

Nothing is downloaded at runtime: three.js is vendored in `web/vendor/`.

| Action | Desktop | Phone |
|---|---|---|
| Move | `W A S D` / arrows | virtual stick (left half) |
| Look | hold **right mouse** | drag right half |
| Fire | **left click** | `FIRE` |
| Reload | `R` | `RELOAD` |
| Heal +50 | `H` | `HEAL` |
| Jump | `Space` | `JUMP` |

Touch controls appear automatically on coarse-pointer devices.

## What is in the match

- 160 m map, 19–24 solid buildings with roofs and windows, 22 low cover blocks
- 16 fighters (you + 15 bots), each 100 HP
- Safe zone shrinks linearly from 74 m to 4 m over 240 s; **7 HP/s** outside,
  **18 HP/s** after the timer expires
- 24 loot crates: yellow = +60 reserve ammo, green = +1 medkit
- Body shot 26, headshot 65, kill refunds 20 reserve ammo
- Bots: acquire the nearest target within 48 m, close to ~18 m, strafe, fire every
  0.5–1.05 s with 62 % accuracy for 7–13 damage, steer around cover, run for the zone
- Win = last one alive, lose = position reported, `PLAY AGAIN` restarts without reloading

## Architecture

```
web/
├── index.html              # HUD + menus, no framework
├── serve.mjs               # 60-line static server (binds 0.0.0.0 for preview proxies)
├── vendor/three.module.min.js
└── src/
    ├── logic.js            # ALL game rules — no three.js, no DOM, no clock
    └── main.js             # three.js scene, input, HUD glue
```

`logic.js` is deliberately framework-free. `step(state, input, look, dt)` is a pure
simulation step: the renderer calls it with a frame delta, the tests call it with a fixed
delta. That single decision is why the game can be verified without a browser.

### Determinism

Every random draw goes through `makeRng(seed)` (xorshift32). `createMatch(CONFIG, seed)`
reproduces a match exactly — same map, same spawns, same loot. This is asserted in the tests.

## Verification

No GPU or browser was available while this was built (Chrome/Playwright downloads are blocked
in the sandbox), so the project is verified in two headless layers.

### 1. Rules — 47 tests, `node --test`

```bash
npm test          # 47 passed
```

Covers: RNG determinism, zone shrink curve and circularity, circle↔box and circle↔circle
collision + push-out, segment/box intersection, world generation bounds, spawn clearance,
map clamping, actor separation, jump arc and landing, hitscan (hit / miss / cover / low cover /
self-hit), ammo + fire-rate limiting, headshot height, death rewards, elimination and victory,
bot firing, cover blocking bot fire, bots running to the zone, zone damage before/after the
deadline, reload timing and reserve accounting, heal caps and refusals, loot pickup idempotency,
two full 400-second match simulations, `step()` being a no-op after the match ends, and a NaN
sweep over a 90-second run.

### 2. Renderer + DOM — headless boot

```bash
npm run test:headless
```

Stubs the DOM and replaces **only** `THREE.WebGLRenderer` with a stub; the real scene graph,
camera math, raycaster and game loop run. It asserts the module graph loads, the scene builds
(16 actors, 24 loot, ~40 cover), frames execute, `beginMatch()` works, and a 45-second
simulation shrinks the zone with finite state.

### Bugs this caught during development

| Bug | Found by |
|---|---|
| `traceShot` did not exclude the shooter, so every shot hit yourself at distance 0 | hitscan test |
| Hit flash mutated a **shared** material, tinting every actor | boot test |
| `step()` on a finished match replayed the previous frame's events | no-op test |
| Dead actors still blocked bullets | hitscan test |
| `aimDirection` disagreed with the movement convention (would fire backwards) | shot-direction test |
| Camera boom could clamp to 0 length and NaN the view | scene test |

## Not done

- No audio, no particle FX beyond tracer + impact, no ragdolls (capsules tip over)
- Bots use steering, not pathfinding — they can wedge against long walls
- Buildings are solid blocks with no interiors
- Physics is 2.5-D: cover blocks shots by height, but there is no falling or stairs
- Not profiled on low-end phones; ~7k triangles and ~160 draw calls, so it should be fine
- No multiplayer, no persistence, no settings menu
