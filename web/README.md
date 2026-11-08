# BATTLE ROYALE v2.4.0 — playable in the browser **and** on Android

A complete 16-fighter battle royale: three weapons, grenades, armour, four bot skill
tiers, a shrinking safe zone and a kill feed. Runs in any modern browser with no build
step, and ships as an installable **Android APK** built by GitHub Actions.

**v2.4.0 is the performance and touch release.**

- **The extra gun is actually gone this time.** v2.3.0 hid the rifle in the
  body's hands, which was the wrong side of the problem: the camera is third
  person, so the body's rifle *is* the player's gun. The stray weapon was the
  **first-person viewmodel** — a gun parented to the camera and floating over the
  body's right shoulder. It has been deleted along with its recoil, kick and
  muzzle bookkeeping. One gun, held by the body. The headless test asserts
  `body: true / body-rifle: true` and there is no viewmodel left to reappear.
- **The lag was draw calls.** v2.3.0's denser map built ~924 separate meshes, and
  every one of them cast a shadow, so the whole set was rasterised twice per
  frame. Static scenery is now baked into world space and merged per material:
  **924 meshes → 17 draw calls**, visually identical. On top that: quality tiers
  by core count / device memory / mobile detection instead of one blunt `LOW_END`
  flag, a 512–1024 shadow map on phones instead of 2048, a shadow frustum tight
  around the player, bloom skipped entirely on low-end hardware, and a dynamic
  resolution scaler that steps the pixel ratio between 0.6x and 1x based on
  measured frame time.
- **Assets: the map has vegetation and real ground.** Trees with tapered trunks,
  forked branches and flat-shaded canopy blobs; shrub clumps; 460 crossed-quad
  grass tufts; and three new painted textures (foliage, bark, cracked tarmac).
  All of it merges into the same batch, so the extra detail costs ~4 draw calls.
- **Touch only.** The keyboard legend on the start card is gone — it was a
  desktop instruction sheet in a phone game. Its replacement describes the
  actual controls: left thumb, right thumb, red button, blue/green, lime/amber.
- **Buttons, Free Fire style.** The big pale circles are gone. Buttons are now
  compact sharp-cornered glass tiles with an accent bar on the left edge, icon
  only, no labels, spaced into a right-thumb arc. FIRE is an 86px anchor at the
  bottom right; the rest ring it. Tap targets stay ≥ 50px.

**v2.3.0 is the content release: a real map, a clean HUD and a proper icon set.**

- **The duplicate gun is gone, the body is not.** The camera is third person, so the
  local player's body belongs on screen. What did not belong was the rifle in that
  body's hands, which sat at the right edge of the frame next to the first-person
  viewmodel and read as a stray second gun. Only `gunPivot` is hidden during play; the
  body, head, arms and walk cycle are untouched, and the rifle returns on the death cam
  and while spectating. A headless assertion now fails the build if the body is ever
  hidden again or the rifle ever becomes visible (`true / false`).
- **The map is no longer an empty field.** v2.2.2 scattered ~46 obstacles over
  160×160 m — one per 557 m², all flat. There are now ~187, roughly one per 137 m²:
  four named POIs (Foundry, Depot, Terrace, Outpost) with 4–6 clustered buildings each,
  perimeter walls with piers, sandbag emplacements, rock outcrops and concrete terraces.
  The generator is still deterministic per seed, and a test now fails if density drops
  below one object per 200 m² or if a kind (building / cover / rock / wall / platform)
  goes missing.
- **Touch buttons have SVG icons.** FIRE, RELOAD, HEAL, JUMP, NADE and SWAP were text
  labels on flat circles — identical at arm's length on a phone. Each is now a glass
  button with a hand-drawn inline SVG glyph and its own accent colour, with a pressed
  state that scales and glows. DEPLOY and PLAY AGAIN get the same treatment plus a
  highlight sweep on hover. Open `web/tests/buttons-preview.html` to see them at rest
  and pressed.

**v2.2.2 fixes the actual cause of the black sky: the shader did not compile.**
The shooting-star code named a variable `active`. `active` is a **reserved word in GLSL**,
so the entire fragment shader failed to compile, WebGL rendered nothing, and the player got
a pure black sky. The CPU port in this repo could not catch it because it was hand-written
Python that never saw that identifier, and the JS tests could not catch it because to JS
the shader is only a string.

The build now compiles the shader with the **real glslang reference compiler** on every
commit (`npm run test:shader`), which is how the bug was found and fixed. That test is in CI
before the APK is assembled.

