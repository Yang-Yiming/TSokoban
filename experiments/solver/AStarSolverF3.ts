/**
 * AStarSolverF3 — hard-level solver focused on higher solve rate
 *
 * Adds on top of F1 (Weighted A* + frozen-box deadlock):
 *
 * 8. BFS push-distance heuristic  (tighter lower bound)
 *    For each goal cell, we precompute the minimum number of push steps a
 *    single box would need to reach that goal from every other cell, using
 *    a reverse-BFS through valid (wall-only) push moves.  This is identical
 *    to the standard "box BFS distance" used in strong Sokoban solvers.
 *
 *    Compared to Manhattan distance:
 *    • Respects walls — a box in a dead-end corridor has a much higher cost.
 *    • Returns INFINITY (INT32_MAX) for truly unreachable cells — these
 *      are already flagged as dead squares, so in practice the matching
 *      heuristic just sees a very large penalty.
 *    • Costs at most O(goals × W × H) to precompute, stored as a flat
 *      Int32Array per goal.
 *
 *    The bipartite matching then uses push-dist instead of Manhattan dist,
 *    giving a strictly tighter admissible lower bound.
 *
 * All other optimisations inherited from F1 / V2:
 *   • Macro-moves (push-only expansion)
 *   • Push ordering (goal / distance-improving pushes first)
 *   • Conservative corral-lite pruning for wall-isolated static chambers
 *   • Bipartite deadlock pruning (safe perfect-matching feasibility check)
 *   • Canonical player position (reachable-zone normalisation)
 *   • Integer cell indices everywhere
 *   • Binary min-heap priority queue
 *   • Static dead-square table (precomputed reverse-BFS)
 *   • 2×2 block deadlock detection
 *   • Frozen-box deadlock detection (recursive, cycle-safe)
 *   • Weighted A*  (f = g + weight × h, default weight = 1.5)
 *
 * API:
 *   new AStarSolverF3(map, weight?)   // weight defaults to 1.5
 *   solver.solve(maxNodes?)           → SolverResult
 */

import { SokobanMap } from '../../src/game/SokobanMap';

export interface SolverResult {
    status: 'solved' | 'unsolvable' | 'limit-reached';
    path?: string;
    nodesExpanded: number;
}

// ─── Direction constants ──────────────────────────────────────────────────────
const DIRS = [
    { dx:  0, dy: -1, ch: 'w' },
    { dx:  0, dy:  1, ch: 's' },
    { dx: -1, dy:  0, ch: 'a' },
    { dx:  1, dy:  0, ch: 'd' },
] as const;

// ─── MinHeap ──────────────────────────────────────────────────────────────────
class MinHeap {
    private keys: Float64Array;
    private vals: SearchNode[];
    private _size = 0;

    constructor(cap = 65536) {
        this.keys = new Float64Array(cap);
        this.vals = new Array(cap);
    }

    get size() { return this._size; }

    push(f: number, node: SearchNode): void {
        if (this._size >= this.keys.length) this.grow();
        let i = this._size++;
        this.keys[i] = f;
        this.vals[i] = node;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.keys[p] <= this.keys[i]) break;
            this.swap(i, p);
            i = p;
        }
    }

    pop(): SearchNode {
        const top = this.vals[0];
        const last = --this._size;
        this.keys[0] = this.keys[last];
        this.vals[0] = this.vals[last];
        let i = 0;
        for (;;) {
            const l = 2 * i + 1, r = l + 1;
            let s = i;
            if (l < this._size && this.keys[l] < this.keys[s]) s = l;
            if (r < this._size && this.keys[r] < this.keys[s]) s = r;
            if (s === i) break;
            this.swap(i, s);
            i = s;
        }
        return top;
    }

    private swap(a: number, b: number) {
        const tk = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = tk;
        const tv = this.vals[a]; this.vals[a] = this.vals[b]; this.vals[b] = tv;
    }

    private grow() {
        const nk = new Float64Array(this.keys.length * 2);
        nk.set(this.keys);
        this.keys = nk;
        this.vals.length *= 2;
    }
}

// ─── Search node ─────────────────────────────────────────────────────────────
interface SearchNode {
    boxes: number[];
    boxKey: string;
    playerCanon: number;
    g: number;
    h: number;
    parent: SearchNode | null;
    playerBefore: number;
    boxFrom: number;
    pushDir: number;
}

interface PushCandidate {
    boxCell: number;
    destCell: number;
    pushDir: number;
    priority: number;
}

