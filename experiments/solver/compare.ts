/**
 * compare.ts — side-by-side comparison of V2 / V3 / V4
 *
 * Runs all three solvers on every level and prints:
 *   • Per-group average time & nodes for each solver
 *   • Speedup ratios (V3 vs V2, V4 vs V2, V4 vs V3)
 *   • Per-level summary showing if any solver differs in status
 *
 * Run:  bun run solver_update_tmp/compare.ts
 */

import { SokobanMap } from '../../src/game/SokobanMap';
import { AStarSolverV2 } from './AStarSolverV2';
import { AStarSolverV3 } from './AStarSolverV3';
import { AStarSolverV4 } from './AStarSolverV4';
import { GROUPS } from './levels';

// ─── Config ───────────────────────────────────────────────────────────────────
const TIMEOUT_MS = 2_000;    // per-solver wall-clock budget; marks as TIMEOUT if exceeded
const MAX_NODES  = 5_000_000; // hard node ceiling (safety valve)

// ─── Types & helpers ──────────────────────────────────────────────────────────

interface RunResult {
    status: string;    // 'solved' | 'unsolvable' | 'limit-reached' | 'timeout'
    timeMs: number;
    nodes: number;
    pathLen: number | null;
}

function fmt(ms: number): string {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s `;
    return `${ms.toFixed(1).padStart(7)} ms`;
}

function fmtNodes(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function ratio(a: number, b: number): string {
    if (b === 0) return '  —  ';
    const r = a / b;
    const tag = r > 1 ? `×${r.toFixed(2)} slower` : `×${(1/r).toFixed(2)} faster`;
    return tag.padStart(14);
}

// ─── Run one solver on one level (time-capped) ────────────────────────────────

type Factory = (m: SokobanMap) => { solve(n: number, deadline: number): { status: string; path?: string; nodesExpanded: number } };

function run(factory: Factory, levelData: number[][]): RunResult {
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const map      = new SokobanMap(levelData);
    const solver   = factory(map);
    const t0       = performance.now();
    const deadline = t0 + TIMEOUT_MS;
    const result   = solver.solve(MAX_NODES, deadline);
    const elapsed  = performance.now() - t0;
    const status   = elapsed >= TIMEOUT_MS && result.status !== 'solved'
        ? 'TIMEOUT'
        : result.status;
    return {
        status,
        timeMs:  elapsed,
        nodes:   result.nodesExpanded,
        pathLen: result.path != null ? result.path.length : null,
    };
}

// ─── Solvers ──────────────────────────────────────────────────────────────────

const SOLVERS: Array<{ label: string; factory: Factory }> = [
    { label: 'V2', factory: m => new AStarSolverV2(m) },
    { label: 'V3', factory: m => new AStarSolverV3(m) },
    { label: 'V4', factory: m => new AStarSolverV4(m) },
];

// ─── Collect results ──────────────────────────────────────────────────────────

type GroupResults = Array<{ lvl: number; results: RunResult[] }>;

const allGroupData: Array<{ label: string; data: GroupResults }> = [];

let globalLvl = 0;
for (const group of GROUPS) {
    const data: GroupResults = [];
    for (const levelData of group.levels) {
        globalLvl++;
        const results = SOLVERS.map(s => run(s.factory, levelData));
        data.push({ lvl: globalLvl, results });

        // Live progress dot
        process.stdout.write('.');
    }
    process.stdout.write('\n');
    allGroupData.push({ label: group.label, data });
}

// ─── Output ───────────────────────────────────────────────────────────────────

const W1 = 8, W2 = 10;
const HDR_SEP = '-'.repeat(78);
const HDR_BIG = '='.repeat(78);

console.log('\n' + HDR_BIG);
console.log(`  Comparison  (timeout = ${TIMEOUT_MS}ms per solver,  max nodes = ${MAX_NODES.toLocaleString()})`);
console.log(HDR_BIG);

for (const { label, data } of allGroupData) {
    // ── Per-level table (only show deviating statuses) ────────────────────────
    const hasDiff = data.some(({ results }) => {
        const [r2, r3, r4] = results;
        return r2.status !== r3.status || r2.status !== r4.status;
    });

    if (hasDiff) {
        console.log(`\n  [${label}] status differences:`);
        for (const { lvl, results } of data) {
            const [r2, r3, r4] = results;
            if (r2.status !== r3.status || r2.status !== r4.status) {
                console.log(`    #${lvl}  V2=${r2.status}  V3=${r3.status}  V4=${r4.status}`);
            }
        }
    }

    // ── Group averages ────────────────────────────────────────────────────────
    const avgTime  = SOLVERS.map((_, si) =>
        data.reduce((s, { results }) => s + results[si].timeMs, 0) / data.length);
    const avgNodes = SOLVERS.map((_, si) =>
        Math.round(data.reduce((s, { results }) => s + results[si].nodes, 0) / data.length));

    console.log(`\n${HDR_SEP}`);
    console.log(`  [${label}]  ${data.length} level(s)  —  avg time & nodes`);
    console.log(HDR_SEP);
    console.log(
        `  ${'Solver'.padEnd(6)}  ${'Avg Time'.padStart(W1)}  ${'Avg Nodes'.padStart(W2)}` +
        `  ${'vs V2'.padStart(16)}  ${'vs V3'.padStart(16)}`
    );
    console.log(`  ${'-'.repeat(6)}  ${'-'.repeat(W1)}  ${'-'.repeat(W2)}  ${'-'.repeat(16)}  ${'-'.repeat(16)}`);

    for (let si = 0; si < SOLVERS.length; si++) {
        const vsV2 = si === 0 ? '      baseline' : ratio(avgTime[si], avgTime[0]);
        const vsV3 = si <= 1  ? '             —' : ratio(avgTime[si], avgTime[1]);
        console.log(
            `  ${SOLVERS[si].label.padEnd(6)}  ${fmt(avgTime[si]).padStart(W1)}  ` +
            `${fmtNodes(avgNodes[si]).padStart(W2)}  ${vsV2}  ${vsV3}`
        );
    }
}

