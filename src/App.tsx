import React, { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Team = 'blue' | 'green'

type CellState = 'empty' | 'dot' | 'producer' | 'block' | 'bomb-armed' | 'bomb-hot'
type Cell = { state: CellState; team?: Team; health?: number }
type Grid = Cell[][]
type AnimType = 'spawn' | 'move' | 'plop' | 'block'
type AnimInfo = { type: AnimType; dx?: number; dy?: number }
type NutrientDir = [number, number]
type Nutrient = { id: string; r: number; c: number; team: Team; dir: NutrientDir; prev?: NutrientDir }
const ROWS = 24
const COLS = 24
const CARDINALS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const
const DIAGONALS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const
const ALL_NEIGHBORS = [...CARDINALS, ...DIAGONALS]
const BLAST_SURVIVAL_CHANCE = 0.12
const MAX_HEALTH = 3
const NUTRIENT_INTERVAL = 120 // ms
const PRODUCE_EVERY = 6 // nutrient ticks
const MAX_NUTRIENTS_PER_CELL = 1
const BOARD_PADDING = 14 // px, matches CSS

const createEmptyGrid = (rows = ROWS, cols = COLS): Grid =>
  Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ state: 'empty' as CellState, team: undefined })),
  )

const inBounds = (r: number, c: number, rows: number, cols: number) =>
  r >= 0 && r < rows && c >= 0 && c < cols

const shuffled = <T,>(items: readonly T[]) => {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

type StepResult = { grid: Grid; blasts: string[]; anims: Record<string, AnimInfo> }

const keyFor = (r: number, c: number) => `${r},${c}`
const isDotLike = (cell: Cell) => cell.state === 'dot' || cell.state === 'producer'
const hasEnemyNeighbor = (grid: Grid, r: number, c: number, team?: Team) => {
  if (!team) return false
  for (const [dr, dc] of CARDINALS) {
    const nr = r + dr
    const nc = c + dc
    if (!inBounds(nr, nc, grid.length, grid[0].length)) continue
    const other = grid[nr][nc]
    if (other.team && other.team !== team && other.state !== 'empty') return true
  }
  return false
}

const collectBlastCells = (r: number, c: number, rows: number, cols: number) => {
  const cells: [number, number][] = []
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const nr = r + dr
      const nc = c + dc
      if (inBounds(nr, nc, rows, cols)) cells.push([nr, nc])
    }
  }
  const spill = [
    [r + 2, c],
    [r - 2, c],
    [r, c + 2],
    [r, c - 2],
    [r + 1, c + 1],
    [r + 1, c - 1],
    [r - 1, c + 1],
    [r - 1, c - 1],
  ] as const
  spill.forEach(([nr, nc]) => {
    if (!inBounds(nr, nc, rows, cols)) return
    if (Math.random() < 0.25) cells.push([nr, nc])
  })
  return cells
}