const MEMO_UNVISITED = 0;
const MEMO_VISITING  = 1;
const MEMO_FROZEN    = 2;
const MEMO_FREE      = 3;

// ─── Main solver ─────────────────────────────────────────────────────────────
export class AStarSolverF3 {
    private readonly W: number;
    private readonly H: number;
    private readonly size: number;
    private readonly walls: Uint8Array;
    private readonly goals: Uint8Array;
    private readonly goalCells: number[];
    private readonly deadSquares: Uint8Array;
    private readonly initialBoxes: number[];
    private readonly initialPlayer: number;
    private readonly weight: number;

    private readonly frozenMemo: Uint8Array;
    /** pushDist[gi][cell] = min push-steps for box at `cell` to reach goalCells[gi] */
    private readonly pushDist: Int32Array[];
    /** minGoalPushDist[cell] = min push-steps from cell to any goal (wall-aware) */
    private readonly minGoalPushDist: Int32Array;
    private readonly staticCompId: Int32Array;
    private readonly staticCompGoalCount: Int32Array;
    private readonly playerStaticComp: number;
    private readonly reachQueue: Int32Array;
    private readonly corralQueue: Int32Array;
    private readonly corralVisited: Uint8Array;
    private readonly corralBoundaryMark: Uint8Array;
    private readonly heuristicCache: Map<string, number>;
    private readonly frozenDeadlockCache: Map<string, boolean>;
    private readonly staticChamberDeadlockCache: Map<string, boolean>;
    private readonly dynamicCorralDeadlockCache: Map<string, boolean>;
    private readonly bipartiteDeadlockCache: Map<string, boolean>;
    private static readonly INF = 0x7fffffff;

    constructor(initialMap: SokobanMap, weight = 1.5) {
        this.W = initialMap.getWidth();
        this.H = initialMap.getHeight();
        this.size = this.W * this.H;
        this.weight = weight;

        this.walls = new Uint8Array(this.size);
        this.goals = new Uint8Array(this.size);

        for (let y = 0; y < this.H; y++) {
            for (let x = 0; x < this.W; x++) {
                const idx = y * this.W + x;
                if (initialMap.hasWall(x, y)) this.walls[idx] = 1;
                if (initialMap.hasGoal(x, y))  this.goals[idx] = 1;
            }
        }

        this.goalCells = [];
        for (let i = 0; i < this.size; i++) if (this.goals[i]) this.goalCells.push(i);

        const playerPos = initialMap.getPlayerPosition()!;
        this.initialPlayer = playerPos.y * this.W + playerPos.x;
        this.initialBoxes = initialMap.getBoxes()
            .map(b => b.y * this.W + b.x)
            .sort((a, b) => a - b);

        this.deadSquares = this.computeDeadSquares();
        this.frozenMemo  = new Uint8Array(this.size);
        this.pushDist    = this.computePushDist();
        this.minGoalPushDist = this.computeMinGoalPushDist();
        const staticComp = this.computeStaticComponents(this.initialPlayer);
        this.staticCompId = staticComp.compId;
        this.staticCompGoalCount = staticComp.goalCount;
        this.playerStaticComp = staticComp.playerComp;
        this.reachQueue = new Int32Array(this.size);
        this.corralQueue = new Int32Array(this.size);
        this.corralVisited = new Uint8Array(this.size);
        this.corralBoundaryMark = new Uint8Array(this.size);
        this.heuristicCache = new Map<string, number>();
        this.frozenDeadlockCache = new Map<string, boolean>();
        this.staticChamberDeadlockCache = new Map<string, boolean>();
        this.dynamicCorralDeadlockCache = new Map<string, boolean>();
        this.bipartiteDeadlockCache = new Map<string, boolean>();
    }

    private computeStaticComponents(playerCell: number): {
        compId: Int32Array;
        goalCount: Int32Array;
        playerComp: number;
    } {
        const compId = new Int32Array(this.size).fill(-1);
        const queue = new Int32Array(this.size);
        let compCount = 0;

        for (let start = 0; start < this.size; start++) {
            if (this.walls[start] || compId[start] !== -1) continue;

            let head = 0;
            let tail = 0;
            queue[tail++] = start;
            compId[start] = compCount;

            while (head < tail) {
                const curr = queue[head++];
                const cx = curr % this.W;
                const cy = (curr / this.W) | 0;

                for (const dir of DIRS) {
                    const nx = cx + dir.dx;
                    const ny = cy + dir.dy;
                    if (nx < 0 || nx >= this.W || ny < 0 || ny >= this.H) continue;
                    const ni = ny * this.W + nx;
                    if (this.walls[ni] || compId[ni] !== -1) continue;
                    compId[ni] = compCount;
                    queue[tail++] = ni;
                }
            }

            compCount++;
        }

        const goalCount = new Int32Array(compCount);
        for (let cell = 0; cell < this.size; cell++) {
            const cid = compId[cell];
            if (cid >= 0 && this.goals[cell]) goalCount[cid]++;
        }

        return {
            compId,
            goalCount,
            playerComp: compId[playerCell],
        };
    }

