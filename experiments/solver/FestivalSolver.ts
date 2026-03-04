/**
 * FestivalSolver — wraps Festival 3.1 (WASM/Node.js) as a child process.
 *
 * Festival is a standalone CLI solver, not a library, so each solve() spawns
 * a Node.js child process running the WASM build. Level data is converted
 * from TSokoban's bitmask format to standard .sok text format via temp files.
 *
 * NOTE: festival.js is compiled as CommonJS (module.exports) but the project
 * uses "type": "module". We keep a festival.cjs copy to avoid ESM parse errors.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SokobanMap } from '../../src/game/SokobanMap';
import { TILE_MASK } from '../../src/game/types';

const FESTIVAL_DIR = join(import.meta.dir, 'festival');
const FESTIVAL_CJS = join(FESTIVAL_DIR, 'festival.cjs');

/** Convert a bitmask tile value to the standard .sok character. */
function tileToSok(tile: number): string {
    const wall   = (tile & TILE_MASK.WALL)   !== 0;
    const box    = (tile & TILE_MASK.BOX)    !== 0;
    const player = (tile & TILE_MASK.PLAYER) !== 0;
    const goal   = (tile & TILE_MASK.GOAL)   !== 0;

    if (wall) return '#';
    if (player && goal) return '+';
    if (box && goal)    return '*';
    if (player)         return '@';
    if (box)            return '$';
    if (goal)           return '.';
    return ' ';
}

/** Convert LURD string (lurdLURD) to wasd path. */
function lurdToWasd(lurd: string): string {
    let out = '';
    for (const ch of lurd) {
        switch (ch.toLowerCase()) {
            case 'l': out += 'a'; break;
            case 'u': out += 'w'; break;
            case 'r': out += 'd'; break;
            case 'd': out += 's'; break;
        }
    }
    return out;
}

export class FestivalSolver {
    private map: SokobanMap;

    constructor(map: SokobanMap) {
        this.map = map;
    }

    solve(
        _maxNodes?: number,
        deadlineMs?: number,
    ): { status: string; path?: string; nodesExpanded: number; peakMemoryBytes?: number } {
        const now = performance.now();
        const remainingMs = deadlineMs != null ? Math.max(0, deadlineMs - now) : 30_000;
        const timeoutSec = Math.max(1, Math.floor(remainingMs / 1000));

        // Create temp directory for .sok input and solution output
        const tmpDir = mkdtempSync(join(tmpdir(), 'festival-'));
        const sokPath = join(tmpDir, 'level.sok');
        const outPath = join(tmpDir, 'solution.txt');

        try {
            // Convert SokobanMap → .sok text
            const w = this.map.getWidth();
            const h = this.map.getHeight();
            const lines: string[] = [];
            for (let y = 0; y < h; y++) {
                let row = '';
                for (let x = 0; x < w; x++) {
                    row += tileToSok(this.map.getTile(x, y));
                }
                lines.push(row.trimEnd());
            }
            writeFileSync(sokPath, lines.join('\n') + '\n');

            // Spawn Festival
            const result = spawnSync('node', [
                FESTIVAL_CJS,
                sokPath,
                '-level', '1',
                '-cores', '1',
                '-time', String(timeoutSec),
                '-out_file', outPath,
            ], {
                cwd: FESTIVAL_DIR,
                timeout: (timeoutSec + 5) * 1000, // safety margin
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            // Try to parse peak memory from process (child process memory isn't directly accessible,
            // but we can check if the output mentions it)
            let peakMemoryBytes: number | undefined;

            // Parse output file for solution
            let outContent = '';
            try {
                outContent = readFileSync(outPath, 'utf-8');
            } catch {
                // Output file may not exist if Festival crashed
            }

            // Look for "Solution " line with LURD
            const solutionMatch = outContent.match(/^Solution\s+(.+)$/m);
            if (solutionMatch) {
                const lurd = solutionMatch[1].trim();
                const path = lurdToWasd(lurd);
                return { status: 'solved', path, nodesExpanded: 0, peakMemoryBytes };
            }

            // Check if process timed out or was killed
            if (result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
                return { status: 'TIMEOUT', nodesExpanded: 0, peakMemoryBytes };
            }

            // Check stderr for known error patterns
            const stderr = result.stderr?.toString() ?? '';
            if (stderr.includes('memory access out of bounds') || stderr.includes('RuntimeError')) {
                return { status: 'error', nodesExpanded: 0, peakMemoryBytes };
            }

            // Check stdout for "no solution" indicators
            const stdout = result.stdout?.toString() ?? '';
            if (stdout.includes('no solution') || stdout.includes('unsolvable')) {
                return { status: 'unsolvable', nodesExpanded: 0, peakMemoryBytes };
            }

            // Festival ran but didn't produce a solution — likely timed out internally
            return { status: 'limit-reached', nodesExpanded: 0, peakMemoryBytes };
        } finally {
            try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}
