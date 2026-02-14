import { TILE_MASK } from './types';
import { SokobanMap } from './SokobanMap';
import { AStarSolver } from './AStarSolver';

/**
 * Seeded PRNG for deterministic puzzle generation.
 * Uses xorshift32 algorithm.
 */
class SeededRandom {
    private state: number;

    constructor(seed: number) {
        this.state = seed | 0 || 1; // Ensure non-zero
    }

    next(): number {
        let x = this.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        this.state = x;
        return (x >>> 0) / 4294967296; // [0, 1)
    }

    /** Returns integer in [min, max] inclusive */
    nextInt(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /** Shuffle array in place */
    shuffle<T>(arr: T[]): T[] {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}

export interface GeneratedLevelMeta {
    worldX: number;
    worldY: number;
    difficulty: number;    // 1-5
    optimalSteps?: number; // filled after validation
}

interface Position {
    x: number;
    y: number;
}

const DIRS: Position[] = [
    { x: 0, y: -1 }, // up
    { x: 0, y: 1 },  // down
    { x: -1, y: 0 }, // left
    { x: 1, y: 0 },  // right
];

/**
 * Generate a sokoban puzzle using reverse-play method.
 * Starts from a solved state and applies reverse moves to create a solvable puzzle.
 */
export function generatePuzzle(
    worldX: number,
    worldY: number,
    mapSeed: number,
    difficulty: number = 1
): { data: number[][], meta: GeneratedLevelMeta } | null {
    // Combine world coordinates and map seed into a unique puzzle seed
    const seed = hashCoords(worldX, worldY, mapSeed);
    const rng = new SeededRandom(seed);

    // Determine room parameters based on difficulty
    const params = getDifficultyParams(difficulty, rng);

    // Try multiple attempts to generate a valid puzzle
    for (let attempt = 0; attempt < 40; attempt++) {
        const result = tryGenerate(rng, params, difficulty);
        if (result) {
            return {
                data: result.data,
                meta: {
                    worldX,
                    worldY,
                    difficulty,
                    optimalSteps: result.optimalSteps,
                }
            };
        }
    }

    // Fallback: return a simple 2-box puzzle
    return {
        data: [
            [1, 1, 1, 1, 1],
            [1, 0, 8, 0, 1],
            [1, 4, 2, 0, 1],
            [1, 0, 2, 8, 1],
            [1, 1, 1, 1, 1],
        ],
        meta: { worldX, worldY, difficulty, optimalSteps: 3 }
    };
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

interface DifficultyParams {
    width: number;
    height: number;
    numBoxes: number;
    numInternalWalls: number;
    minSolutionSteps: number;
    maxSolutionSteps: number;
    reverseMoves: number;
    minNodes: number;       // minimum A* expanded nodes (complexity floor)
    maxNodes: number;       // maximum A* expanded nodes (complexity ceiling)
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

function tryGenerate(
    rng: SeededRandom,
    params: DifficultyParams,
    _difficulty: number
): { data: number[][], optimalSteps: number } | null {
    const { width, height, numBoxes, numInternalWalls, reverseMoves } = params;

    // 1. Create room with border walls
    const grid: number[][] = [];
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                grid[y][x] = TILE_MASK.WALL;
            } else {
                grid[y][x] = 0;
            }
        }
    }

    // 2. Collect interior cells
    const interior: Position[] = [];
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            interior.push({ x, y });
        }
    }
    rng.shuffle(interior);

    // 3. Place internal walls (ensure connectivity)
    let wallsPlaced = 0;
    for (const pos of interior) {
        if (wallsPlaced >= numInternalWalls) break;
        grid[pos.y][pos.x] = TILE_MASK.WALL;
        if (isConnected(grid, width, height)) {
            wallsPlaced++;
        } else {
            grid[pos.y][pos.x] = 0; // Revert if disconnects
        }
    }

    // 4. Collect empty cells
    const emptyCells: Position[] = [];
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            if (grid[y][x] === 0) emptyCells.push({ x, y });
        }
    }
    rng.shuffle(emptyCells);

    if (emptyCells.length < numBoxes + 1) return null; // Not enough space

    // 5. Place boxes on goals (solved state)
    const goalPositions: Position[] = emptyCells.slice(0, numBoxes);
    const playerStart = emptyCells[numBoxes];

    // Set up solved state: boxes on goals
    for (const g of goalPositions) {
        grid[g.y][g.x] = TILE_MASK.BOX | TILE_MASK.GOAL;
    }
    grid[playerStart.y][playerStart.x] = TILE_MASK.PLAYER;

    // 6. Apply reverse moves to scramble
    let playerPos = { ...playerStart };
    const boxPositions = goalPositions.map(g => ({ ...g }));

    // Track best state (most moves from solved)
    let bestGrid: number[][] | null = null;
    let bestDistance = 0;

    for (let i = 0; i < reverseMoves; i++) {
        // Pick a random box and direction
        const boxIdx = rng.nextInt(0, boxPositions.length - 1);
        const dirIdx = rng.nextInt(0, 3);
        const dir = DIRS[dirIdx];
        const box = boxPositions[boxIdx];

        // Reverse move: player needs to be at box + dir, box moves to box - dir
        const playerNeeded = { x: box.x + dir.x, y: box.y + dir.y };
        const boxDest = { x: box.x - dir.x, y: box.y - dir.y };

        // Check bounds and obstacles
        if (!isInBounds(playerNeeded, width, height) || !isInBounds(boxDest, width, height)) continue;
        if (grid[playerNeeded.y][playerNeeded.x] & TILE_MASK.WALL) continue;
        if (grid[boxDest.y][boxDest.x] & TILE_MASK.WALL) continue;

        // Check no other box at destinations
        const boxAtPlayerNeeded = boxPositions.some((b, idx) => idx !== boxIdx && b.x === playerNeeded.x && b.y === playerNeeded.y);
        const boxAtDest = boxPositions.some((b, idx) => idx !== boxIdx && b.x === boxDest.x && b.y === boxDest.y);
        if (boxAtPlayerNeeded || boxAtDest) continue;

        // Check player can reach playerNeeded position
        if (playerPos.x !== playerNeeded.x || playerPos.y !== playerNeeded.y) {
            if (!canReach(grid, playerPos, playerNeeded, boxPositions, width, height)) continue;
        }

        // Apply reverse move
        boxPositions[boxIdx] = boxDest;
        playerPos = { x: box.x, y: box.y }; // Player ends where box was

        // Calculate total displacement from goals
        let totalDist = 0;
        for (let b = 0; b < boxPositions.length; b++) {
            totalDist += Math.abs(boxPositions[b].x - goalPositions[b].x) +
                         Math.abs(boxPositions[b].y - goalPositions[b].y);
        }

        if (totalDist > bestDistance) {
            bestDistance = totalDist;
            // Build grid snapshot
            bestGrid = buildGrid(grid, width, height, goalPositions, boxPositions, playerPos);
        }
    }

    if (!bestGrid || bestDistance === 0) return null;

    // 7. Validate with AStarSolver
    const map = new SokobanMap(bestGrid);
    const solver = new AStarSolver(map);
    const result = solver.solve(10000);

    if (result.status !== 'solved' || !result.path) return null;

    const steps = result.path.length;
    if (steps < params.minSolutionSteps || steps > params.maxSolutionSteps) return null;

    // Filter by A* search complexity (deterministic cross-platform metric)
    if (result.nodesExpanded < params.minNodes || result.nodesExpanded > params.maxNodes) return null;

    return { data: bestGrid, optimalSteps: steps };
}