// ─── Grand summary ────────────────────────────────────────────────────────────

const allData = allGroupData.flatMap(g => g.data);
const grandAvgTime  = SOLVERS.map((_, si) =>
    allData.reduce((s, { results }) => s + results[si].timeMs, 0) / allData.length);
const grandAvgNodes = SOLVERS.map((_, si) =>
    Math.round(allData.reduce((s, { results }) => s + results[si].nodes, 0) / allData.length));

console.log(`\n${HDR_SEP}`);
console.log(`  [ALL]  ${allData.length} levels total`);
console.log(HDR_SEP);
console.log(
    `  ${'Solver'.padEnd(6)}  ${'Avg Time'.padStart(W1)}  ${'Avg Nodes'.padStart(W2)}` +
    `  ${'vs V2'.padStart(16)}  ${'vs V3'.padStart(16)}`
);
console.log(`  ${'-'.repeat(6)}  ${'-'.repeat(W1)}  ${'-'.repeat(W2)}  ${'-'.repeat(16)}  ${'-'.repeat(16)}`);

for (let si = 0; si < SOLVERS.length; si++) {
    const vsV2 = si === 0 ? '      baseline' : ratio(grandAvgTime[si], grandAvgTime[0]);
    const vsV3 = si <= 1  ? '             —' : ratio(grandAvgTime[si], grandAvgTime[1]);
    console.log(
        `  ${SOLVERS[si].label.padEnd(6)}  ${fmt(grandAvgTime[si]).padStart(W1)}  ` +
        `${fmtNodes(grandAvgNodes[si]).padStart(W2)}  ${vsV2}  ${vsV3}`
    );
}
console.log();
