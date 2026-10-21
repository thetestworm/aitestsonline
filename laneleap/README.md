# Laneleap

An endless voxel lane-hopping arcade game built with **TypeScript**, **Three.js** and **Vite**.
Hop across procedurally generated meadows, roads, rivers and railways. Stay ahead of the
scrolling camera, or the **Stormray** (a giant sky-manta) swoops down and carries you off.

Every character, model, sound, tune and name in Laneleap is original. Models are built in code
from voxels, and all audio is synthesized at runtime with the Web Audio API. There are no
third-party art or audio assets.

## Quick start

```bash
cd laneleap
npm install
npm run dev        # http://localhost:5173 (add ?debug for the perf overlay)
```

| Script                  | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `npm run dev`           | Vite dev server with HMR                                        |
| `npm run build`         | Type-check (`tsc --noEmit`) and build to `dist/`                |
| `npm run preview`       | Serve the production build on http://localhost:4173             |
| `npm test`              | Vitest unit tests (generation, validation, collision, save, …)  |
| `npm run lint`          | ESLint (typescript-eslint strict)                               |
| `npm run format`        | Prettier                                                        |
| `npm run icons`         | Regenerate the PWA PNG icons (no dependencies)                  |
| `node scripts/perf.mjs` | Headless perf + screenshot harness (needs Playwright + preview) |

## Deploy

`npm run build` produces a fully static site in `dist/` with relative paths (`base: './'`),
so it works from any sub-path:

- **GitHub Pages:** push `dist/` to a `gh-pages` branch, or use the `actions/deploy-pages`
  workflow with `path: laneleap/dist`.
- **Netlify / Vercel / Cloudflare Pages:** build command `npm run build`, publish directory
  `dist` (root directory `laneleap`).
- **Any static host / S3:** upload the contents of `dist/`. Serve `sw.js` and
  `index.html` with `Cache-Control: no-cache` so updates reach players. Hashed assets
  under `assets/` can be cached forever.

The service worker and install prompt need HTTPS (or `localhost`).

## Controls

| Platform       | Controls                                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| Desktop (solo) | `W`/`↑`/`Space` hop forward · `A` `D` `S` / `←` `→` `↓` move · `P`/`Esc` pause   |
| Desktop (2–4P) | P1 `WASD` · P2 arrows · P3 `IJKL` · P4 `TFGH` or numpad `8456`                   |
| Touch          | Tap to hop forward, swipe to move (a 14 px dead zone separates taps from swipes) |
| Touch (2–4P)   | The screen splits into vertical strips, one per player, and multi-touch works    |
| Touch (option) | On-screen D-pad (Settings → Touch controls)                                      |

Inputs are buffered (two moves deep) while a hop is in the air, so quick taps are never lost.

## Features

**Gameplay:** endless procedurally generated lanes on a 9-column grid with an orthographic
isometric camera. Hops snap to the grid with squash-and-stretch. Score is the furthest row
reached and the high score persists. The camera scrolls forward, and falling 4 rows behind or
idling for 9 s summons the Stormray.

**Lanes:**

- Grass: trees, rocks and bushes block movement.
- Road: cars, pickups, box trucks and tankers with varied speeds, directions and density. Getting hit plays a squash animation.
- River: drifting logs (or ice floes, rafts, wafers or hover-pads, depending on the world) and static lily pads. Falling in, or riding off-screen, ends the run.
- Rail: flashing signal lights and a bell 1.7 s before a fast train arrives.

**Difficulty and generation:** a smooth `1 − e^(−row/160)` curve drives traffic speed,
truck mix, log length and gaps, train frequency and obstacle density. Lanes come in 8 group
patterns (meadow, forest maze, road, highway, river, lily hop, rail, rail + road) with rest
lanes in between. **Every lane passes a validator before it is used.** The validator checks
reachable columns through props and pads, traffic gaps against crossing time, the longest
wait for a log, and train intervals. Failing lanes are repaired, or replaced as a last resort.

**Progression:**

- Coins: the running total is saved.
- Prize Machine: 100 coins buys a random new character, weighted by rarity, with a capsule reveal animation.
- Daily gift: free coins once per local day, with a streak bonus.
- Missions: 3 rotating missions with coin rewards.
- Achievements: 15 to earn.

**37 original characters:** common, rare, epic and secret. Each has its own voxel model,
synthesized hop sound and death flourish (poof, spin, shatter, ghost, melt, feathers, sparks
or confetti). The secret characters have special abilities:

- Glimmer Moth: coin magnet.
- Phantom Lantern: floats over water once per run.
- Golden Sprout: double coins.
- Bitsy: glows at night and uses 8-bit sound effects.
- Prism Yak (epic): leaves a rainbow trail.

**Themed worlds:** Clover Meadow, Frostbite Flats (with snowfall), Neon Nightway, Sunbaked
Dunes and Sugarloaf Lane. Each world changes the palette, tree, rock and bush shapes, the
river platforms and the vehicle colours. A world is picked by the character's home world and
can be switched off in Settings.

**Modes and UI:**