    private computeMinGoalPushDist(): Int32Array {
        const minDist = new Int32Array(this.size).fill(AStarSolverF3.INF);
        for (let cell = 0; cell < this.size; cell++) {
            let best = AStarSolverF3.INF;
            for (let gi = 0; gi < this.pushDist.length; gi++) {
                const d = this.pushDist[gi][cell];
                if (d < best) best = d;
            }
            minDist[cell] = best;
        }
        return minDist;
    }

    // ── Push-distance precomputation ─────────────────────────────────────────
    // For each goal g, reverse-BFS through valid push moves (ignoring other
    // boxes, but respecting walls) to fill pushDist[gi][cell] = min pushes.
    private computePushDist(): Int32Array[] {
        const result: Int32Array[] = [];
        for (const goal of this.goalCells) {
            const dist = new Int32Array(this.size).fill(AStarSolverF3.INF);
            const queue: number[] = [goal];
            dist[goal] = 0;
            let qi = 0;
            while (qi < queue.length) {
                const curr = queue[qi++];
                const cx = curr % this.W, cy = (curr / this.W) | 0;
                const d = dist[curr];
                for (const dir of DIRS) {
                    // Reverse push: box was at prev, pushed to curr.
                    // prev = curr - dir.delta, player was at curr - 2*dir.delta.
                    const prevX = cx - dir.dx, prevY = cy - dir.dy;
                    const plX   = cx - 2 * dir.dx, plY = cy - 2 * dir.dy;
                    if (prevX < 0 || prevX >= this.W || prevY < 0 || prevY >= this.H) continue;
                    if (plX   < 0 || plX   >= this.W || plY   < 0 || plY   >= this.H) continue;
                    const prev = prevY * this.W + prevX;
                    const pl   = plY   * this.W + plX;
                    if (this.walls[prev] || this.walls[pl]) continue;
                    if (dist[prev] !== AStarSolverF3.INF) continue;
                    dist[prev] = d + 1;
                    queue.push(prev);
                }
            }
            result.push(dist);
        }
        return result;
    }

    // ── Static dead-square computation (reverse-BFS from goals) ───────────────
    private computeDeadSquares(): Uint8Array {
        const live = new Uint8Array(this.size);
        const queue: number[] = [];
        for (const g of this.goalCells) { live[g] = 1; queue.push(g); }

        let qi = 0;
        while (qi < queue.length) {
            const curr = queue[qi++];
            const cx = curr % this.W, cy = (curr / this.W) | 0;
            for (const dir of DIRS) {
                const prevX = cx - dir.dx, prevY = cy - dir.dy;
                const playerX = cx - 2 * dir.dx, playerY = cy - 2 * dir.dy;
                if (prevX < 0 || prevX >= this.W || prevY < 0 || prevY >= this.H) continue;
                if (playerX < 0 || playerX >= this.W || playerY < 0 || playerY >= this.H) continue;
                const prev = prevY * this.W + prevX;
                const playerCell = playerY * this.W + playerX;
                if (this.walls[prev] || this.walls[playerCell] || live[prev]) continue;
                live[prev] = 1;
                queue.push(prev);
            }
        }

        const dead = new Uint8Array(this.size);
        for (let i = 0; i < this.size; i++) {
            if (!this.walls[i] && !live[i]) dead[i] = 1;
        }
        return dead;
    }

    // ── Player reachability BFS ────────────────────────────────────────────────
    private computeReachable(
        playerCell: number,
        boxSet: Uint8Array,
        out: Uint8Array,
    ): number {
        out.fill(0);
        const queue = this.reachQueue;
        let head = 0;
        let tail = 0;
        queue[tail++] = playerCell;
        out[playerCell] = 1;
        let canon = playerCell;
        while (head < tail) {
            const curr = queue[head++];
            const cx = curr % this.W, cy = (curr / this.W) | 0;
            for (const dir of DIRS) {
                const nx = cx + dir.dx, ny = cy + dir.dy;
                if (nx < 0 || nx >= this.W || ny < 0 || ny >= this.H) continue;
                const ni = ny * this.W + nx;
                if (out[ni] || this.walls[ni] || boxSet[ni]) continue;
                out[ni] = 1;
                if (ni < canon) canon = ni;
                queue[tail++] = ni;
            }
        }
        return canon;
    }

