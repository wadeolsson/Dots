# Dots (team-based replicator sim)

[![Vibe coded by Codex](https://img.shields.io/badge/vibe%20coded%20by-codex-5f9eff?style=for-the-badge&logo=github)](#)

Team cultures spread across a grid, self-replicate, form lines, and crack each other with bombs while shuttling nutrients through wall “vessels.” Two teams (blue/green) can be seeded; each tick runs deterministic rules, while nutrients flow on a faster timeline.

## How to run

- `npm install`
- `npm run dev` and open the shown URL.
- Build: `npm run build`

## Controls

- Palette: drag a Blue/Green dot or producer chip onto an empty cell (or click a chip, then click a cell).
- Start/Pause, Step once (while paused), Reset, and Tick speed slider.

## Core rules (teams)

- **Seeding**: placing a chip creates a team dot (or a producer if you dragged a producer chip).
- **Replication**: each dot/producer tries one random cardinal neighbor per rule tick. If empty, it spawns a same-team dot. If that neighbor is a dot/producer, it tries the next cell in the same direction. If targeting an enemy, it attacks: defender health absorbs first; at 0 health, attacker takes the cell.
- **5-in-a-row pressure**: any 5-dot/-producer line of the same team pushes the center (3rd) to a free cardinal cell; otherwise, it bursts.
- **Burst**: center disappears; corners become team dots if empty, or team blocks if occupied (enemy or friendly). Blocks are uninhabitable.
- **Bombs**: a dot/producer surrounded by 4+ enemy blocks arms → hot → explodes. Explosion clears nearby cells with a small survival chance; blocks are destroyed too.
- **Walls/blocks**: team-tinted; serve as vessels for nutrients.

## Nutrients & vessels

- **Flow loop**: nutrients move along connected wall cells on a fast timer. Producers emit nutrients into adjacent walls.
- **Dead ends**: when a nutrient reaches a wall dead end, it looks for adjacent friendly dots:
  - If found, it feeds that dot (+1 health up to 3).
  - If the fed dot touches any enemy, it simply becomes stronger (thicker ring).
  - If no adjacent enemies, the fed dot converts into a producer.
  - If no friendly dots adjacent, the nutrient dissipates.
- **Capture defense**: health absorbs attacks; when an enemy targets a cell with health > 0, health is reduced by 1 and the takeover fails. At 0, normal capture applies.
- **Vessel overlay**: wall centers are connected with team-colored lines drawn atop the grid for clarity.

## States & visuals

- Dot (team color), Strong dot (health ring), Producer (glowing core), Block/Wall (team-textured), Bomb (yellow → red with team outline), Nutrient (tiny dot on walls).

## Notes

- Grid is 24×24, no wrapping.
- Rules are deterministic per tick; nutrients move independently on a faster interval.