const stepGrid = (grid: Grid): StepResult => {
  const rows = grid.length
  const cols = grid[0].length
  const next: Grid = grid.map((row) => row.map((cell) => ({ ...cell })))
  const spawnIntents: { r: number; c: number; team: Team }[] = []
  const toArm: { r: number; c: number }[] = []
  const toHot: { r: number; c: number }[] = []
  const toExplode: { r: number; c: number }[] = []
  const blasts: string[] = []
  const anims: Record<string, AnimInfo> = {}

  const markAnim = (key: string, info: AnimInfo) => {
    if (!anims[key]) anims[key] = info
  }

  // Bomb triggers: dots surrounded by 4+ walls (block) become armed.
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!isDotLike(grid[r][c])) continue
      const team = grid[r][c].team
      let walls = 0
      for (const [dr, dc] of ALL_NEIGHBORS) {
        const nr = r + dr
        const nc = c + dc
        if (!inBounds(nr, nc, rows, cols)) continue
        if (grid[nr][nc].state === 'block' && grid[nr][nc].team !== team) walls += 1
      }
      if (walls >= 4) toArm.push({ r, c })
    }
  }

  // Track bomb state transitions.
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c].state === 'bomb-armed') toHot.push({ r, c })
      if (grid[r][c].state === 'bomb-hot') toExplode.push({ r, c })
    }
  }

  // Apply newly armed bombs.
  toArm.forEach(({ r, c }) => {
    next[r][c] = { state: 'bomb-armed', team: grid[r][c].team }
  })

  // Advance armed -> hot
  toHot.forEach(({ r, c }) => {
    next[r][c] = { state: 'bomb-hot', team: grid[r][c].team }
  })

  // Handle explosions (hot -> boom)
  if (toExplode.length > 0) {
    const blastCells: [number, number][] = []
    toExplode.forEach(({ r, c }) => {
      blastCells.push(...collectBlastCells(r, c, rows, cols))
    })
    blastCells.forEach(([br, bc]) => blasts.push(keyFor(br, bc)))

    blastCells.forEach(([br, bc]) => {
      if (!inBounds(br, bc, rows, cols)) return
      const cell = next[br][bc]
      const isBomb = cell.state === 'bomb-armed' || cell.state === 'bomb-hot'
      const survive = !isBomb && Math.random() < BLAST_SURVIVAL_CHANCE
      if (!survive) {
        next[br][bc] = { state: 'empty', team: undefined }
      }
    })
  }

  // Rule 1 + 2: replication to non-corner neighbors; if blocked by a dot, extend in that line to make a 3.
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!isDotLike(grid[r][c])) continue
      const team = grid[r][c].team as Team
      const dirs = shuffled(CARDINALS)
      for (const [dr, dc] of dirs) {
        const nr = r + dr
        const nc = c + dc
        if (!inBounds(nr, nc, rows, cols)) continue

        if (grid[nr][nc].state === 'empty') {
          spawnIntents.push({ r: nr, c: nc, team })
          break
        }

        if (grid[nr][nc].state === 'dot' || grid[nr][nc].state === 'producer') {
          const rr = nr + dr
          const cc = nc + dc
          if (inBounds(rr, cc, rows, cols) && grid[rr][cc].state === 'empty') {
            spawnIntents.push({ r: rr, c: cc, team })
            break
          }
          // Attack enemy occupant
          if (grid[nr][nc].team !== team) {
            spawnIntents.push({ r: nr, c: nc, team })
            break
          }
        }
      }
    }
  }

  shuffled(spawnIntents).forEach(({ r, c, team }) => {
    if (next[r][c].state === 'empty') {
      next[r][c] = { state: 'dot', team, health: 0 }
      markAnim(keyFor(r, c), { type: 'spawn' })
      return
    }
    if (next[r][c].team && next[r][c].team !== team) {
      const defender = next[r][c]
      if ((defender.health ?? 0) > 0) {
        defender.health = Math.max(0, (defender.health ?? 0) - 1)
      } else {
        next[r][c] = { state: 'dot', team, health: 0 }
        markAnim(keyFor(r, c), { type: 'spawn' })
      }
    }
  })

  // Rule 3-6: resolve 5-in-a-row centers; move or burst into corners.
  const centers = new Set<string>()
  // Horizontal
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c <= cols - 5; c += 1) {
      const segment = next[r].slice(c, c + 5)
      if (
        segment.every((cell) => isDotLike(cell)) &&
        new Set(segment.map((cell) => cell.team)).size === 1
      ) {
        centers.add(`${r},${c + 2}`)
      }
    }
  }
  // Vertical
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r <= rows - 5; r += 1) {
      let allDot = true
      for (let k = 0; k < 5; k += 1) {
        if (!isDotLike(next[r + k][c])) {
          allDot = false
          break
        }
      }
      if (allDot) {
        const teams = new Set(
          Array.from({ length: 5 }, (_, idx) => next[r + idx][c].team),
        )
        if (teams.size === 1) centers.add(`${r + 2},${c}`)
      }
    }
  }

  shuffled(Array.from(centers)).forEach((key) => {
    const [rStr, cStr] = key.split(',')
    const r = Number(rStr)
    const c = Number(cStr)
    if (next[r][c].state !== 'dot') return
    const team = next[r][c].team as Team

    const openNeighbors = CARDINALS.map(([dr, dc]) => [r + dr, c + dc] as const).filter(
      ([nr, nc]) => inBounds(nr, nc, rows, cols) && next[nr][nc].state === 'empty',
    )

    if (openNeighbors.length > 0) {
      const [nr, nc] = shuffled(openNeighbors)[0]
      next[nr][nc] = { state: 'dot', team, health: next[r][c].health }
      next[r][c] = { state: 'empty', team: undefined, health: undefined }
      markAnim(keyFor(nr, nc), { type: 'move', dx: c - nc, dy: r - nr })
      return
    }

    // Burst: remove center and try to fill corners; occupied corners become blocks.
    next[r][c] = { state: 'empty', team: undefined }
    DIAGONALS.forEach(([dr, dc]) => {
      const nr = r + dr
      const nc = c + dc
      if (!inBounds(nr, nc, rows, cols)) return
      const target = next[nr][nc]
      if (target.state === 'empty') {
        next[nr][nc] = { state: 'dot', team }
        markAnim(keyFor(nr, nc), { type: 'plop', dx: c - nc, dy: r - nr })
      } else if (target.team !== team) {
        // enemy corners become same-team blocks
        next[nr][nc] = { state: 'block', team }
        markAnim(keyFor(nr, nc), { type: 'block' })
      } else {
        // friendly occupancy becomes/ stays a block
        next[nr][nc] = { state: 'block', team }
        markAnim(keyFor(nr, nc), { type: 'block' })
      }
    })
  })

  return { grid: next, blasts, anims }
}

