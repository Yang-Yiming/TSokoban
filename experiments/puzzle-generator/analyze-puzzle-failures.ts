import { TILE_MASK } from '../../src/game/types';
import { SokobanMap } from '../../src/game/SokobanMap';
import { AStarSolver } from '../../src/game/AStarSolver';

type Position = { x: number; y: number };

type GeneratedLevelMeta = {
  worldX: number;
  worldY: number;
  difficulty: number;
  optimalSteps?: number;
};

type DifficultyParams = {
  width: number;
  height: number;
  numBoxes: number;
  numInternalWalls: number;
  minSolutionSteps: number;
  maxSolutionSteps: number;
  reverseMoves: number;
  minNodes: number;
  maxNodes: number;
};

type FailReason =
  | 'not_enough_space'
  | 'no_reverse_progress'
  | 'astar_unsolved_or_no_path'
  | 'steps_too_short'
  | 'steps_too_long'
  | 'nodes_too_low'
  | 'nodes_too_high';

type AttemptResult =
  | { ok: true; data: number[][]; optimalSteps: number }
  | { ok: false; reason: FailReason };

const DIRS: Position[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0 || 1;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.state = x;
    return (x >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

function hashCoords(x: number, y: number, seed: number): number {
  let h = seed | 0;
  h = ((h << 5) - h + x) | 0;
  h = ((h << 5) - h + y) | 0;
  h ^= h << 13;
  h ^= h >> 7;
  h ^= h << 17;
  return h;
}

function getDifficultyParams(difficulty: number, rng: SeededRandom): DifficultyParams {
  switch (difficulty) {
    case 1:
      return {
        width: rng.nextInt(5, 7),
        height: rng.nextInt(5, 7),
        numBoxes: 2,
        numInternalWalls: rng.nextInt(2, 4),
        minSolutionSteps: 6,
        maxSolutionSteps: 20,
        reverseMoves: 50,
        minNodes: 20,
        maxNodes: 3000,
      };
    case 2:
      return {
        width: rng.nextInt(6, 7),
        height: rng.nextInt(6, 7),
        numBoxes: 2,
        numInternalWalls: rng.nextInt(3, 5),
        minSolutionSteps: 10,
        maxSolutionSteps: 30,
        reverseMoves: 70,
        minNodes: 40,
        maxNodes: 5000,
      };
    case 3:
      return {
        width: rng.nextInt(6, 8),
        height: rng.nextInt(6, 8),
        numBoxes: rng.nextInt(2, 3),
        numInternalWalls: rng.nextInt(3, 6),
        minSolutionSteps: 12,
        maxSolutionSteps: 35,
        reverseMoves: 100,
        minNodes: 60,
        maxNodes: 7000,
      };
    case 4:
      return {
        width: rng.nextInt(7, 8),
        height: rng.nextInt(7, 8),
        numBoxes: 3,
        numInternalWalls: rng.nextInt(4, 7),
        minSolutionSteps: 15,
        maxSolutionSteps: 40,
        reverseMoves: 120,
        minNodes: 100,
        maxNodes: 8000,
      };
    case 5:
    default:
      return {
        width: rng.nextInt(7, 9),
        height: rng.nextInt(7, 9),
        numBoxes: rng.nextInt(3, 4),
        numInternalWalls: rng.nextInt(5, 8),
        minSolutionSteps: 18,
        maxSolutionSteps: 50,
        reverseMoves: 150,
        minNodes: 150,
        maxNodes: 9000,
      };
  }
}

function isInBounds(pos: Position, width: number, height: number): boolean {
  return pos.x >= 1 && pos.x < width - 1 && pos.y >= 1 && pos.y < height - 1;
}

function buildGrid(
  baseGrid: number[][],
  width: number,
  height: number,
  goals: Position[],
  boxes: Position[],
  player: Position,
): number[][] {
  const grid: number[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = baseGrid[y][x] & TILE_MASK.WALL;
    }
  }

  for (const g of goals) grid[g.y][g.x] |= TILE_MASK.GOAL;
  for (const b of boxes) grid[b.y][b.x] |= TILE_MASK.BOX;
  grid[player.y][player.x] |= TILE_MASK.PLAYER;

  return grid;
}

function canReach(
  grid: number[][],
  from: Position,
  to: Position,
  boxes: Position[],
  width: number,
  height: number,
): boolean {
  const boxSet = new Set(boxes.map((b) => `${b.x},${b.y}`));
  const visited = new Set<string>();
  const queue: Position[] = [from];
  visited.add(`${from.x},${from.y}`);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr.x === to.x && curr.y === to.y) return true;

    for (const dir of DIRS) {
      const nx = curr.x + dir.x;
      const ny = curr.y + dir.y;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (grid[ny][nx] & TILE_MASK.WALL) continue;
      if (boxSet.has(key)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  return false;
}

function isConnected(grid: number[][], width: number, height: number): boolean {
  let start: Position | null = null;
  let emptyCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid[y][x] === 0) {
        emptyCount++;
        if (!start) start = { x, y };
      }
    }
  }
  if (!start || emptyCount <= 1) return true;

  const visited = new Set<string>();
  const queue: Position[] = [start];
  visited.add(`${start.x},${start.y}`);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const dir of DIRS) {
      const nx = curr.x + dir.x;
      const ny = curr.y + dir.y;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (nx < 1 || nx >= width - 1 || ny < 1 || ny >= height - 1) continue;
      if (grid[ny][nx] !== 0) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  return visited.size === emptyCount;
}

