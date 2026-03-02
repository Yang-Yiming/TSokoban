/**
 * AStarSolverV2 — optimized Sokoban solver
 *
 * Optimizations over V1 (in priority order applied):
 *
 * 1. Macro-moves (push-only expansion)
 *    Only expand states where the player actually pushes a box.
 *    Player navigation inside a push is handled by BFS (not search nodes).
 *    Branching factor drops from ~4 to ~2–8 max pushes per state.
 *
 * 2. Canonical player position (reachable-zone normalization)
 *    Two states where the player is in different cells but the same
 *    reachable zone (with identical box config) are the SAME state.
 *    We represent player position as the min cell index in the reachable zone.
 *    This eliminates a huge number of duplicate states.
 *
 * 3. Integer cell indices everywhere
 *    All positions stored as `idx = y * width + x` (plain numbers).
 *    No "x,y" string construction, no split(), no Coordinate objects.
 *
 * 4. Binary min-heap priority queue
 *    O(log n) push/pop instead of O(n) linear scan.
 *
 * 5. Static dead-square table (precomputed)
 *    Before search: BFS backwards from goals via reverse-pushes to find
 *    all cells a box can legally reach any goal from (ignoring other boxes,
 *    respecting walls). Boxes pushed to dead squares prune immediately.
 *
 * 6. Minimum-cost assignment heuristic
 *    Greedy min-cost bipartite matching between boxes and goals
 *    (sort all (box,goal) distances, assign greedily).  Much tighter
 *    lower bound than "each box to nearest goal" without full Hungarian.
 *
 * 7. 2×2 block deadlock detection
 *    If any 2×2 region contains ≥1 box with ≥1 non-goal cell, and all
 *    4 cells are either box or wall → deadlock.
 *
 * API is identical to AStarSolver so you can drop-in replace:
 *   new AStarSolverV2(map)
 *   solver.solve(maxNodes?) → SolverResult
 */

import { SokobanMap } from './SokobanMap';

export interface SolverResult {
    status: 'solved' | 'unsolvable' | 'limit-reached';
    path?: string;
    nodesExpanded: number;
}

// ─── direction constants ──────────────────────────────────────────────────────
const DIRS = [
    { dx:  0, dy: -1, ch: 'w' },  // 0 up
    { dx:  0, dy:  1, ch: 's' },  // 1 down
    { dx: -1, dy:  0, ch: 'a' },  // 2 left
    { dx:  1, dy:  0, ch: 'd' },  // 3 right
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
    /** sorted box indices */
    boxes: number[];
    /** canonical (min reachable) player cell */
    playerCanon: number;
    g: number;
    h: number;
    parent: SearchNode | null;
    /** player's actual position BEFORE this push (needed to reconstruct path) */
    playerBefore: number;
    /** box cell before this push */
    boxFrom: number;
    /** direction index 0-3 */
    pushDir: number;
}

// ─── Main solver ─────────────────────────────────────────────────────────────
export class AStarSolverV2 {
    private readonly W: number;
    private readonly H: number;
    private readonly size: number;
    private readonly walls: Uint8Array;       // 1 = wall
    private readonly goals: Uint8Array;       // 1 = goal
    private readonly goalCells: number[];     // goal cell indices
    private readonly deadSquares: Uint8Array; // 1 = static dead square
    private readonly initialBoxes: number[];
    private readonly initialPlayer: number;

    constructor(initialMap: SokobanMap) {
        this.W = initialMap.getWidth();
        this.H = initialMap.getHeight();
        this.size = this.W * this.H;

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

        // Extract initial state
        const playerPos = initialMap.getPlayerPosition()!;
        this.initialPlayer = playerPos.y * this.W + playerPos.x;
        this.initialBoxes = initialMap.getBoxes()
            .map(b => b.y * this.W + b.x)
            .sort((a, b) => a - b);

        this.deadSquares = this.computeDeadSquares();
    }

