# Grand Fight City

A browser battle royale with a GTA6-style look: a third-person camera, 25 ghillie-suited snipers, a run-down island at golden hour, and a storm of rising water.

Everything is in `index.html`: Three.js comes from a CDN, and the textures, models, animations and sound are generated in code. There are no other asset files.

## Play

Open `index.html` in a modern desktop or mobile browser, or serve the folder (for example `npx serve .` or GitHub Pages) and visit it. Pick **Low** graphics on weaker machines.

## Features

- **Third-person camera:** smooth over-the-shoulder follow with camera collision, aim zoom, shoulder swap (`V`) and a full-screen sniper scope.
- **Lock-on firing:** the trigger only works while your crosshair is on an enemy. The crosshair turns red and shows `TARGET LOCKED`; otherwise you hear a dry click and see `NO TARGET`. Hip-fire still has spread, so scope in for accuracy.
- **Sniper-only loot:** Hunting Rifle, Bolt-Action, Semi-Auto and Heavy Sniper, each with a rarity colour. Also on the ground: ammo, wood, Bandages, Med Kits, Mini Shields and Shield Kegs.
- **Health and shields:** shields absorb damage first. Headshots deal bonus damage, and damage numbers, a hitmarker and a direction indicator show each hit.
- **Inventory:** a 5-slot hotbar (`1`–`5` or mouse wheel), a backpack screen (`Tab`) where you can drop items, and `G` to drop the selected item.
- **Building:** `Q` toggles build mode, `Z` picks a wall and `X` a ramp, and `LMB` places the piece. Pieces snap to a 4 m grid and cost 10 wood. Ramps can be chained upward, and bullets damage and destroy builds.
- **Storm of water:** a shrinking ring of rising water. Outside the safe zone the water stands 14 m deep, so you have to swim to high ground and back into the circle while taking damage. Swimming is slow and you cannot shoot. There is rain, an underwater tint and a storm overlay.
- **Bots:** 24 bots skydive in, loot, take cover with walls, heal, react to gunfire and move with the zone. Ghillie suits plus tall grass make a crouching player very hard to spot.
- **Island:** grassy hills, beaches, palms and broadleaf trees, rocks, a ring road, and six towns. The towns have graffiti, barred windows, neon shop signs, burnt-out cars, barrel fires, chain-link lots and basketball courts.
- **Look:** an art-directed sunset sky with pink clouds, a PBR environment, soft shadows, an animated ocean with sun glints and shore foam, wind-swayed grass and trees, bloom, colour grading, vignette and film grain.
- **UI:** a rotating GTA-style minimap with health and shield bars, a full map (`M`), a kill feed, the storm timer, a "Wasted" screen with spectating, and a victory screen.
- **Mobile:** virtual joystick, look pad, and touch buttons for fire, aim, jump, crouch, reload, build and pick up.

## Controls (desktop)

| Action | Key |
| --- | --- |
| Move / sprint | `WASD` / `Shift` |
| Look | Mouse |
| Aim / scope | Right mouse button |
| Fire (only when locked on) | Left mouse button |
| Reload / pick up | `R` / `E` |
| Jump / crouch | `Space` / `C` |
| Inventory slots | `1`–`5`, mouse wheel |
| Backpack / map | `Tab` / `M` |
| Build mode / wall / ramp | `Q` / `Z` / `X` |
| Swap shoulder | `V` |
