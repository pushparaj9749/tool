# BATTLE ROYALE v2 — playable in the browser **and** on Android

A complete 16-fighter battle royale: three weapons, grenades, armour, four bot skill
tiers, a shrinking safe zone and a kill feed. Runs in any modern browser with no build
step, and ships as an installable **Android APK** built by GitHub Actions.

```
Play in a browser  →  node web/serve.mjs 8080      then open localhost:8080
Install on Android →  Releases → v2.0.0 → battle-royale-debug.apk
```

---

## 1. Install the APK

Open the release page and download the APK:

**https://github.com/pushparaj9749/tool/releases/tag/v2.0.0**

Then on the phone: open the downloaded file → allow *"Install unknown apps"* for your
browser or file manager → Install. It is a **debug-signed** build, so Play Protect may
show a warning; that is expected for a self-installed APK.

`SHA256SUMS.txt` is attached next to the APK so the download can be verified:

```bash
sha256sum -c SHA256SUMS.txt
```

Requires **Android 5.1+ (API 22)** and a GPU with **OpenGL ES 3.0** (WebGL 2). Devices
without WebGL 2 are filtered out by the manifest on purpose — the game cannot run there.

### What the build does

`.github/workflows/android-apk.yml`, on every push that touches the game:

1. **Game logic tests** — 74 assertions (`node --test`).
2. **Headless renderer boot test** — DOM stub + shimmed renderer, runs the real scene graph.
3. **`npx cap sync android`** — copies `web/` into `android/app/src/main/assets/public`.
4. **`./gradlew assembleDebug`** — builds the APK.
5. **Verify the APK** — `aapt2 dump badging` (package id, versions, sdk levels),
   confirms the web build is actually packaged, and `apksigner verify` checks the signature.
6. **Upload** the APK + `SHA256SUMS.txt` as a workflow artifact (kept 90 days).
7. On a `v*` tag, also **attach them to a GitHub Release**.

### Signed release builds (optional)

The workflow builds an unsigned→signed **release** APK only when these repository
secrets exist. Nothing is stored in git.

| Secret | Contents |
|---|---|
| `BR_KEYSTORE_BASE64` | `base64 -w0 release.keystore` |
| `BR_KEYSTORE_PASSWORD` | keystore password |
| `BR_KEY_ALIAS` | key alias |
| `BR_KEY_PASSWORD` | key password |

Make a keystore locally with:

```bash
keytool -genkeypair -v -keystore release.keystore -alias br \
        -keyalg RSA -keysize 2048 -validity 10000
```

Without those secrets the debug APK is still produced and installable.

---

## 2. Play in a browser

```bash
node web/serve.mjs 8080     # or npm run serve
# http://localhost:8080
```

three.js and the postprocessing add-ons are vendored in `web/vendor/`, so nothing is
fetched at runtime.

### Controls

| Action | Desktop | Phone |
|---|---|---|
| Move | `W A S D` | virtual stick (left half) |
| Sprint / crouch | `Shift` / `C` | — |
| Look | hold **right mouse** | drag right half |
| Fire | **left click** | `FIRE` |
| Grenade | `G` | `NADE` |
| Swap weapon | `1` `2` `3` / `Q` | `SWAP` |
| Reload / Heal | `R` / `H` | `RELOAD` / `HEAL` |
| Jump | `Space` | `JUMP` |
| Spectate next | `E` / `Tab` | — |

---

## 3. What is in the game

### Weapons

| | AR-7 RIFLE | VX-9 SMG | BRK-12 SHOTGUN |
|---|---|---|---|
| Magazine | 30 | 36 | 6 |
| Rate | 0.105 s | 0.062 s | 0.72 s |
| Body / head | 26 / 62 | 13 / 30 | 11 × 9 pellets / 17 × 9 |
| Range | 140 m | 70 m | 34 m |
| Falloff starts | 55 m | 22 m | 12 m |
| Spread | 0.010 | 0.028 | 0.085 |
| Move speed | 1.00× | 1.08× | 0.94× |

Damage decays past the falloff distance down to a per-weapon floor (46 % rifle,
35 % SMG, 22 % shotgun) — the shotgun is devastating inside 12 m and useless at 30 m.

### Systems

- **Armour** absorbs 50 % of body damage and 25 % of headshots, breaks at 0.
- **Grenades** are physics projectiles (arc, bounce, 2.6 s fuse). Blast falls off with
  distance and is **halved behind cover**.
- **Bots** come in four tiers assigned by spawn order — ROOKIE / SOLDIER / VETERAN /
  ELITE — varying accuracy (0.44 → 0.84), damage (0.8× → 1.3×) and reaction time.
