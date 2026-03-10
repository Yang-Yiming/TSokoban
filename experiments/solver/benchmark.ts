/**
 * Benchmark — runs a single solver over all level groups.
 * Set SOLVER below to choose which version to use.
 *
 * Run:  bun run solver_update_tmp/benchmark.ts
 */

import { SokobanMap } from '../../src/game/SokobanMap';
import { AStarSolverV2 } from './AStarSolverV2';
import { AStarSolverF1 } from './AStarSolverF1';
import { AStarSolverF2 } from './AStarSolverF2';
import { AStarSolverF3 } from './AStarSolverF3';
import { GROUPS } from './levels';

// ─── Solver selection ─────────────────────────────────────────────────────
// v2 = A* optimal
// f1 = Weighted A* (w=1.5) + frozen-box deadlock
// f2 = F1 + BFS push-distance heuristic  ← best for hard levels
// f3 = F2 + best-g/open pruning + local 2×2 + low-allocation successor updates
const SOLVER: 'v2' | 'f1' | 'f2' | 'f3' = 'f3';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(2)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

function formatBytes(bytes: number): string {
    if (Math.abs(bytes) < 1024) return `${bytes} B`;
    if (Math.abs(bytes) < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const COL = { lvl: 3, diff: 6, status: 13, time: 11, nodes: 10, heap: 10 };
const SEP = '-'.repeat(74);

function header() {
    const label =
        SOLVER === 'v2' ? 'AStarSolverV2  — A* (optimal, w=1.0)' :
        SOLVER === 'f1' ? 'AStarSolverF1  — Weighted A* (w=1.5) + frozen-box' :
        SOLVER === 'f2' ? 'AStarSolverF2  — Weighted A* (w=1.5) + frozen-box + BFS push-dist' :
                          'AStarSolverF3  — F2 + best-g/open pruning + local 2×2 + low-allocation successor';
    console.log(`Solver: ${label}`);
    console.log(SEP);
    console.log(
        `${'#'.padStart(COL.lvl)}  ${'Diff'.padEnd(COL.diff)}  ${'Status'.padEnd(COL.status)}` +
        `  ${'Time'.padStart(COL.time)}  ${'Nodes'.padStart(COL.nodes)}  ${'Heap Δ'.padStart(COL.heap)}  Path`
    );
    console.log(SEP);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const MAX_NODES = 2_000_000;

header();

let grandTime  = 0;
let grandNodes = 0;
let globalIdx  = 0;

for (const group of GROUPS) {
    let groupTime  = 0;
    let groupNodes = 0;

    for (const levelData of group.levels) {
        globalIdx++;
        const map    = new SokobanMap(levelData);
        const solver =
            SOLVER === 'v2' ? new AStarSolverV2(map) :
            SOLVER === 'f1' ? new AStarSolverF1(map) :
            SOLVER === 'f2' ? new AStarSolverF2(map) :
                              new AStarSolverF3(map);

        if (typeof globalThis.gc === 'function') globalThis.gc();

        const heapBefore = process.memoryUsage().heapUsed;
        const t0         = performance.now();
        const result     = solver.solve(MAX_NODES);
        const elapsed    = performance.now() - t0;
        const heapDelta  = process.memoryUsage().heapUsed - heapBefore;

        groupTime  += elapsed;
        groupNodes += result.nodesExpanded;

        const pathStr = result.path != null ? `len=${result.path.length}` : '';
        console.log(
            `${String(globalIdx).padStart(COL.lvl)}  ${group.label.padEnd(COL.diff)}  ${result.status.padEnd(COL.status)}` +
            `  ${formatMs(elapsed).padStart(COL.time)}  ${result.nodesExpanded.toLocaleString().padStart(COL.nodes)}` +
            `  ${formatBytes(heapDelta).padStart(COL.heap)}  ${pathStr}`
        );
    }

    grandTime  += groupTime;
    grandNodes += groupNodes;

    // Group avg
    const groupCount = group.levels.length;
    console.log(
        `${''.padStart(COL.lvl)}  ${`[${group.label}]`.padEnd(COL.diff)}  ${'avg'.padEnd(COL.status)}` +
        `  ${formatMs(groupTime / groupCount).padStart(COL.time)}  ${Math.round(groupNodes / groupCount).toLocaleString().padStart(COL.nodes)}`
    );
    console.log(SEP);
}

// Grand avg
console.log(
    `${''.padStart(COL.lvl)}  ${'[ALL]'.padEnd(COL.diff)}  ${'avg'.padEnd(COL.status)}` +
    `  ${formatMs(grandTime / globalIdx).padStart(COL.time)}  ${Math.round(grandNodes / globalIdx).toLocaleString().padStart(COL.nodes)}`
);