const cloneGrid = (grid: Grid): Grid => grid.map((row) => row.map((cell) => ({ ...cell })))

const pruneNutrients = (grid: Grid, nutrients: Nutrient[]) =>
  nutrients.filter(
    (n) =>
      inBounds(n.r, n.c, grid.length, grid[0].length) &&
      grid[n.r][n.c].state === 'block' &&
      grid[n.r][n.c].team === n.team,
  )

const runNutrients = (
  grid: Grid,
  nutrients: Nutrient[],
  tick: number,
): { grid: Grid; nutrients: Nutrient[] } => {
  const rows = grid.length
  const cols = grid[0].length
  const next = cloneGrid(grid)
  const nextNutrients: Nutrient[] = []
  const occupied = new Map<string, number>()

  const bumpHealth = (r: number, c: number) => {
    const cell = next[r][c]
    cell.health = Math.min(MAX_HEALTH, (cell.health ?? 0) + 1)
  }

  const feedDot = (nr: number, nc: number, team: Team) => {
    const cell = next[nr][nc]
    if (cell.team !== team || !isDotLike(cell)) return false
    bumpHealth(nr, nc)
    if (!hasEnemyNeighbor(next, nr, nc, team)) {
      cell.state = 'producer'
    }
    return true
  }

  const handleDeadEnd = (n: Nutrient) => {
    const { r, c, team } = n
    const friendlyDots: [number, number][] = []
    for (const [dr, dc] of CARDINALS) {
      const nr = r + dr
      const nc = c + dc
      if (!inBounds(nr, nc, rows, cols)) continue
      const cell = next[nr][nc]
      if (cell.team === team && isDotLike(cell)) friendlyDots.push([nr, nc])
    }
    if (friendlyDots.length > 0) {
      const [nr, nc] = friendlyDots[0]
      feedDot(nr, nc, team)
    }
  }

  const wallNeighborDirs = (r: number, c: number, team: Team, prev?: NutrientDir) => {
    const dirs: NutrientDir[] = []
    CARDINALS.forEach(([dr, dc]) => {
      const nr = r + dr
      const nc = c + dc
      if (!inBounds(nr, nc, rows, cols)) return
      const cell = next[nr][nc]
      if (cell.state === 'block' && cell.team === team) {
        dirs.push([dr, dc])
      }
    })
    if (prev && dirs.length > 1) {
      return dirs.filter(([dr, dc]) => !(dr === -prev[0] && dc === -prev[1]))
    }
    return dirs
  }

  // Move nutrients
  nutrients.forEach((n) => {
    if (
      !inBounds(n.r, n.c, rows, cols) ||
      next[n.r][n.c].state !== 'block' ||
      next[n.r][n.c].team !== n.team
    ) {
      return
    }

    const dirs = wallNeighborDirs(n.r, n.c, n.team, n.dir)
    if (dirs.length === 0) {
      handleDeadEnd(n)
      return
    }

    const [dr, dc] = shuffled(dirs)[0]
    const nr = n.r + dr
    const nc = n.c + dc
    const key = keyFor(nr, nc)
    const count = occupied.get(key) ?? 0
    if (count >= MAX_NUTRIENTS_PER_CELL) {
      // wait in place if blocked by cap
      const stayKey = keyFor(n.r, n.c)
      occupied.set(stayKey, (occupied.get(stayKey) ?? 0) + 1)
      nextNutrients.push({ ...n })
      return
    }

    occupied.set(key, count + 1)
    nextNutrients.push({ ...n, r: nr, c: nc, prev: n.dir, dir: [dr, dc] })
  })

  // Producer spawns
  if (tick % PRODUCE_EVERY === 0) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cell = next[r][c]
        if (cell.state !== 'producer' || !cell.team) continue
        const dirs = wallNeighborDirs(r, c, cell.team)
        if (dirs.length === 0) continue
        const [dr, dc] = shuffled(dirs)[0]
        const nr = r + dr
        const nc = c + dc
        const key = keyFor(nr, nc)
        const count = occupied.get(key) ?? 0
        if (count >= MAX_NUTRIENTS_PER_CELL) continue
        occupied.set(key, count + 1)
        nextNutrients.push({
          id: `${Date.now()}-${r}-${c}-${tick}-${Math.random()}`,
          r: nr,
          c: nc,
          team: cell.team,
          dir: [dr, dc],
        })
      }
    }
  }

  return { grid: next, nutrients: nextNutrients }
}