- Main menu with a live scene behind it, character select (filters and rendered thumbnails), lobby for 2–4 players, pause and game over.
- Settings: sound, music, screen shake, themed worlds, graphics quality, touch scheme and key help.
- Layout works in portrait and landscape and respects safe-area insets.

**Polish:** soft shadows (off on low quality), a day/night cycle, particles (dust, splash,
feathers, sparks, confetti, snow), screen shake and vibration on death, and an original
looping chiptune with separate SFX and music toggles.

## Architecture

```
src/
  core/      loop (fixed timestep), input + gestures, collision, save (versioned), quality, rng
  world/     laneTypes, difficulty, generator, validator, Lane runtime, World streaming, worlds (themes)
  entities/  Player (hop/buffer/squash), Predator (Stormray)
  render/    Stage (renderer/camera/lights/day-night), palette atlas, voxel builder,
             InstanceBatch, env models, particles, CharacterLibrary (lazy models + thumbnails)
  game/      Game (state machine, hooks, progression), Run (rules for one session)
  audio/     AudioEngine (unlock, iOS quirks, SFX synthesis), music sequencer
  data/      characters (roster), characterModels (lazy chunk), missions + achievements
  ui/        DOM overlay UI
tests/       Vitest suites
scripts/     icon generator, autopilot + perf harness
```

### Performance techniques

- **One material for every voxel model.** All props, vehicles, trains, coins, the predator and the characters sample a single 32×32 palette texture atlas. Themed worlds recolour atlas swatches in place.
- **InstancedMesh everywhere.** Each prop, vehicle, platform, train car, coin, track or sign type is one `InstancedMesh` with slot pooling, so the whole world takes about 20–25 draw calls.
- **Chunked streaming.** Lanes are generated 26 rows ahead and released 12 rows behind, and their instance slots go back to the pool. When the world changes, geometries are `dispose()`d.
- **No per-frame allocations in hot paths.** Instance matrices are written straight into typed arrays. Particles live in preallocated `Float32Array`s. Collision helpers take preallocated arrays.
- **Fixed 60 Hz simulation.** Frame delta is clamped to 100 ms with at most 5 steps per frame, so returning from a background tab never causes a jump.
- **Pixel ratio cap.** `renderer.setPixelRatio(min(devicePixelRatio, cap))` with cap 2, 1.5 or 1 by quality level.
- **Automatic quality fallback.** Frame time is averaged over 1.5 s windows. Two slow windows (over 21 ms) step quality down: high → medium → low. Each step lowers pixel ratio and shadow-map size, then turns shadows off and reduces particles.
- **Code splitting.** The entry chunk is about 4 kB; the loading screen is inline HTML and CSS in `index.html`. Three.js is its own cached chunk, the game is its own chunk, and the character model builders are lazy-loaded. Character geometries are built on demand and trimmed when unused.

### Mobile handling

- **Touch:** `touch-action: none`, `overscroll-behavior: none`, and blocked `touchmove`, gesture, double-tap and `selectstart` events, so there is no pull-to-refresh, zoom or text selection. Input uses pointer events with pointer capture.
- **Auto-pause:** the game pauses on `visibilitychange`, `blur`, `pagehide` and orientation change.
- **Audio:** the `AudioContext` is created and resumed on the first gesture. On iOS the game sets `navigator.audioSession.type = 'playback'` and plays a silent looping `<audio>` element so sound is not muted by the ringer switch. It retries `resume()` after an `interrupted` state.
- **PWA:** manifest with `fullscreen` display mode (falls back to `standalone`), maskable and Apple icons, and a service worker generated at build time that precaches every hashed asset for offline play.

### Save data

Saves live under `localStorage["laneleap.save"]` with `version: 3`. Migrations run in order
(v1 → v2 → v3), then every field is sanitized on its own: unknown characters are dropped,
numbers are clamped and enum values are checked. Corrupt JSON is backed up to
`laneleap.save.corrupt` and does not crash the game. If storage is unavailable (for example
some private modes), the game runs without persistence.

## Testing

`npm test` runs the Vitest suites:

- **Lane generation:** contiguous, deterministic per seed, start area walled and clear, every lane type and pattern appears, hazards scale with difficulty.
- **Layout validation:** 60 seeds × 1,200 rows all validate. Hand-built impossible layouts are rejected: walls, disconnected pockets, misaligned lily pads, tight traffic, stranded log gaps and too-frequent trains.
- **Collision:** vehicle hitboxes, platform landing with forgiveness, log-plank snapping, drift-off, camera limit and coin magnet.
- **Also covered:** gestures (tap vs swipe, multiplayer zones), the fixed-timestep loop, save migration and sanitizing, and missions, achievements and the roster.

For devices, test on iOS Safari and Android Chrome by opening the preview URL over the LAN
(`npm run preview -- --host`). Use Chrome DevTools device emulation with CPU throttling (4×
or 6×) and the `?debug` overlay (or `F3`) to watch FPS, draw calls, triangles and live
geometry counts. `scripts/perf.mjs` automates the emulated runs with a simple autopilot.
