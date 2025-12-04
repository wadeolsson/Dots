# Dots Rules (team-aware)

- Seeding: Drag a team chip (blue or green) onto an empty cell, or select a chip and click the grid, to place a dot for that team.
- Replication: Each tick, every dot tries one random cardinal neighbor (N/E/S/W). If empty, it spawns a same-team dot there. If the neighbor is a dot, it tries the next cell in that direction (line-extension) if empty. Replication does not capture enemy cells.
- 5-in-a-row pressure: Any 5-dot line (row/col) of the **same team** forces the center (3rd) dot to move to a free cardinal neighbor (random among options), keeping ownership.
- Burst fallback: If the center cannot move (no free cardinals), it disappears and spawns into all four diagonal corners. Corner results:
  - Empty: becomes a same-team dot.
  - Enemy-occupied (dot/block/bomb): overridden into a same-team dot (corner spawns beat enemy occupancy).
  - Friendly but not a dot: converted to a friendly block.
- Bomb trigger: A dot arms only when surrounded by **enemy blocks** (4+ adjacent including diagonals). It becomes `bomb-armed` (yellow) the next tick, `bomb-hot` (red) the following tick, then explodes.
- Bomb explosion: Hits the 3×3 around the bomb plus some random spillover cells at distance 2. Destroys dots/blocks/bombs unless they win a small survival roll (~12%). Team ownership persists only if the cell survives. Bombs don’t discriminate.
- Conflicts: Spawn intents are shuffled so only one dot claims a contested empty cell per tick. Moves resolve after spawns; bursts and bombs apply afterward.
- Board: Fixed grid (currently 24×24), no wrapping. Blocks are uninhabitable.