function tryGenerateWithReason(rng: SeededRandom, params: DifficultyParams): AttemptResult {
  const { width, height, numBoxes, numInternalWalls, reverseMoves } = params;

  const grid: number[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = x === 0 || x === width - 1 || y === 0 || y === height - 1 ? TILE_MASK.WALL : 0;
    }
  }

  const interior: Position[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      interior.push({ x, y });
    }
  }
  rng.shuffle(interior);

  let wallsPlaced = 0;
  for (const pos of interior) {
    if (wallsPlaced >= numInternalWalls) break;
    grid[pos.y][pos.x] = TILE_MASK.WALL;
    if (isConnected(grid, width, height)) {
      wallsPlaced++;
    } else {
      grid[pos.y][pos.x] = 0;
    }
  }

  const emptyCells: Position[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid[y][x] === 0) emptyCells.push({ x, y });
    }
  }
  rng.shuffle(emptyCells);

  if (emptyCells.length < numBoxes + 1) {
    return { ok: false, reason: 'not_enough_space' };
  }

  const goalPositions = emptyCells.slice(0, numBoxes);
  const playerStart = emptyCells[numBoxes];

  for (const g of goalPositions) grid[g.y][g.x] = TILE_MASK.BOX | TILE_MASK.GOAL;
  grid[playerStart.y][playerStart.x] = TILE_MASK.PLAYER;

  let playerPos = { ...playerStart };
  const boxPositions = goalPositions.map((g) => ({ ...g }));

  let bestGrid: number[][] | null = null;
  let bestDistance = 0;

  for (let i = 0; i < reverseMoves; i++) {
    const boxIdx = rng.nextInt(0, boxPositions.length - 1);
    const dir = DIRS[rng.nextInt(0, 3)];
    const box = boxPositions[boxIdx];

    const playerNeeded = { x: box.x + dir.x, y: box.y + dir.y };
    const boxDest = { x: box.x - dir.x, y: box.y - dir.y };

    if (!isInBounds(playerNeeded, width, height) || !isInBounds(boxDest, width, height)) continue;
    if (grid[playerNeeded.y][playerNeeded.x] & TILE_MASK.WALL) continue;
    if (grid[boxDest.y][boxDest.x] & TILE_MASK.WALL) continue;

    const boxAtPlayerNeeded = boxPositions.some(
      (b, idx) => idx !== boxIdx && b.x === playerNeeded.x && b.y === playerNeeded.y,
    );
    const boxAtDest = boxPositions.some((b, idx) => idx !== boxIdx && b.x === boxDest.x && b.y === boxDest.y);
    if (boxAtPlayerNeeded || boxAtDest) continue;

    if (playerPos.x !== playerNeeded.x || playerPos.y !== playerNeeded.y) {
      if (!canReach(grid, playerPos, playerNeeded, boxPositions, width, height)) continue;
    }

    boxPositions[boxIdx] = boxDest;
    playerPos = { x: box.x, y: box.y };

    let totalDist = 0;
    for (let b = 0; b < boxPositions.length; b++) {
      totalDist += Math.abs(boxPositions[b].x - goalPositions[b].x) + Math.abs(boxPositions[b].y - goalPositions[b].y);
    }

    if (totalDist > bestDistance) {
      bestDistance = totalDist;
      bestGrid = buildGrid(grid, width, height, goalPositions, boxPositions, playerPos);
    }
  }

  if (!bestGrid || bestDistance === 0) {
    return { ok: false, reason: 'no_reverse_progress' };
  }

  const map = new SokobanMap(bestGrid);
  const solver = new AStarSolver(map);
  const result = solver.solve(10000);

  if (result.status !== 'solved' || !result.path) {
    return { ok: false, reason: 'astar_unsolved_or_no_path' };
  }

  const steps = result.path.length;
  if (steps < params.minSolutionSteps) {
    return { ok: false, reason: 'steps_too_short' };
  }
  if (steps > params.maxSolutionSteps) {
    return { ok: false, reason: 'steps_too_long' };
  }

  if (result.nodesExpanded < params.minNodes) {
    return { ok: false, reason: 'nodes_too_low' };
  }
  if (result.nodesExpanded > params.maxNodes) {
    return { ok: false, reason: 'nodes_too_high' };
  }

  return { ok: true, data: bestGrid, optimalSteps: steps };
}