function buildGrid(
    baseGrid: number[][],
    width: number,
    height: number,
    goals: Position[],
    boxes: Position[],
    player: Position
): number[][] {
    const grid: number[][] = [];
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            // Copy walls only
            grid[y][x] = baseGrid[y][x] & TILE_MASK.WALL;
        }
    }

    // Place goals
    for (const g of goals) {
        grid[g.y][g.x] |= TILE_MASK.GOAL;
    }

    // Place boxes
    for (const b of boxes) {
        grid[b.y][b.x] |= TILE_MASK.BOX;
    }

    // Place player
    grid[player.y][player.x] |= TILE_MASK.PLAYER;

    return grid;
}

function isInBounds(pos: Position, width: number, height: number): boolean {
    return pos.x >= 1 && pos.x < width - 1 && pos.y >= 1 && pos.y < height - 1;
}

/** BFS to check if player can reach target without crossing walls or boxes */
function canReach(
    grid: number[][],
    from: Position,
    to: Position,
    boxes: Position[],
    width: number,
    height: number
): boolean {
    const boxSet = new Set(boxes.map(b => `${b.x},${b.y}`));
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

/** Check that all empty cells in the grid are connected (flood fill) */
function isConnected(grid: number[][], width: number, height: number): boolean {
    // Find first empty cell
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

    // BFS from start
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