- **Safe zone** shrinks 74 m → 4 m over 240 s. 7 HP/s outside, 18 HP/s after the clock.
- **Loot**: ammo, medkits, armour plates and grenades, each with its own colour and glow.
- **Feedback**: directional damage arcs, kill feed with weapon + headshot flag, hit
  markers, screen shake, staged explosions, tracer rounds, muzzle flash.
- **After death** the camera starts spectating living bots, and the result screen reports
  kills, survival time, accuracy, headshots and total damage.

### Presentation

UnrealBloom + ACES tonemapping through `EffectComposer`, a gradient sky shader with a sun
disc and halo, three-light rig (sun + hemisphere + cool rim) with PCF soft shadows, a
weapon viewmodel with recoil/kick/bob, and a generated icon set for the APK.

---

## 4. Architecture

```
web/
├── index.html              HUD + menus, no framework
├── manifest.webmanifest    landscape PWA manifest
├── icon-192.png / 512.png
├── serve.mjs               60-line static server (binds 0.0.0.0)
├── vendor/
│   ├── three.module.min.js
│   └── jsm/postprocessing/ + jsm/shaders/     (bloom, composer, output pass)
└── src/
    ├── logic.js            ALL game rules — no three.js, no DOM, no clock
    └── main.js             three.js scene, input, HUD glue

android/                    Capacitor 6 project (generated, then customised)
.github/workflows/android-apk.yml
```

`logic.js` is deliberately framework-free. `step(state, input, look, dt)` is a pure
simulation step: the renderer calls it with a frame delta, the tests call it with a fixed
delta. Every random draw goes through `makeRng(seed)` (xorshift32), so `createMatch(cfg,
seed)` reproduces a whole match exactly.

The Android customisations on top of the generated project:

- `MainActivity.java` — immersive fullscreen (hidden system bars, swipe to reveal),
  `FLAG_KEEP_SCREEN_ON`, display-cutout support.
- `AndroidManifest.xml` — `sensorLandscape`, `resizeableActivity=false`,
  `uses-feature glEsVersion=0x00030000 required=true`.
- `styles.xml` — a `AppTheme.Fullscreen` variant with a `#070B10` window background and
  a post-splash hand-off, so no white flash appears on launch.
- Splash images and adaptive/round launcher icons generated at all five densities.

---

## 5. Verification

Neither a GPU nor a downloadable browser existed while this was built (Chrome and
Playwright downloads are blocked in the sandbox), so the project is verified in three
headless layers. All of them run in CI before the APK is built.

### 74 rules tests — `npm test`

RNG determinism, zone curve and circularity, circle↔box / circle↔circle collision and
push-out, segment↔box intersection, world bounds, spawn clearance, map clamping, actor
separation, jump arc and landing, hitscan (hit / miss / cover / low cover / self),
spread and pellets, damage falloff floors, armour absorption and breakage, grenade
physics and radial damage with cover shielding, kill feed and reserve caps, all four bot
tiers, loot kinds and carry limits, reload timing and reserve accounting, heal caps,
spectating cycle, sprint/crouch and weapon move multipliers, two full 400-second match
simulations, `step()` no-op after the match ends, and a NaN sweep.

### Headless renderer boot — `npm run test:headless`

Stubs the DOM, shims **only** `WebGLRenderer`, and runs the real scene graph, postprocessing
chain, camera math and raycaster. Asserts the scene builds (16 actors, 30 loot, 40 cover),
frames render through `EffectComposer`, `beginMatch()` works and a 45-second simulation
shrinks the zone with finite state.

### APK verification — inside CI

`aapt2 dump badging` for the package id and sdk levels, a check that `assets/public/`
really contains the built game, and `apksigner verify` for the signature.

### Bugs the tests caught

| Bug | Found by |
|---|---|
| `traceShot` did not exclude the shooter — every shot hit yourself at distance 0 | hitscan test |
| Hit flash mutated a shared material, tinting every actor | boot test |
| `step()` on a finished match replayed the previous frame's events | no-op test |
| Dead actors still blocked bullets | hitscan test |
| `aimDirection` disagreed with the movement convention (would fire backwards) | shot direction test |
| Camera boom could clamp to zero length | scene test |
| Armour could absorb more than it had | armour test |

---

## 6. Not done

- No audio, no ragdolls (capsules tip over), no character animation beyond leg swing.
- Bots use steering, not pathfinding — they can wedge against long walls.
- Buildings are solid blocks with no interiors.
- Physics is 2.5-D: cover blocks shots by height, but there is no falling or stairs.
- No multiplayer, no persistence, no settings menu.
- The APK is debug-signed. Publishing to Google Play needs the release keystore secrets
  above and an AAB (`./gradlew bundleRelease`).