**v2.2.1 fixes a black sky and adds three more sky layers.** v2.2 booted at
`dayClock = 0.18`, which is *night* — the first thing a player saw was a black dome. It
also ran `pow()` on bases that go negative, which is undefined in GLSL and renders as
black pixels on many mobile GPUs.

**v2.2 rebuilds the sky.** A live day/night cycle drives a full atmospheric dome:
scattering, drifting cloud layers, a sun disc with an anamorphic streak, a phased moon, a
rolling star field with a milky-way band, shooting stars, cirrus, god rays and a low-sun
rainbow. Everything that should agree about the time of day — sky, fog, sun light,
hemisphere light, bloom and exposure — is keyed off one clock.

**v2.1 adds the default aim that v2 was missing** (Free-Fire-style view assist plus
bullet magnetism), procedurally painted surface textures, a fully modelled fighter,
per-weapon viewmodels, a synthesised audio engine and a decorated map.

```
Play in a browser  →  node web/serve.mjs 8080      then open localhost:8080
Install on Android →  Releases → v2.2.2 → battle-royale-debug.apk
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

### Default aim (the v2.1 headline)

The game ships with assist **on by default**, the way a mobile shooter does. It is
angle-based, so it behaves identically for a mouse, a thumbstick and a finger drag.

| | Value | What it means |
|---|---|---|
| `assistCone` | 0.22 rad (~12.6°) | How far off-target the crosshair can be and still be pulled |
| `assistStrength` | 0.75 | How hard the view is pulled |
| `assistRate` | 14 /s | Convergence speed |
| `bulletMagnetCone` | 0.055 rad (~3.2°) | How close a shot must be before the bullet curves |
| `bulletMagnetStrength` | 0.85 | How much the bullet curves |
| `maxRange` | 80 m | Assist fades out beyond this |
| `minDistanceScale` | 0.55 | Floor on the distance falloff |

Three deliberate design rules keep it from feeling like a cheat:

1. **It aims at the torso, never the head.** Converging on the head made close-range
   shots sail over the target and handed out free headshots. Headshots stay a skill.
2. **It weakens with distance** (down to 55 %) so long shots still need aim.
3. **It never shoots through walls** — solid cover (≥ 2 m) breaks the lock, while
   waist-high crates do not.

Measured effect, 8 shots per trial, shooter starting ~3.2° off target with recoil drift
and hand wobble (40 trials per range):

| Range | No assist | With assist |
|---|---|---|
| 8 m | 4.00 / 8 | 4.00 / 8 |
| 14 m | 0.00 / 8 | 4.00 / 8 |
| 22 m | 0.00 / 8 | 4.00 / 8 |
| 34 m | 0.00 / 8 | 3.90 / 8 |
| 50 m | 0.00 / 8 | 3.52 / 8 |
| 65 m | 0.00 / 8 | 3.00 / 8 |

It never makes you *worse* (the 8 m row is unchanged) and it turns a hopeless shot into
a hit at mid range. The locked enemy gets a pulsing red ring with a `LOCK` / `HEAD`
label, so you can always see that the assist is doing something.

Turn it off with `CONFIG.aim.enabled = false` — every path checks the flag.

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
disc and halo, three-light rig (sun + hemisphere + cool rim) with PCF soft shadows, and a
generated icon set for the APK.

**Everything is painted at boot.** No binary art ships with the build (the sandbox cannot
download any), so the assets are generated in code:

- **Six canvas textures** — grass with blade grain and worn dirt, cracked concrete with
  panel seams and rising grime, painted metal with ribs and rust blooms, staggered
  sandbag courses with stitching, and planked wood with steel banding. Painted with a
  seeded PRNG, so the world is identical on every run.
- **Cover with silhouette** — buildings get a skirting band, roof slab, parapet, corner
  pilasters, boarded windows and a doorway; crates get a steel lid and banding; bags are
  stacked in battered courses; boulders are faceted icosahedra.
- **150 scattered props** — oil barrels, crate stacks, boulder clusters, tree stumps and
  debris planks, all placed deterministically and kept out of the collision set.
- **A modelled fighter** — helmet with brim, ballistic vest with pouches, shoulder pads,
  backpack, belt, knee pads, boots and two-segment limbs with a real walk cycle (hips
  swing, knees bend on the back stroke, arms counter-swing, vertical bob).
- **Per-weapon viewmodel** — receiver, railed top, stock, grip, trigger guard, magazine,
  barrel with a muzzle brake, optic with a glowing red dot, gloved hands and a two-layer
  muzzle flash. The shotgun, SMG and rifle have visibly different silhouettes.
- **Modelled loot** — a medkit with a red cross, a ceramic armour plate on a stand, a
  frag grenade with cap and lever, and an open ammo crate with visible rounds. Each
  spins, bobs and carries a rotating halo ring plus a soft glow dome.
- **Synthesised audio** — filtered noise bursts and swept oscillators give every gunshot
  its own voice, with stereo panning and distance attenuation. There are sounds for
  hits, headshots, taking damage, reloads (three-stage click), pickups, weapon swaps,
  explosions, deaths and the zone warning. Audio unlocks on the first input, as browser
  autoplay rules require.

---

### The sky

One shader on a 300 m dome, plus a clock. Every colour was tuned by porting the fragment
shader to NumPy and rendering it on the CPU, because there is no GPU in the build
environment — that is how the black-sky boot and the pink-midnight clouds were caught.

| Layer | What it does |
|---|---|
| Atmosphere | Warm horizon on the sun's side, deep blue zenith, ground bounce below the horizon |
| Clouds | Two drifting fBm layers on a bounded dome projection, lit tops, dark bases, silver lining on the sunward rim |
| Cirrus | A fourth, much higher and slower layer, stretched along one axis because cirrus is wind-combed |
| Sun | Disc that reddens and swells near the horizon, layered glow, anamorphic horizontal streak |
| God rays | Five-sample march toward the sun accumulating the cloud *gaps* — fake volumetrics, real look |
| Rainbow | Faint 42° ring opposite the sun with a spectral ramp, only when the sun is low |
| Moon | Phase-aware terminator, soft halo, only lit once the sun is down |
| Stars | Hashed lattice with per-cell tint and twinkle, milky-way band |
| Meteors | Three lanes on independent timers, great-circle sweeps |

A **210-second day cycle** interpolates six keyframes through dawn → day → dusk → night.
The same keyframes drive `toneMappingExposure`, the fog colour, the sun light's colour and
intensity, the hemisphere light, the rim light and the bloom strength, so the scene and the
sky always agree.

Five rules the implementation follows, each learned the hard way:

1. **Bounded cloud projection.** `p = dir.xz / (dir.y * 0.62 + 0.30)`. Without the
   `+ 0.30` the UVs race to infinity at the horizon and the whole sky becomes flat grey fog.
2. **Contrast before thresholding.** The measured fBm mean is 0.478 with most mass in
   0.27–0.68. Thresholding that directly covers ~60 % of the sky in mush.
3. **Golden hour multiplies, it does not mix.** A lerp toward orange cannot remove the
   blue already in a white cloud, so sunset clouds stayed pale pink.
4. **Golden hour is a band, not a ramp.**
   `smoothstep(-0.25, -0.05, h) * (1 - smoothstep(0.05, 0.28, h))`. A one-sided
   `(0.28 - h)` ramp stays saturated all night and lights every midnight cloud pink.
5. **The dome travels with the camera.** The map is 160 × 160 and the camera far plane is
   340 m, so standing at a corner puts the far side of a 300 m dome ~470 m away.

**Start at `dayClock = 0.30`, not 0.18.** 0.5 is noon, 0.25 sunrise, 0.75 sunset. 0.18 is
night. That single constant was the black sky.

**Never call `pow()` on a base that can go negative.** It is undefined in GLSL; desktop
drivers often return NaN which renders black, and mobile drivers are worse. Every `pow()`
here has a `max()` or is a squared term written as `x * x`.

`sampleDay()` and `updateSky()` reuse module-level scratch vectors and colours; nothing is
allocated per frame.

**Failure modes are visible, not silent.** A shader that fails to compile renders a black
sphere with only a console line to explain why. The dome now compiles eagerly, falls back
to a flat sky colour if it cannot, and any WebGL context loss or shader error raises an
on-screen banner instead of leaving the player staring at a black screen.

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

### 91 rules tests — `npm test`

RNG determinism, zone curve and circularity, circle↔box / circle↔circle collision and
push-out, segment↔box intersection, world bounds, spawn clearance, map clamping, actor
separation, jump arc and landing, hitscan (hit / miss / cover / low cover / self),
spread and pellets, damage falloff floors, armour absorption and breakage, grenade
physics and radial damage with cover shielding, kill feed and reserve caps, all four bot
tiers, loot kinds and carry limits, reload timing and reserve accounting, heal caps,
spectating cycle, sprint/crouch and weapon move multipliers, two full 400-second match
simulations, `step()` no-op after the match ends, and a NaN sweep.

The 17 aim-assist tests cover: angle wrapping across the ±π seam, `lookAtAngles` in all
four compass directions, target selection inside vs outside the cone, nearest-target
preference, line-of-sight blocking by walls but not by low cover, the range limit, the
disable flag, convergence under repeated frames, frame-rate independence, that magnetism
saves near-misses but never invents hits, that magnetism never converts a body shot into
a headshot, the `magnetTarget` reported on shot events, that corpses and the player are
never targeted, and that assist is off while spectating.

### Headless renderer boot — `npm run test:headless`

Stubs the DOM, shims **only** `WebGLRenderer`, and runs the real scene graph, postprocessing
chain, camera math and raycaster. Asserts the scene builds (16 actors, 30 loot, 40 cover),
frames render through `EffectComposer`, `beginMatch()` works and a 45-second simulation
shrinks the zone with finite state.

### Shader compilation — `npm run test:shader`

The most important test in the project, and it exists because of a shipped bug.

`web/tests/shader/compile.test.mjs` links the vertex and fragment shaders exactly as
three.js presents them to a WebGL1 driver — same `#version 100`, same precision qualifiers,
same built-in uniforms and attributes — and compiles them with **glslang**, the Khronos
reference compiler, running as WebAssembly. Any diagnostic fails the build.