const CellView = ({
  cell,
  blasting,
  anim,
  nutrient,
  onDrop,
  onDragOver,
  onClick,
}: {
  cell: Cell
  blasting: boolean
  anim?: AnimInfo
  nutrient: boolean
  onDrop: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragOver: (e: React.DragEvent<HTMLButtonElement>) => void
  onClick: () => void
}) => (
  <button
    type="button"
    className={`cell cell-${cell.state} ${blasting ? 'cell-blast' : ''} ${
      anim ? `cell-anim-${anim.type}` : ''
    }`}
    style={
      {
        ...(anim?.dx !== undefined || anim?.dy !== undefined
          ? ({
              ['--dx' as string]: anim.dx ?? 0,
              ['--dy' as string]: anim.dy ?? 0,
            } as React.CSSProperties)
          : {}),
        ...(cell.team
          ? ({
              ['--team-base' as string]: cell.team === 'blue' ? '#4cc3ff' : '#5cf29c',
              ['--team-glow' as string]: cell.team === 'blue' ? '#34d6ff' : '#72ffba',
              ['--team-dark' as string]: cell.team === 'blue' ? '#0c1b2b' : '#10301f',
            } as React.CSSProperties)
          : {}),
      }
    }
    onDrop={onDrop}
    onDragOver={onDragOver}
    onClick={onClick}
    aria-label={`cell ${cell.state}`}
  >
    {nutrient && <span className="nutrient-dot" />}
    {cell.health && cell.health > 0 && (
      <span className={`health health-${Math.min(cell.health, MAX_HEALTH)}`} />
    )}
    {cell.state === 'producer' && <span className="producer-core" />}
  </button>
)