    // ── BFS push-distance bipartite matching heuristic ───────────────────────
    // Greedy min-cost matching using precomputed push distances.
    // Strictly tighter than Manhattan distance; still admissible (never
    // overestimates).
    private heuristic(boxes: number[], boxKey: string): number {
        const n = boxes.length;
        if (n === 0) return 0;

        const cached = this.heuristicCache.get(boxKey);
        if (cached !== undefined) return cached;

        const m = this.goalCells.length;

        const triples: Array<[number, number, number]> = [];
        for (let bi = 0; bi < n; bi++) {
            for (let gi = 0; gi < m; gi++) {
                const d = this.pushDist[gi][boxes[bi]];
                triples.push([d, bi, gi]);
            }
        }
        triples.sort((a, b) => a[0] - b[0]);

        const usedBox  = new Uint8Array(n);
        const usedGoal = new Uint8Array(m);
        let total = 0, matched = 0;

        for (const [d, bi, gi] of triples) {
            if (matched === n) break;
            if (usedBox[bi] || usedGoal[gi]) continue;
            usedBox[bi] = 1; usedGoal[gi] = 1;
            total += d; matched++;
        }
        this.heuristicCache.set(boxKey, total);
        return total;
    }

    // ── 2×2 block deadlock detection (local around moved box) ─────────────────
    private has2x2DeadlockAt(boxSet: Uint8Array, movedCell: number): boolean {
        const x = movedCell % this.W;
        const y = (movedCell / this.W) | 0;

        for (let anchorY = y - 1; anchorY <= y; anchorY++) {
            for (let anchorX = x - 1; anchorX <= x; anchorX++) {
                if (anchorX < 0 || anchorX >= this.W - 1) continue;
                if (anchorY < 0 || anchorY >= this.H - 1) continue;

                const tl = anchorY * this.W + anchorX;
                const tr = tl + 1;
                const bl = tl + this.W;
                const br = bl + 1;

                if (!(this.walls[tl] || boxSet[tl])) continue;
                if (!(this.walls[tr] || boxSet[tr])) continue;
                if (!(this.walls[bl] || boxSet[bl])) continue;
                if (!(this.walls[br] || boxSet[br])) continue;

                if (
                    (boxSet[tl] && !this.goals[tl]) ||
                    (boxSet[tr] && !this.goals[tr]) ||
                    (boxSet[bl] && !this.goals[bl]) ||
                    (boxSet[br] && !this.goals[br])
                ) return true;
            }
        }
        return false;
    }

    // ── Frozen-box deadlock detection ─────────────────────────────────────────
    private isFrozenBox(cell: number, boxSet: Uint8Array, memo: Uint8Array): boolean {
        const m = memo[cell];
        if (m === MEMO_FROZEN)   return true;
        if (m === MEMO_FREE)     return false;
        if (m === MEMO_VISITING) return true; // cycle → conservatively frozen

        memo[cell] = MEMO_VISITING;
        const x = cell % this.W, y = (cell / this.W) | 0;

        const lc = x > 0          ? cell - 1      : -1;
        const rc = x < this.W - 1 ? cell + 1      : -1;
        const uc = y > 0          ? cell - this.W : -1;
        const dc = y < this.H - 1 ? cell + this.W : -1;

        const lB = lc < 0 || this.walls[lc] || (boxSet[lc] !== 0 && this.isFrozenBox(lc, boxSet, memo));
        const rB = rc < 0 || this.walls[rc] || (boxSet[rc] !== 0 && this.isFrozenBox(rc, boxSet, memo));
        const uB = uc < 0 || this.walls[uc] || (boxSet[uc] !== 0 && this.isFrozenBox(uc, boxSet, memo));
        const dB = dc < 0 || this.walls[dc] || (boxSet[dc] !== 0 && this.isFrozenBox(dc, boxSet, memo));

        const frozen = (lB && rB) && (uB && dB);
        memo[cell] = frozen ? MEMO_FROZEN : MEMO_FREE;
        return frozen;
    }

