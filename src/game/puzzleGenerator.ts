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

interface ReverseMove {
    boxIdx: number;
    dirIdx: number;
    prevBoxPos: Position;
    prevPlayerPos: Position;
    stateKey: string;
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

    // All attempts failed — signal that no puzzle could be generated
    return null;
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
}

function getDifficultyParams(difficulty: number, rng: SeededRandom): DifficultyParams {
    switch (difficulty) {
        case 1:
            return {
                width:  rng.nextInt(8, 9),
                height: rng.nextInt(8, 9),
                numBoxes: 2,
                numInternalWalls: rng.nextInt(2, 4),
                minSolutionSteps: 6,
                maxSolutionSteps: 28,
                reverseMoves: 100,
            };
        case 2:
            return {
                width:  rng.nextInt(8, 9),
                height: rng.nextInt(8, 9),
                numBoxes: 2,
                numInternalWalls: rng.nextInt(3, 5),
                minSolutionSteps: 12,
                maxSolutionSteps: 40,
                reverseMoves: 130,
            };
        case 3:
            return {
                width:  rng.nextInt(9, 10),
                height: rng.nextInt(9, 10),
                numBoxes: rng.nextInt(2, 3),
                numInternalWalls: rng.nextInt(3, 6),
                minSolutionSteps: 18,
                maxSolutionSteps: 55,
                reverseMoves: 160,
            };
        case 4:
            return {
                width:  rng.nextInt(9, 10),
                height: rng.nextInt(9, 10),
                numBoxes: 3,
                numInternalWalls: rng.nextInt(4, 7),
                minSolutionSteps: 25,
                maxSolutionSteps: 70,
                reverseMoves: 200,
            };
        case 5:
        default:
            return {
                width:  rng.nextInt(9, 11),
                height: rng.nextInt(9, 11),
                numBoxes: rng.nextInt(3, 4),
                numInternalWalls: rng.nextInt(5, 8),
                minSolutionSteps: 30,
                maxSolutionSteps: 90,
                reverseMoves: 250,
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

    // 4. Collect cells for goal placement: prefer inner zone (\u22652 from border) to
    //    maximise the "live" area that the dead-square analysis will mark reachable.
    const innerCells: Position[] = [];
    const outerCells: Position[] = [];
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            if (grid[y][x] !== 0) continue;
            if (x >= 2 && x < width - 2 && y >= 2 && y < height - 2) {
                innerCells.push({ x, y });
            } else {
                outerCells.push({ x, y });
            }
        }
    }
    rng.shuffle(innerCells);
    rng.shuffle(outerCells);

    // Use inner cells for goals when possible; fall back to outer cells if needed.
    const candidateCells = innerCells.length >= numBoxes + 1
        ? innerCells
        : [...innerCells, ...outerCells];

    if (candidateCells.length < numBoxes + 1) return null; // Not enough space

    // 5. Place boxes on goals (solved state)
    const goalPositions: Position[] = candidateCells.slice(0, numBoxes);
    const playerStart = candidateCells[numBoxes];

    // Set up solved state: boxes on goals
    for (const g of goalPositions) {
        grid[g.y][g.x] = TILE_MASK.BOX | TILE_MASK.GOAL;
    }
    grid[playerStart.y][playerStart.x] = TILE_MASK.PLAYER;

    // 6. Apply reverse moves to scramble (with backtracking + deadlock checks)
    let playerPos = { ...playerStart };
    const boxPositions = goalPositions.map(g => ({ ...g }));
    const goalSet = new Set(goalPositions.map(g => `${g.x},${g.y}`));

    // Precompute static dead squares (walls-only analysis) so we don't push
    // boxes into positions the AStarSolver would correctly flag as unsolvable.
    const staticDeadSquares = computeStaticDeadSquares(grid, width, height, goalPositions);

    const moveHistory: ReverseMove[] = [];
    const forbiddenMoves = new Set<string>();
    const maxIterations = reverseMoves * 80;

    // Track best state (most moves from solved)
    let bestGrid: number[][] | null = null;
    let bestDistance = 0;

    const allCandidates: Array<{ boxIdx: number; dirIdx: number }> = [];
    for (let boxIdx = 0; boxIdx < boxPositions.length; boxIdx++) {
        for (let dirIdx = 0; dirIdx < DIRS.length; dirIdx++) {
            allCandidates.push({ boxIdx, dirIdx });
        }
    }

    for (let iter = 0; iter < maxIterations; iter++) {
        const stateKey = getStateKey(boxPositions, playerPos);
        const candidates = rng.shuffle([...allCandidates]);
        let applied = false;

        for (const candidate of candidates) {
            const moveKey = `${stateKey}|${candidate.boxIdx}|${candidate.dirIdx}`;
            if (forbiddenMoves.has(moveKey)) continue;

            const box = boxPositions[candidate.boxIdx];
            const dir = DIRS[candidate.dirIdx];

            // Reverse move: player needs to be at box + dir, box moves to box - dir
            const playerNeeded = { x: box.x + dir.x, y: box.y + dir.y };
            const boxDest = { x: box.x - dir.x, y: box.y - dir.y };

            if (!isInBounds(playerNeeded, width, height) || !isInBounds(boxDest, width, height)) {
                forbiddenMoves.add(moveKey);
                continue;
            }
            if (grid[playerNeeded.y][playerNeeded.x] & TILE_MASK.WALL) {
                forbiddenMoves.add(moveKey);
                continue;
            }
            if (grid[boxDest.y][boxDest.x] & TILE_MASK.WALL) {
                forbiddenMoves.add(moveKey);
                continue;
            }

            // Check no other box at destinations
            const boxAtPlayerNeeded = boxPositions.some((b, idx) => idx !== candidate.boxIdx && b.x === playerNeeded.x && b.y === playerNeeded.y);
            const boxAtDest = boxPositions.some((b, idx) => idx !== candidate.boxIdx && b.x === boxDest.x && b.y === boxDest.y);
            if (boxAtPlayerNeeded || boxAtDest) {
                forbiddenMoves.add(moveKey);
                continue;
            }

            // Check player can reach playerNeeded position
            if (playerPos.x !== playerNeeded.x || playerPos.y !== playerNeeded.y) {
                if (!canReach(grid, playerPos, playerNeeded, boxPositions, width, height)) {
                    forbiddenMoves.add(moveKey);
                    continue;
                }
            }

            const prevBoxPos = { ...box };
            const prevPlayerPos = { ...playerPos };

            // Apply reverse move
            boxPositions[candidate.boxIdx] = boxDest;
            playerPos = { x: box.x, y: box.y }; // Player ends where box was

            // Deadlock check: corner, 2×2 freeze, and static dead squares.
            if (hasDeadlock(grid, width, height, goalSet, boxPositions, staticDeadSquares)) {
                boxPositions[candidate.boxIdx] = prevBoxPos;
                playerPos = prevPlayerPos;
                forbiddenMoves.add(moveKey);
                continue;
            }

            moveHistory.push({
                boxIdx: candidate.boxIdx,
                dirIdx: candidate.dirIdx,
                prevBoxPos,
                prevPlayerPos,
                stateKey,
            });

            // Calculate total displacement from goals
            let totalDist = 0;
            for (let b = 0; b < boxPositions.length; b++) {
                totalDist += Math.abs(boxPositions[b].x - goalPositions[b].x) +
                             Math.abs(boxPositions[b].y - goalPositions[b].y);
            }

            if (totalDist > bestDistance) {
                bestDistance = totalDist;
                bestGrid = buildGrid(grid, width, height, goalPositions, boxPositions, playerPos);
            }

            applied = true;
            break;
        }

        if (applied) {
            if (moveHistory.length >= reverseMoves) break;
            continue;
        }

        // Dead end: backtrack one step and forbid repeating that step from parent state
        if (moveHistory.length === 0) break;
        const lastMove = moveHistory.pop()!;
        boxPositions[lastMove.boxIdx] = lastMove.prevBoxPos;
        playerPos = lastMove.prevPlayerPos;
        forbiddenMoves.add(`${lastMove.stateKey}|${lastMove.boxIdx}|${lastMove.dirIdx}`);
    }

    if (!bestGrid || bestDistance === 0) return null;


    // 7. Validate with AStarSolver
    const map = new SokobanMap(bestGrid);
    const solver = new AStarSolver(map);
    const result = solver.solve(200000);

    if (result.status !== 'solved' || !result.path) return null;

    const steps = result.path.length;
    if (steps < params.minSolutionSteps || steps > params.maxSolutionSteps) return null;

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

function getStateKey(boxes: Position[], player: Position): string {
    const sortedBoxes = boxes
        .map(b => `${b.x},${b.y}`)
        .sort()
        .join('|');
    return `${player.x},${player.y}#${sortedBoxes}`;
}

/**
 * Compute "static dead squares" — cells from which a box can never reach
 * any goal, ignoring other boxes.  Uses the same BFS-backwards-from-goals
 * logic as AStarSolver.computeDeadSquares.
 */
function computeStaticDeadSquares(
    grid: number[][],
    width: number,
    height: number,
    goals: Position[]
): Set<string> {
    const live = new Set<string>();
    const queue: Position[] = [];

    for (const g of goals) {
        const key = `${g.x},${g.y}`;
        if (!live.has(key)) { live.add(key); queue.push({ ...g }); }
    }

    let qi = 0;
    while (qi < queue.length) {
        const curr = queue[qi++];
        for (const dir of DIRS) {
            // Reverse-push: box ends at curr, was at prev = curr - dir,
            // player was at playerCell = curr - 2*dir
            const prevX = curr.x - dir.x, prevY = curr.y - dir.y;
            const plX   = curr.x - 2 * dir.x, plY = curr.y - 2 * dir.y;
            if (prevX < 0 || prevX >= width  || prevY < 0 || prevY >= height)  continue;
            if (plX   < 0 || plX   >= width  || plY   < 0 || plY   >= height)  continue;
            if (grid[prevY][prevX] & TILE_MASK.WALL) continue;
            if (grid[plY][plX]     & TILE_MASK.WALL) continue;
            const key = `${prevX},${prevY}`;
            if (!live.has(key)) { live.add(key); queue.push({ x: prevX, y: prevY }); }
        }
    }

    const dead = new Set<string>();
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            if (!(grid[y][x] & TILE_MASK.WALL)) {
                const key = `${x},${y}`;
                if (!live.has(key)) dead.add(key);
            }
        }
    }
    return dead;
}