function generatePuzzleWithDiagnostics(
  worldX: number,
  worldY: number,
  mapSeed: number,
  difficulty: number,
) {
  const seed = hashCoords(worldX, worldY, mapSeed);
  const rng = new SeededRandom(seed);
  const params = getDifficultyParams(difficulty, rng);

  const attemptReasons: Record<FailReason, number> = {
    not_enough_space: 0,
    no_reverse_progress: 0,
    astar_unsolved_or_no_path: 0,
    steps_too_short: 0,
    steps_too_long: 0,
    nodes_too_low: 0,
    nodes_too_high: 0,
  };

  for (let attempt = 0; attempt < 40; attempt++) {
    const res = tryGenerateWithReason(rng, params);
    if (res.ok) {
      return {
        success: true,
        data: res.data,
        meta: {
          worldX,
          worldY,
          difficulty,
          optimalSteps: res.optimalSteps,
        } satisfies GeneratedLevelMeta,
        attemptReasons,
      };
    }
    attemptReasons[res.reason]++;
  }

  return {
    success: false,
    data: [
      [1, 1, 1, 1, 1],
      [1, 0, 8, 0, 1],
      [1, 4, 2, 0, 1],
      [1, 0, 2, 8, 1],
      [1, 1, 1, 1, 1],
    ],
    meta: { worldX, worldY, difficulty, optimalSteps: 3 } satisfies GeneratedLevelMeta,
    attemptReasons,
  };
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function sortedReasons(record: Record<FailReason, number>): Array<[FailReason, number]> {
  return (Object.entries(record) as Array<[FailReason, number]>).sort((a, b) => b[1] - a[1]);
}

function run() {
  const seeds = [0, 1, 7, 53, 97, 12345, -42];
  const coords = range(-20, 20)
    .flatMap((x) => range(-20, 20).map((y) => ({ x, y })))
    .filter(({ x, y }) => (Math.abs(x) + Math.abs(y)) % 4 === 0);
  const difficulties = [1, 2, 3, 4, 5];

  const totalSamples = seeds.length * coords.length * difficulties.length;

  const byDifficulty = new Map<number, {
    totalSamples: number;
    fallbackSamples: number;
    successSamples: number;
    totalAttemptsFailed: number;
    reasons: Record<FailReason, number>;
  }>();

  const overallReasons: Record<FailReason, number> = {
    not_enough_space: 0,
    no_reverse_progress: 0,
    astar_unsolved_or_no_path: 0,
    steps_too_short: 0,
    steps_too_long: 0,
    nodes_too_low: 0,
    nodes_too_high: 0,
  };

  let fallbackSamples = 0;
  let successSamples = 0;
  let totalAttemptsFailed = 0;

  for (const d of difficulties) {
    byDifficulty.set(d, {
      totalSamples: 0,
      fallbackSamples: 0,
      successSamples: 0,
      totalAttemptsFailed: 0,
      reasons: {
        not_enough_space: 0,
        no_reverse_progress: 0,
        astar_unsolved_or_no_path: 0,
        steps_too_short: 0,
        steps_too_long: 0,
        nodes_too_low: 0,
        nodes_too_high: 0,
      },
    });
  }

  for (const seed of seeds) {
    for (const { x, y } of coords) {
      for (const difficulty of difficulties) {
        const result = generatePuzzleWithDiagnostics(x, y, seed, difficulty);

        const dStats = byDifficulty.get(difficulty)!;
        dStats.totalSamples++;

        const reasons = result.attemptReasons;
        let failedAttemptsForSample = 0;
        for (const [reason, count] of Object.entries(reasons) as Array<[FailReason, number]>) {
          overallReasons[reason] += count;
          dStats.reasons[reason] += count;
          failedAttemptsForSample += count;
        }

        totalAttemptsFailed += failedAttemptsForSample;
        dStats.totalAttemptsFailed += failedAttemptsForSample;

        if (result.success) {
          successSamples++;
          dStats.successSamples++;
        } else {
          fallbackSamples++;
          dStats.fallbackSamples++;
        }
      }
    }
  }

  console.log('=== Puzzle Generator Failure Analysis ===');
  console.log(`Total samples: ${totalSamples}`);
  console.log(`Success samples: ${successSamples}`);
  console.log(`Fallback samples: ${fallbackSamples}`);
  console.log(`Fallback rate: ${((fallbackSamples / totalSamples) * 100).toFixed(2)}%`);
  console.log(`Total failed attempts before success/fallback: ${totalAttemptsFailed}`);
  console.log('');

  console.log('Overall failed-attempt reason distribution:');
  for (const [reason, count] of sortedReasons(overallReasons)) {
    const ratio = totalAttemptsFailed > 0 ? ((count / totalAttemptsFailed) * 100).toFixed(2) : '0.00';
    console.log(`  ${reason}: ${count} (${ratio}%)`);
  }

  console.log('');
  console.log('By difficulty:');
  for (const d of difficulties) {
    const s = byDifficulty.get(d)!;
    console.log(`\n  D${d}`);
    console.log(`    samples: ${s.totalSamples}, success: ${s.successSamples}, fallback: ${s.fallbackSamples} (${((s.fallbackSamples / s.totalSamples) * 100).toFixed(2)}%)`);
    console.log(`    failed attempts: ${s.totalAttemptsFailed}`);

    const ranked = sortedReasons(s.reasons);
    for (const [reason, count] of ranked) {
      const ratio = s.totalAttemptsFailed > 0 ? ((count / s.totalAttemptsFailed) * 100).toFixed(2) : '0.00';
      console.log(`      - ${reason}: ${count} (${ratio}%)`);
    }
  }
}

run();