    private hasFrozenDeadlock(boxes: number[], boxSet: Uint8Array, boxKey: string): boolean {
        const cached = this.frozenDeadlockCache.get(boxKey);
        if (cached !== undefined) return cached;

        this.frozenMemo.fill(0);
        for (const b of boxes) {
            if (this.goals[b]) continue;
            if (this.isFrozenBox(b, boxSet, this.frozenMemo)) {
                this.frozenDeadlockCache.set(boxKey, true);
                return true;
            }
        }
        this.frozenDeadlockCache.set(boxKey, false);
        return false;
    }

    // ── State key ─────────────────────────────────────────────────────────────
    private stateKey(boxKey: string, canonPlayer: number): string {
        return `${canonPlayer}|${boxKey}`;
    }

    private replaceBoxSorted(sortedBoxes: number[], fromCell: number, toCell: number): number[] {
        const nextBoxes = sortedBoxes.slice();
        const removeIndex = nextBoxes.indexOf(fromCell);
        if (removeIndex < 0) return nextBoxes;

        nextBoxes.splice(removeIndex, 1);

        let left = 0;
        let right = nextBoxes.length;
        while (left < right) {
            const middle = (left + right) >> 1;
            if (nextBoxes[middle] < toCell) left = middle + 1;
            else right = middle;
        }
        nextBoxes.splice(left, 0, toCell);
        return nextBoxes;
    }

    private pushPriority(boxCell: number, destCell: number): number {
        let score = 0;

        if (this.goals[destCell]) score += 700;
        if (this.goals[boxCell] && !this.goals[destCell]) score -= 450;

        const fromD = this.minGoalPushDist[boxCell];
        const toD = this.minGoalPushDist[destCell];

        if (toD === AStarSolverF3.INF && fromD !== AStarSolverF3.INF) {
            score -= 250;
        } else if (toD !== AStarSolverF3.INF && fromD === AStarSolverF3.INF) {
            score += 250;
        } else if (toD !== AStarSolverF3.INF && fromD !== AStarSolverF3.INF) {
            score += (fromD - toD) * 20;
            score += Math.max(0, 30 - toD);
        }

        return score;
    }

    private hasBipartiteDeadlock(boxes: number[], boxKey: string): boolean {
        const cached = this.bipartiteDeadlockCache.get(boxKey);
        if (cached !== undefined) return cached;

        const n = boxes.length;
        const m = this.goalCells.length;
        if (n === 0) {
            this.bipartiteDeadlockCache.set(boxKey, false);
            return false;
        }
        if (n > m) {
            this.bipartiteDeadlockCache.set(boxKey, true);
            return true;
        }

        const adjacency: number[][] = new Array(n);
        for (let bi = 0; bi < n; bi++) {
            const goals: number[] = [];
            const boxCell = boxes[bi];
            for (let gi = 0; gi < m; gi++) {
                if (this.pushDist[gi][boxCell] !== AStarSolverF3.INF) goals.push(gi);
            }
            if (goals.length === 0) {
                this.bipartiteDeadlockCache.set(boxKey, true);
                return true;
            }
            adjacency[bi] = goals;
        }

        const goalOwner = new Int32Array(m).fill(-1);
        const seenGoal = new Uint8Array(m);

        const dfs = (boxIndex: number): boolean => {
            const goals = adjacency[boxIndex];
            for (let i = 0; i < goals.length; i++) {
                const goalIndex = goals[i];
                if (seenGoal[goalIndex]) continue;
                seenGoal[goalIndex] = 1;
                const owner = goalOwner[goalIndex];
                if (owner === -1 || dfs(owner)) {
                    goalOwner[goalIndex] = boxIndex;
                    return true;
                }
            }
            return false;
        };

        let matched = 0;
        for (let bi = 0; bi < n; bi++) {
            seenGoal.fill(0);
            if (dfs(bi)) matched++;
        }

        const deadlock = matched < n;
        this.bipartiteDeadlockCache.set(boxKey, deadlock);
        return deadlock;
    }

    private hasStaticChamberDeadlock(boxes: number[], boxKey: string): boolean {
        const cached = this.staticChamberDeadlockCache.get(boxKey);
        if (cached !== undefined) return cached;

        const compBoxCount = new Int32Array(this.staticCompGoalCount.length);
        const compOffGoalCount = new Int32Array(this.staticCompGoalCount.length);

        for (let i = 0; i < boxes.length; i++) {
            const cell = boxes[i];
            const cid = this.staticCompId[cell];
            if (cid < 0) continue;
            compBoxCount[cid]++;
            if (!this.goals[cell]) compOffGoalCount[cid]++;
        }

        for (let cid = 0; cid < compBoxCount.length; cid++) {
            if (cid === this.playerStaticComp) continue;
            if (compOffGoalCount[cid] === 0) continue;
            if (compBoxCount[cid] > this.staticCompGoalCount[cid]) {
                this.staticChamberDeadlockCache.set(boxKey, true);
                return true;
            }
        }

        this.staticChamberDeadlockCache.set(boxKey, false);
        return false;
    }

