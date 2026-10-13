# Sunset City: Turf War

A first-person shooter built for iPhone Safari (it also runs on desktop). It's set in a sun-baked, GTA-style city of stucco walk-ups, glass towers, palm-lined boulevards and a four-level parking garage. Every texture, mesh and sound is generated in code, so the game ships with no asset files.

## Play

You need to serve the folder over HTTP, because ES modules don't load from `file://`. For example:

```bash
npx http-server -p 8080 .
```

Then open `http://<your-computer-ip>:8080` on your phone and rotate to landscape. To get the best full-screen experience on iPhone, use **Share → Add to Home Screen**.

### Controls

| Touch | Desktop |
| --- | --- |
| Left thumb: floating joystick. Push to the edge to sprint, or toggle **RUN** | WASD, Shift to sprint |
| Right side: drag to aim | Mouse (click the screen to lock the pointer) |
| Big red button: fire. Drag on it to steer your aim while shooting | Left click |
| **AIM**: toggles aim-down-sights | Right mouse button (hold) |
| Jump button. Jump into a ledge to mantle onto it | Space |
| Reload / swap buttons | R, then Q, 1–5 or the mouse wheel |

## Gameplay

There are two modes:

- **Waves:** endless waves of rival crews that get tougher each round.
- **100 Bots:** 100 bots spread across the streets and rooftops at once. Clear them all to win. Only a few bots fire at you at any moment while the rest move into position, so the fight stays playable.

Three enemy types appear in both modes:

- **Gunners** who hold their range
- **Rushers** who close the distance
- **Rooftop snipers**, who show a lens glint before they fire

The city and your kit:

- Many buildings have wide exterior switchback staircases or metal fire escapes up to their roofs. Wooden planks bridge some neighbouring roofs. The garage has ramps up to its roof, and the central plaza is a three-tier monument with grand stairs on every side.
- You can jump or mantle onto cars, crates, parapets and ledges, and drop off anything without taking fall damage.
- There are five weapons, each with its own recoil (part of the kick stays and you have to pull it down), spread bloom and damage falloff:
  - P9 pistol
  - AR-74 rifle
  - VK-9 SMG
  - Pump 12 shotgun
  - Scoped DMR
- Pickups: armor, health and ammo sit on rooftops and respawn there. Enemies also drop them when they die.

## Tech

- **Rendering:** three.js r160 is loaded from a CDN. Static geometry is merged per material and spatial chunk. Palm trees are instanced. The camera-following sun shadow map is snapped to texels to stop shimmer.
- **Post-processing:** a custom HDR pipeline (MSAA on High quality) with a quarter- and eighth-resolution bloom chain, ACES tone mapping, a warm colour grade, vignette, and chromatic aberration and a red tint when you take damage.
- **Effects:** pooled GPU particles, instanced tracers, bullet-hole decals and physically bouncing brass casings. Nothing is allocated per frame in the hot paths.
- **Bots:** all bots are drawn with shared instanced meshes, so drawing 100 costs about the same as drawing a few. Distant bots update their AI less often to save CPU.
- **Collision and AI:** collision uses axis-aligned boxes in a grid with step-up for stairs and fast ray casting. Street-level enemies navigate with a breadth-first-search flow field.
- **Audio:** all sound is synthesised with the Web Audio API: per-weapon gunshots, distance-filtered enemy fire, near-miss whizzes, ricochets, reload sounds and city ambience.
- **Adaptive quality:** the game measures frame time and adjusts render resolution, then the quality tier, to hold 60 fps and avoid thermal throttling. You can pick Low, Medium or High manually in the pause menu.

## Code layout

| File | What it does |
| --- | --- |
| `src/main.js` | Game state machine (boot → menu → play ⇄ pause → game over), waves, combat resolution, rendering, quality control |
| `src/world.js` | City generator, geometry batching, collider grid and ray casting |
| `src/textures.js` | Procedural canvas textures |
| `src/sky.js` | Sky shader, pre-filtered environment map, distant hills |
| `src/player.js`, `src/physics.js` | Player controller and kinematic body |
| `src/weapons.js` | Weapon data, procedural viewmodels, recoil, reloads, swaps |
| `src/enemies.js`, `src/nav.js` | Enemy AI and the navigation flow field |
| `src/effects.js` | Particles, tracers, decals, casings |
| `src/post.js` | Post-processing |
| `src/input.js` | Multi-touch and keyboard/mouse input |
| `src/hud.js` | HUD |
| `src/audio.js` | Sound synthesis |
| `src/pickups.js` | Pickups |