function hasDeadlock(
    grid: number[][],
    width: number,
    height: number,
    goalSet: Set<string>,
    boxes: Position[],
    deadSquares: Set<string>
): boolean {
    const boxSet = new Set(boxes.map(b => `${b.x},${b.y}`));

    for (const box of boxes) {
        if (isDeadlockedBox(grid, width, height, goalSet, boxSet, box, deadSquares)) {
            return true;
        }
    }

    return false;
}

function isDeadlockedBox(
    grid: number[][],
    width: number,
    height: number,
    goalSet: Set<string>,
    boxSet: Set<string>,
    box: Position,
    deadSquares: Set<string>
): boolean {
    const key = `${box.x},${box.y}`;
    if (goalSet.has(key)) return false;

    // Static dead-square: cell from which no push sequence can reach any goal
    if (deadSquares.has(key)) return true;

    const blocked = (x: number, y: number): boolean => {
        if (x < 0 || x >= width || y < 0 || y >= height) return true;
        if (grid[y][x] & TILE_MASK.WALL) return true;
        return boxSet.has(`${x},${y}`);
    };

    // Classic corner deadlock for non-goal boxes
    const up = blocked(box.x, box.y - 1);
    const down = blocked(box.x, box.y + 1);
    const left = blocked(box.x - 1, box.y);
    const right = blocked(box.x + 1, box.y);

    if ((up && left) || (up && right) || (down && left) || (down && right)) {
        return true;
    }

    // 2x2 freeze pattern with no goals in the block
    const offsets = [
        { ox: -1, oy: -1 },
        { ox: -1, oy: 0 },
        { ox: 0, oy: -1 },
        { ox: 0, oy: 0 },
    ];

    for (const { ox, oy } of offsets) {
        const cells = [
            { x: box.x + ox, y: box.y + oy },
            { x: box.x + ox + 1, y: box.y + oy },
            { x: box.x + ox, y: box.y + oy + 1 },
            { x: box.x + ox + 1, y: box.y + oy + 1 },
        ];

        const hasGoal = cells.some(c => goalSet.has(`${c.x},${c.y}`));
        if (hasGoal) continue;

        const allBlocked = cells.every(c => blocked(c.x, c.y));
        if (allBlocked) {
            return true;
        }
    }

    return false;
}