    // ── Static dead-square computation ────────────────────────────────────────
    // BFS backwards from goal cells via reverse-pushes (ignoring other boxes).
    // A cell is "live" if a box can reach any goal from it by a series of pushes.
    private computeDeadSquares(): Uint8Array {
        const live = new Uint8Array(this.size);
        const queue: number[] = [];

        // Seed: all goal cells are live
        for (const g of this.goalCells) { live[g] = 1; queue.push(g); }

        let qi = 0;
        while (qi < queue.length) {
            const curr = queue[qi++]; // box is currently at `curr`
            const cx = curr % this.W, cy = (curr / this.W) | 0;

            for (const dir of DIRS) {
                // Reverse push: box ends at `curr`, pushed in direction `dir`.
                // => box was at prev = curr - dir
                // => player was at playerCell = curr - 2*dir (player pushed FROM that side)
                const prevX = cx - dir.dx, prevY = cy - dir.dy;
                const playerX = cx - 2 * dir.dx, playerY = cy - 2 * dir.dy;
                if (prevX < 0 || prevX >= this.W || prevY < 0 || prevY >= this.H) continue;
                if (playerX < 0 || playerX >= this.W || playerY < 0 || playerY >= this.H) continue;
                const prev = prevY * this.W + prevX;
                const playerCell = playerY * this.W + playerX;
                if (this.walls[prev]) continue;
                if (this.walls[playerCell]) continue;
                if (live[prev]) continue;
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
    // Returns a Uint8Array (1 = reachable) and the canonical (min) cell index.
    private computeReachable(
        playerCell: number,
        boxSet: Uint8Array,
        out: Uint8Array,
    ): number {
        out.fill(0);
        const queue: number[] = [playerCell];
        out[playerCell] = 1;
        let qi = 0;
        let canon = playerCell;

        while (qi < queue.length) {
            const curr = queue[qi++];
            const cx = curr % this.W, cy = (curr / this.W) | 0;
            for (const dir of DIRS) {
                const nx = cx + dir.dx, ny = cy + dir.dy;
                if (nx < 0 || nx >= this.W || ny < 0 || ny >= this.H) continue;
                const ni = ny * this.W + nx;
                if (out[ni] || this.walls[ni] || boxSet[ni]) continue;
                out[ni] = 1;
                if (ni < canon) canon = ni;
                queue.push(ni);
            }
        }
        return canon;
    }

    // ── Minimum-cost assignment heuristic ─────────────────────────────────────
    // Greedy min-cost bipartite matching (sort all pairs, assign greedily).
    // Better lower bound than "nearest goal per box" at minimal extra cost.
    private heuristic(boxes: number[]): number {
        const n = boxes.length;
        if (n === 0) return 0;
        const m = this.goalCells.length;

        // Build all (dist, boxIdx, goalIdx) triples
        const triples: Array<[number, number, number]> = [];
        for (let bi = 0; bi < n; bi++) {
            const bx = boxes[bi] % this.W, by = (boxes[bi] / this.W) | 0;
            for (let gi = 0; gi < m; gi++) {
                const gx = this.goalCells[gi] % this.W, gy = (this.goalCells[gi] / this.W) | 0;
                triples.push([Math.abs(bx - gx) + Math.abs(by - gy), bi, gi]);
            }
        }
        triples.sort((a, b) => a[0] - b[0]);

        const usedBox = new Uint8Array(n);
        const usedGoal = new Uint8Array(m);
        let total = 0, matched = 0;

        for (const [d, bi, gi] of triples) {
            if (matched === n) break;
            if (usedBox[bi] || usedGoal[gi]) continue;
            usedBox[bi] = 1; usedGoal[gi] = 1;
            total += d; matched++;
        }
        return total;
    }

    // ── 2×2 deadlock detection ─────────────────────────────────────────────────
    // If any 2×2 block has ≥1 box AND all 4 cells are wall-or-box AND
    // at least 1 box is not on a goal → deadlock.
    private has2x2Deadlock(boxSet: Uint8Array): boolean {
        for (let y = 0; y < this.H - 1; y++) {
            for (let x = 0; x < this.W - 1; x++) {
                const tl = y * this.W + x;
                const tr = tl + 1;
                const bl = tl + this.W;
                const br = bl + 1;
                const tlOk = this.walls[tl] || boxSet[tl];
                const trOk = this.walls[tr] || boxSet[tr];
                const blOk = this.walls[bl] || boxSet[bl];
                const brOk = this.walls[br] || boxSet[br];
                if (!tlOk || !trOk || !blOk || !brOk) continue;
                // All 4 are wall-or-box; check if any box is off-goal
                if (
                    (boxSet[tl] && !this.goals[tl]) ||
                    (boxSet[tr] && !this.goals[tr]) ||
                    (boxSet[bl] && !this.goals[bl]) ||
                    (boxSet[br] && !this.goals[br])
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    // ── State key ─────────────────────────────────────────────────────────────
    private stateKey(boxes: number[], canonPlayer: number): string {
        // boxes is always sorted; joining is fast for small arrays
        return `${canonPlayer}|${boxes.join(',')}`;
    }

    // ── BFS player path between two points (no pushing) ───────────────────────
    // Used during path reconstruction to find walking path.
    private bfsPath(
        from: number,
        to: number,
        boxSet: Uint8Array,
    ): string {
        if (from === to) return '';
        const prev = new Int32Array(this.size).fill(-1);
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
                prev[ni] = curr;
                dirIdx[ni] = d;
                queue.push(ni);
            }
        }
        // Reconstruct
        let path = '';
        let cur = to;
        while (cur !== from) {
            path = DIRS[dirIdx[cur]].ch + path;
            cur = prev[cur];
        }
        return path;
    }

    // ── Full path reconstruction ───────────────────────────────────────────────
    private reconstructPath(goalNode: SearchNode): string {
        // Collect chain of push nodes (skip root which has null parent)
        const chain: SearchNode[] = [];
        let n: SearchNode | null = goalNode;
        while (n && n.parent !== null) { chain.push(n); n = n.parent; }
        chain.reverse();

        let path = '';
        // Simulate box state to correctly BFS through intermediate states
        const boxSet = new Uint8Array(this.size);
        for (const idx of this.initialBoxes) boxSet[idx] = 1;

        let playerCell = this.initialPlayer;

        for (const node of chain) {
            // Player approach cell = cell behind the box opposite to push direction
            const approachCell = node.boxFrom - (DIRS[node.pushDir].dy * this.W + DIRS[node.pushDir].dx);

            // BFS player path to approach cell; box is still at boxFrom (do NOT remove it)
            path += this.bfsPath(playerCell, approachCell, boxSet);

            // Execute push: player steps into boxFrom, box moves to boxTo
            path += DIRS[node.pushDir].ch;
            const boxTo = node.boxFrom + DIRS[node.pushDir].dy * this.W + DIRS[node.pushDir].dx;
            boxSet[node.boxFrom] = 0;
            boxSet[boxTo] = 1;
            playerCell = node.boxFrom;
        }

        return path;
    }

    // ── Main search ───────────────────────────────────────────────────────────
    solve(maxNodes = 10000): SolverResult {
        // Scratch buffers (reused every BFS call)
        const reachBuf = new Uint8Array(this.size);
        const boxSet   = new Uint8Array(this.size);

        // Set up initial state
        for (const idx of this.initialBoxes) boxSet[idx] = 1;

        const initCanon = this.computeReachable(this.initialPlayer, boxSet, reachBuf);
        const initH = this.heuristic(this.initialBoxes);

        const rootNode: SearchNode = {
            boxes: this.initialBoxes,
            playerCanon: initCanon,
            g: 0,
            h: initH,
            parent: null,
            playerBefore: this.initialPlayer,
            boxFrom: -1,
            pushDir: 0,
        };

        const heap = new MinHeap();
        heap.push(initH, rootNode);

        const closedSet = new Set<string>();
        let nodesCount = 0;

        // Scratch Uint8Array for each expanded state's boxSet
        // We rebuild it from boxes[] each time (small arrays, fast loop)
        const stateBoxSet = new Uint8Array(this.size);
        const stateReach  = new Uint8Array(this.size);

        while (heap.size > 0) {
            if (nodesCount >= maxNodes) {
                return { status: 'limit-reached', nodesExpanded: nodesCount };
            }

            const current = heap.pop();
            nodesCount++;

            const key = this.stateKey(current.boxes, current.playerCanon);
            if (closedSet.has(key)) continue;
            closedSet.add(key);

            // Win check
            let won = true;
            for (const b of current.boxes) { if (!this.goals[b]) { won = false; break; } }
            if (won) {
                return {
                    status: 'solved',
                    path: this.reconstructPath(current),
                    nodesExpanded: nodesCount,
                };
            }

            // Build boxSet from current.boxes
            stateBoxSet.fill(0);
            for (const b of current.boxes) stateBoxSet[b] = 1;

            // Compute player reachable zone for this state
            // We use playerCanon as the "representative" position — we need to
            // find the actual reachable zone. Since canon is the min of the zone,
            // we BFS from it to get the zone.
            this.computeReachable(current.playerCanon, stateBoxSet, stateReach);

            // Enumerate all valid pushes
            for (const boxCell of current.boxes) {
                const bx = boxCell % this.W, by = (boxCell / this.W) | 0;

                for (let d = 0; d < 4; d++) {
                    const dir = DIRS[d];
                    // Player must be on the opposite side of the box
                    const approachX = bx - dir.dx, approachY = by - dir.dy;
                    if (approachX < 0 || approachX >= this.W || approachY < 0 || approachY >= this.H) continue;
                    const approachCell = approachY * this.W + approachX;

                    // Player must be able to reach the approach cell
                    if (!stateReach[approachCell]) continue;

                    // Destination of the box
                    const destX = bx + dir.dx, destY = by + dir.dy;
                    if (destX < 0 || destX >= this.W || destY < 0 || destY >= this.H) continue;
                    const destCell = destY * this.W + destX;

                    if (this.walls[destCell]) continue;
                    if (stateBoxSet[destCell]) continue;      // another box there
                    if (this.deadSquares[destCell]) continue; // static dead square

                    // Build next box state
                    const nextBoxes = current.boxes.map(b => b === boxCell ? destCell : b).sort((a, b) => a - b);

                    // 2×2 deadlock check
                    stateBoxSet[boxCell] = 0;
                    stateBoxSet[destCell] = 1;
                    const is2x2 = this.has2x2Deadlock(stateBoxSet);
                    stateBoxSet[boxCell] = 1;
                    stateBoxSet[destCell] = 0;
                    if (is2x2) continue;

                    // Compute next canonical player position
                    // After the push, player is at boxCell (box moved to destCell)
                    stateBoxSet[boxCell] = 0;
                    stateBoxSet[destCell] = 1;
                    const nextCanon = this.computeReachable(boxCell, stateBoxSet, reachBuf);
                    stateBoxSet[boxCell] = 1;
                    stateBoxSet[destCell] = 0;

                    const nextKey = this.stateKey(nextBoxes, nextCanon);
                    if (closedSet.has(nextKey)) continue;

                    const nextH = this.heuristic(nextBoxes);
                    const nextG = current.g + 1; // g = number of pushes

                    const nextNode: SearchNode = {
                        boxes: nextBoxes,
                        playerCanon: nextCanon,
                        g: nextG,
                        h: nextH,
                        parent: current,
                        playerBefore: current.playerCanon, // will be used for path BFS
                        boxFrom: boxCell,
                        pushDir: d,
                    };

                    heap.push(nextG + nextH, nextNode);
                }
            }
        }

        return { status: 'unsolvable', nodesExpanded: nodesCount };
    }
}