function App() {
  const [grid, setGrid] = useState<Grid>(() => createEmptyGrid())
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(650) // ms per tick
  const [blastCells, setBlastCells] = useState<string[]>([])
  const [cellAnims, setCellAnims] = useState<Record<string, AnimInfo>>({})
  const [selectedTeam, setSelectedTeam] = useState<Team>('blue')
  const [nutrients, setNutrients] = useState<Nutrient[]>([])
  const nutrientsRef = useRef<Nutrient[]>([])
  const nutrientTickRef = useRef(0)
  const blastSet = useMemo(() => new Set(blastCells), [blastCells])
  const nutrientSet = useMemo(
    () => new Set(nutrients.map((n) => keyFor(n.r, n.c))),
    [nutrients],
  )
  const [boardDims, setBoardDims] = useState({ width: 0, height: 0, step: 0, gap: 0 })
  const boardRef = useRef<HTMLDivElement | null>(null)
  const wallSegments = useMemo(() => {
    const segs: { team: Team; x1: number; y1: number; x2: number; y2: number }[] = []
    const step = boardDims.step || 1
    for (let r = 0; r < grid.length; r += 1) {
      for (let c = 0; c < grid[0].length; c += 1) {
        const cell = grid[r][c]
        if (cell.state !== 'block' || !cell.team) continue
        const right = c + 1 < grid[0].length ? grid[r][c + 1] : undefined
        const down = r + 1 < grid.length ? grid[r + 1][c] : undefined
        if (right && right.state === 'block' && right.team === cell.team) {
          segs.push({
            team: cell.team,
            x1: c * step + step / 2,
            y1: r * step + step / 2,
            x2: (c + 1) * step + step / 2,
            y2: r * step + step / 2,
          })
        }
        if (down && down.state === 'block' && down.team === cell.team) {
          segs.push({
            team: cell.team,
            x1: c * step + step / 2,
            y1: r * step + step / 2,
            x2: c * step + step / 2,
            y2: (r + 1) * step + step / 2,
          })
        }
      }
    }
    return segs
  }, [grid, boardDims.step])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setGrid((prev) => {
        const result = stepGrid(prev)
        setBlastCells(result.blasts)
        setCellAnims(result.anims)
        const pruned = pruneNutrients(result.grid, nutrientsRef.current)
        nutrientsRef.current = pruned
        setNutrients(pruned)
        return result.grid
      })
    }, speed)
    return () => clearInterval(id)
  }, [running, speed])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setGrid((prev) => {
        const { grid: g, nutrients: n } = runNutrients(
          prev,
          nutrientsRef.current,
          nutrientTickRef.current,
        )
        nutrientsRef.current = n
        setNutrients(n)
        nutrientTickRef.current += 1
        return g
      })
    }, NUTRIENT_INTERVAL)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    const updateDims = () => {
      const el = boardRef.current
      if (!el) return
      const style = getComputedStyle(el)
      const cellSize = parseFloat(style.getPropertyValue('--cell-size')) || 32
      const gap = parseFloat(style.getPropertyValue('--cell-gap')) || 6
      const step = cellSize + gap
      setBoardDims({
        width: step * COLS - gap,
        height: step * ROWS - gap,
        step,
        gap,
      })
    }
    updateDims()
    window.addEventListener('resize', updateDims)
    return () => window.removeEventListener('resize', updateDims)
  }, [])

  useEffect(() => {
    if (!blastCells.length) return
    const id = setTimeout(() => setBlastCells([]), 420)
    return () => clearTimeout(id)
  }, [blastCells])

  useEffect(() => {
    if (!Object.keys(cellAnims).length) return
    const id = setTimeout(() => setCellAnims({}), 420)
    return () => clearTimeout(id)
  }, [cellAnims])

  const dotCount = useMemo(
    () => grid.flat().filter((cell) => isDotLike(cell)).length,
    [grid],
  )

  const placeDot = (team: Team, r: number, c: number) => {
    setGrid((prev) => {
      if (prev[r][c].state !== 'empty') return prev
      const next = prev.map((row) => row.map((cell) => ({ ...cell })))
      next[r][c] = { state: 'dot', team, health: 0 }
      return next
    })
  }

  const resetGrid = () => {
    setGrid(createEmptyGrid())
    setRunning(false)
    setBlastCells([])
    setCellAnims({})
    setNutrients([])
    nutrientsRef.current = []
    nutrientTickRef.current = 0
  }

  const handleDrop = (
    e: React.DragEvent<HTMLButtonElement>,
    r: number,
    c: number,
  ) => {
    e.preventDefault()
    const producer = e.dataTransfer.getData('producer') === 'true'
    const team = (e.dataTransfer.getData('team') as Team) || selectedTeam
    if (producer) {
      setGrid((prev) => {
        if (prev[r][c].state !== 'empty') return prev
        const next = prev.map((row) => row.map((cell) => ({ ...cell })))
        next[r][c] = { state: 'producer', team, health: 0 }
        return next
      })
    } else {
      placeDot(team, r, c)
    }
  }

  const startDrag = (team: Team) => (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('team', team)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">DOTS SIM</p>
          <h1>Replicator Playground</h1>
          <p className="subhead">
            Click to seed dots. Start the tick loop and watch replication,
            line-of-5 pushes, corner bursts, and block-cracking bombs.
          </p>
        </div>
        <div className="controls">
          <div className="control-row">
            <button
              className="primary"
              onClick={() => setRunning((r) => !r)}
              type="button"
            >
              {running ? 'Pause' : 'Start'}
            </button>
            <button
              className="ghost"
              onClick={() =>
                setGrid((prev) => {
                  const result = stepGrid(prev)
                  setBlastCells(result.blasts)
                  setCellAnims(result.anims)
                  return result.grid
                })
              }
              type="button"
              disabled={running}
            >
              Step once
            </button>
            <button className="ghost" onClick={resetGrid} type="button">
              Reset
            </button>
          </div>
          <div className="control-row slider-row">
            <label htmlFor="speed">Tick speed</label>
            <input
              id="speed"
              type="range"
              min={120}
              max={1500}
              step={30}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <span className="slider-value">{speed} ms</span>
          </div>
          <div className="stats">
            <span>Dots: {dotCount}</span>
          </div>
        </div>
      </header>

      <section className="palette">
        <div className="palette-title">Seed a team</div>
        <div className="palette-items">
          <div
            className={`palette-chip ${selectedTeam === 'blue' ? 'active' : ''}`}
            onClick={() => setSelectedTeam('blue')}
            draggable
            onDragStart={startDrag('blue')}
          >
            <span className="swatch dot blue" />
            Blue culture
          </div>
          <div
            className={`palette-chip ${selectedTeam === 'green' ? 'active' : ''}`}
            onClick={() => setSelectedTeam('green')}
            draggable
            onDragStart={startDrag('green')}
          >
            <span className="swatch dot green" />
            Green culture
          </div>
          <div
            className="palette-chip"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('producer', 'true')
              e.dataTransfer.setData('team', 'blue')
            }}
          >
            <span className="swatch producer blue" />
            Blue producer
          </div>
          <div
            className="palette-chip"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('producer', 'true')
              e.dataTransfer.setData('team', 'green')
            }}
          >
            <span className="swatch producer green" />
            Green producer
          </div>
        </div>
        <p className="palette-hint">
          Drag a chip onto the grid or click a chip then click a cell to place a dot.
        </p>
      </section>

      <main className="board" ref={boardRef}>
        <svg
          className="vessel-overlay"
          width={boardDims.width}
          height={boardDims.height}
          viewBox={`0 0 ${boardDims.width} ${boardDims.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ top: BOARD_PADDING, left: BOARD_PADDING }}
        >
          {wallSegments.map((s, idx) => (
            <line
              key={`${idx}-${s.x1}-${s.y1}-${s.x2}-${s.y2}`}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              className="vessel-line"
              style={{
                stroke: s.team === 'blue' ? '#4cc3ff' : '#5cf29c',
              }}
            />
          ))}
        </svg>
        {grid.map((row, rIdx) => (
          <div className="board-row" key={rIdx} style={{ ['--cols' as string]: COLS }}>
            {row.map((cell, cIdx) => (
              <CellView
                key={`${rIdx}-${cIdx}`}
                cell={cell}
                blasting={blastSet.has(`${rIdx},${cIdx}`)}
                anim={cellAnims[`${rIdx},${cIdx}`]}
                nutrient={nutrientSet.has(`${rIdx},${cIdx}`)}
                onClick={() => placeDot(selectedTeam, rIdx, cIdx)}
                onDrop={(e) => handleDrop(e, rIdx, cIdx)}
                onDragOver={(e) => e.preventDefault()}
              />
            ))}
          </div>
        ))}
      </main>

      <footer className="legend">
        <span className="legend-item">
          <span className="swatch dot" />
          Dot
        </span>
        <span className="legend-item">
          <span className="swatch dot" style={{ background: 'linear-gradient(135deg, #ffd24c, #ffb347)' }} />
          Producer
        </span>
        <span className="legend-item">
          <span className="swatch block" />
          Blocked
        </span>
        <span className="legend-item">
          <span className="swatch bomb" />
          Bomb (armed/hot)
        </span>
        <span className="legend-item">
          <span className="swatch bomb" style={{ background: '#fff' }} />
          Nutrient
        </span>
        <span className="legend-item">
          <span className="swatch empty" />
          Empty
        </span>
      </footer>
    </div>
  )
}

export default App