    private hasDynamicCorralDeadlock(
        boxSet: Uint8Array,
        reachable: Uint8Array,
        boxKey: string,
        playerCanon: number,
    ): boolean {
        const cacheKey = this.stateKey(boxKey, playerCanon);
        const cached = this.dynamicCorralDeadlockCache.get(cacheKey);
        if (cached !== undefined) return cached;

        this.corralVisited.fill(0);
        this.frozenMemo.fill(0);

        const queue = this.corralQueue;
        const boundaryBoxes: number[] = [];

        for (let start = 0; start < this.size; start++) {
            if (this.walls[start] || reachable[start] || this.corralVisited[start]) continue;

            let boxCount = 0;
            let goalCount = 0;
            let offGoalBoxCount = 0;

            let head = 0;
            let tail = 0;
            queue[tail++] = start;
            this.corralVisited[start] = 1;
            boundaryBoxes.length = 0;

            while (head < tail) {
                const curr = queue[head++];

                if (this.goals[curr]) goalCount++;
                if (boxSet[curr]) {
                    boxCount++;
                    if (!this.goals[curr]) offGoalBoxCount++;
                }

                const cx = curr % this.W;
                const cy = (curr / this.W) | 0;

                for (const dir of DIRS) {
                    const nx = cx + dir.dx;
                    const ny = cy + dir.dy;
                    if (nx < 0 || nx >= this.W || ny < 0 || ny >= this.H) continue;

                    const ni = ny * this.W + nx;
                    if (this.walls[ni]) continue;

                    if (reachable[ni]) {
                        if (boxSet[curr] && this.corralBoundaryMark[curr] === 0) {
                            this.corralBoundaryMark[curr] = 1;
                            boundaryBoxes.push(curr);
                        }
                        continue;
                    }

                    if (this.corralVisited[ni]) continue;
                    this.corralVisited[ni] = 1;
                    queue[tail++] = ni;
                }
            }

            if (boxCount > goalCount && offGoalBoxCount > 0) {
                let sealed = true;
                for (let i = 0; i < boundaryBoxes.length; i++) {
                    const b = boundaryBoxes[i];
                    if (!this.isFrozenBox(b, boxSet, this.frozenMemo)) {
                        sealed = false;
                        break;
                    }
                }

                if (sealed) {
                    for (let i = 0; i < boundaryBoxes.length; i++) {
                        this.corralBoundaryMark[boundaryBoxes[i]] = 0;
                    }
                    this.dynamicCorralDeadlockCache.set(cacheKey, true);
                    return true;
                }
            }

            for (let i = 0; i < boundaryBoxes.length; i++) {
                this.corralBoundaryMark[boundaryBoxes[i]] = 0;
            }
        }

        this.dynamicCorralDeadlockCache.set(cacheKey, false);
        return false;
    }

    private shouldRunDynamicCorral(
        boxes: number[],
        reachable: Uint8Array,
        nodeRatio: number,
        elapsedRatio: number,
    ): boolean {
        if (nodeRatio < 0.45 && elapsedRatio < 0.45) return false;

        let unreachableBoxCount = 0;
        let unreachableGoalCount = 0;
        let unreachableOffGoalBoxes = 0;

        for (let i = 0; i < boxes.length; i++) {
            const cell = boxes[i];
            if (reachable[cell]) continue;
            unreachableBoxCount++;
            if (!this.goals[cell]) unreachableOffGoalBoxes++;
        }

        if (unreachableOffGoalBoxes === 0) return false;

        for (let i = 0; i < this.goalCells.length; i++) {
            const goalCell = this.goalCells[i];
            if (!reachable[goalCell]) unreachableGoalCount++;
        }

        if (unreachableBoxCount <= unreachableGoalCount) return false;

        return unreachableOffGoalBoxes >= 4;
    }