It also asserts a static list of GLSL reserved words never appears as a declaration name,
and that no `pow()` is called on a base that can go negative.

```
$ npm run test:shader
# tests 5
# pass 5
# fail 0
```

Verified that the test actually catches the original bug: reintroducing the `active`
declaration makes two of the five tests fail.

### Sky verification — CPU render of the real shader

There is no GPU in the build environment, so `SKY_FRAG` is ported to NumPy and rendered on
the CPU. The port reads the keyframes and the boot clock straight out of `web/src/main.js`,
so it cannot drift from the shipped shader. It renders the full 24-hour cycle and asserts
that no frame collapses to black:

```
clock  sun.y   mean RGB       status
 0.00  -0.989  [19 17 24]     dark-night   <- a real night, not a bug
 0.25  +0.000  [161 93 64]    ok
 0.30  +0.287  [184 199 204]  ok           <- the boot frame
 0.50  +0.989  [191 206 210]  ok
 0.75  +0.000  [168 99 64]    ok
 0.90  -0.839  [19 18 26]     dark-night

ALL FRAMES NON-BLACK
```

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
| **The sky shader used `active` as a variable name — a GLSL reserved word — so it never compiled at all and rendered a black screen** | glslang compile test |
| Game booted at `dayClock = 0.18`, which is night — first frame was a black sky | 24-hour CPU cycle render |
| `pow(1.0 - up, 1.6)`, `pow(band * 3.1, 2.0)`, `pow(across * 26.0, 2.0)` ran on negative bases — undefined in GLSL, black on mobile GPUs | shader audit |
| Golden-hour ramp stayed at 1.0 all night, so midnight clouds glowed pink | 24-hour CPU cycle render |
| The sky fallback set `scene.background`, which `updateSky()` erased on the next frame | code review |
| `lookAtAngles` was called with four arguments, so the head geometry landed in `eyeHeight` and produced `NaN` pitch | aim-assist test |
| A `NaN` candidate could win target selection (`NaN > x` is always false) | assist cone test |
| The view assist converged on the **head**, so close-range shots sailed over the target (−32 % hits at 8 m) | assist benchmark |
| Low cover blocked the lock even though you can shoot over it | line-of-sight test |
| Bullet magnetism aimed at the head, silently turning body shots into headshots | firePlayerShot test |

---

## 6. Not done

- No ragdolls — a dead fighter tips over as a rigid body.
- Bots use steering, not pathfinding — they can wedge against long walls.
- Buildings are solid blocks with no interiors.
- Physics is 2.5-D: cover blocks shots by height, but there is no falling or stairs.
- The textures are procedural, not authored art. They are a large step up from flat
  vertex colours, but they are not a substitute for a real texture set.
- Footsteps, rain and ambient wind are not implemented; gunfire, impacts and the HUD are.
- Clouds are a shaded dome, not true volumetrics — the two drift layers give some
  parallax, but there are no light shafts through the gaps.
- No multiplayer, no persistence, no settings menu.
- The APK is debug-signed. Publishing to Google Play needs the release keystore secrets
  above and an AAB (`./gradlew bundleRelease`).