    // ── BFS path for path reconstruction ────────────────────────────────────
    private bfsPath(from: number, to: number, boxSet: Uint8Array): string {
        if (from === to) return '';
        const prev   = new Int32Array(this.size).fill(-1);
        const dirIdx = new Uint8Array(this.size);
        prev[from] = from;
        const queue = [from];
        let qi = 0;
        while (qi < queue.length) {
            const curr = queue[qi++];
            if (curr === to) break;
            const cx = curr % this.W, cy = (curr / this.W) | 0;
            for (let d = 0; d < 4; d++) {
                const dir = DIRS[d];
                const nx = cx + dir.dx, ny = cy + dir.dy;
                if (nx < 0 || nx >= this.W || ny < 0 || ny >= this.H) continue;
                const ni = ny * this.W + nx;
                if (prev[ni] !== -1 || this.walls[ni] || boxSet[ni]) continue;
                prev[ni] = curr; dirIdx[ni] = d;
                queue.push(ni);
            }
        }
        let path = '', cur = to;
        while (cur !== from) { path = DIRS[dirIdx[cur]].ch + path; cur = prev[cur]; }
        return path;
    }

    // ── Path reconstruction ───────────────────────────────────────────────────
    private reconstructPath(goalNode: SearchNode): string {
        const chain: SearchNode[] = [];
        let n: SearchNode | null = goalNode;
        while (n && n.parent !== null) { chain.push(n); n = n.parent; }
        chain.reverse();

        let path = '';
        const boxSet = new Uint8Array(this.size);
        for (const idx of this.initialBoxes) boxSet[idx] = 1;
        let playerCell = this.initialPlayer;

        for (const node of chain) {
            const approachCell = node.boxFrom - (DIRS[node.pushDir].dy * this.W + DIRS[node.pushDir].dx);
            path += this.bfsPath(playerCell, approachCell, boxSet);
            path += DIRS[node.pushDir].ch;
            const boxTo = node.boxFrom + DIRS[node.pushDir].dy * this.W + DIRS[node.pushDir].dx;
            boxSet[node.boxFrom] = 0;
            boxSet[boxTo] = 1;
            playerCell = node.boxFrom;
        }
        return path;
    }

    // ── Main search ───────────────────────────────────────────────────────────
    solve(maxNodes = 200_000, deadlineMs = Infinity): SolverResult {
        const reachBuf    = new Uint8Array(this.size);
        const boxSet      = new Uint8Array(this.size);
        const stateBoxSet = new Uint8Array(this.size);
        const stateReach  = new Uint8Array(this.size);
        const pushCandidates: PushCandidate[] = [];

        for (const idx of this.initialBoxes) boxSet[idx] = 1;

        const initCanon = this.computeReachable(this.initialPlayer, boxSet, reachBuf);
        const initBoxKey = this.initialBoxes.join(',');
        const initH     = this.heuristic(this.initialBoxes, initBoxKey);

        const rootNode: SearchNode = {
            boxes: this.initialBoxes,
            boxKey: initBoxKey,
            playerCanon: initCanon,
            g: 0, h: initH,
            parent: null,
            playerBefore: this.initialPlayer,
            boxFrom: -1, pushDir: 0,
        };

        const heap = new MinHeap();
        heap.push(this.weight * initH, rootNode);

        const closedSet = new Set<string>();
        const openBestG = new Map<string, number>();
        openBestG.set(this.stateKey(rootNode.boxKey, rootNode.playerCanon), 0);
        let nodesCount = 0;
        const searchStart = performance.now();
        const hasFiniteDeadline = Number.isFinite(deadlineMs);
        const timeBudget = hasFiniteDeadline ? Math.max(1, deadlineMs - searchStart) : Infinity;

        while (heap.size > 0) {
            if (nodesCount >= maxNodes) return { status: 'limit-reached', nodesExpanded: nodesCount };
            if ((nodesCount & 0x1ff) === 0 && performance.now() > deadlineMs) {
                return { status: 'limit-reached', nodesExpanded: nodesCount };
            }

            const nodeRatio = maxNodes > 0 ? nodesCount / maxNodes : 0;
            const elapsedRatio = hasFiniteDeadline ? (performance.now() - searchStart) / timeBudget : 0;
            let phaseWeight = this.weight;
            if (nodeRatio >= 0.6 || elapsedRatio >= 0.6) phaseWeight = Math.max(phaseWeight, 1.8);
            if (nodeRatio >= 0.82 || elapsedRatio >= 0.82) phaseWeight = Math.max(phaseWeight, 2.1);

            const current = heap.pop();
            nodesCount++;

            const key = this.stateKey(current.boxKey, current.playerCanon);
            const openBest = openBestG.get(key);
            if (openBest !== undefined && current.g > openBest) continue;
            if (closedSet.has(key)) continue;
            closedSet.add(key);
            openBestG.delete(key);

            // Win check
            let won = true;
            for (const b of current.boxes) { if (!this.goals[b]) { won = false; break; } }
            if (won) return { status: 'solved', path: this.reconstructPath(current), nodesExpanded: nodesCount };

            // Rebuild boxSet and reachable zone for this state
            stateBoxSet.fill(0);
            for (const b of current.boxes) stateBoxSet[b] = 1;
            this.computeReachable(current.playerCanon, stateBoxSet, stateReach);

            pushCandidates.length = 0;

            for (const boxCell of current.boxes) {
                const bx = boxCell % this.W, by = (boxCell / this.W) | 0;

                for (let d = 0; d < 4; d++) {
                    const dir = DIRS[d];

                    const approachX = bx - dir.dx, approachY = by - dir.dy;
                    if (approachX < 0 || approachX >= this.W || approachY < 0 || approachY >= this.H) continue;
                    if (!stateReach[approachY * this.W + approachX]) continue;

                    const destX = bx + dir.dx, destY = by + dir.dy;
                    if (destX < 0 || destX >= this.W || destY < 0 || destY >= this.H) continue;
                    const destCell = destY * this.W + destX;

                    if (this.walls[destCell])      continue;
                    if (stateBoxSet[destCell])     continue;
                    if (this.deadSquares[destCell]) continue;

                    pushCandidates.push({
                        boxCell,
                        destCell,
                        pushDir: d,
                        priority: this.pushPriority(boxCell, destCell),
                    });
                }
            }

            pushCandidates.sort((a, b) => b.priority - a.priority);

            for (const candidate of pushCandidates) {
                const boxCell = candidate.boxCell;
                const destCell = candidate.destCell;
                const d = candidate.pushDir;

                // Apply push tentatively
                stateBoxSet[boxCell] = 0;
                stateBoxSet[destCell] = 1;

                // ① 2×2 block check (fast, runs first)
                if (this.has2x2DeadlockAt(stateBoxSet, destCell)) {
                    stateBoxSet[boxCell] = 1; stateBoxSet[destCell] = 0; continue;
                }

                // ② Frozen-box check
                const nextBoxes = this.replaceBoxSorted(current.boxes, boxCell, destCell);
                const nextBoxKey = nextBoxes.join(',');

                if (this.hasFrozenDeadlock(nextBoxes, stateBoxSet, nextBoxKey)) {
                    stateBoxSet[boxCell] = 1; stateBoxSet[destCell] = 0; continue;
                }

                // ③ Conservative corral-lite: wall-isolated static chambers
                if (this.hasStaticChamberDeadlock(nextBoxes, nextBoxKey)) {
                    stateBoxSet[boxCell] = 1; stateBoxSet[destCell] = 0; continue;
                }

                // ④ Bipartite deadlock check (safe static feasibility prune)
                if (this.hasBipartiteDeadlock(nextBoxes, nextBoxKey)) {
                    stateBoxSet[boxCell] = 1; stateBoxSet[destCell] = 0; continue;
                }

                // ⑤ Compute next canonical player position (fills reachBuf with next-state reach)
                const nextCanon = this.computeReachable(boxCell, stateBoxSet, reachBuf);

                // ⑥ Conservative dynamic corral v2 (reachable-zone based capacity prune)
                if (this.shouldRunDynamicCorral(nextBoxes, reachBuf, nodeRatio, elapsedRatio)) {
                    if (this.hasDynamicCorralDeadlock(stateBoxSet, reachBuf, nextBoxKey, nextCanon)) {
                        stateBoxSet[boxCell] = 1; stateBoxSet[destCell] = 0; continue;
                    }
                }

                // Restore stateBoxSet
                stateBoxSet[boxCell] = 1;
                stateBoxSet[destCell] = 0;

                const nextKey = this.stateKey(nextBoxKey, nextCanon);
                const nextG = current.g + 1;
                if (closedSet.has(nextKey)) continue;
                const prevBest = openBestG.get(nextKey);
                if (prevBest !== undefined && prevBest <= nextG) continue;
                openBestG.set(nextKey, nextG);

                const nextH = this.heuristic(nextBoxes, nextBoxKey);

                heap.push(nextG + phaseWeight * nextH, {
                    boxes: nextBoxes,
                    boxKey: nextBoxKey,
                    playerCanon: nextCanon,
                    g: nextG, h: nextH,
                    parent: current,
                    playerBefore: current.playerCanon,
                    boxFrom: boxCell,
                    pushDir: d,
                });
            }
        }

        return { status: 'unsolvable', nodesExpanded: nodesCount };
    }
}
