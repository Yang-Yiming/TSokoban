/**
 * FestivalSolver — Rust Festival solver via WASM
 *
 * Converts SokobanMap bitmask to XSB, calls the Rust WASM solver,
 * and converts LURD output back to WASD paths.
 */

import { SokobanMap } from '../../src/game/SokobanMap';
import { solve_xsb } from './festival_wasm/festival_wasm';
import type { SolverResult } from './AStarSolverF3';

// Bitmask values from src/game/types.ts
const WALL   = 1;
const BOX    = 2;
const PLAYER = 4;
const GOAL   = 8;

function mapToXsb(map: SokobanMap): string {
    const rows: string[] = [];
    const w = map.getWidth();
    const h = map.getHeight();
    for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) {
            const tile = map.getTile(x, y);
            const isWall   = (tile & WALL)   !== 0;
            const isBox    = (tile & BOX)    !== 0;
            const isPlayer = (tile & PLAYER) !== 0;
            const isGoal   = (tile & GOAL)   !== 0;

            if (isWall)                 row += '#';
            else if (isBox && isGoal)   row += '*';
            else if (isPlayer && isGoal) row += '+';
            else if (isBox)             row += '$';
            else if (isPlayer)          row += '@';
            else if (isGoal)            row += '.';
            else                        row += ' ';
        }
        rows.push(row);
    }
    return rows.join('\n');
}

// LURD → WASD
const LURD_TO_WASD: Record<string, string> = {
    'U': 'w', 'D': 's', 'L': 'a', 'R': 'd',
};

function convertLurdToWasd(lurd: string): string {
    let result = '';
    for (const ch of lurd) {
        result += LURD_TO_WASD[ch] ?? ch;
    }
    return result;
}

export class FestivalSolver {
    private map: SokobanMap;

    constructor(map: SokobanMap) {
        this.map = map;
    }

    solve(_maxNodes = 200_000, deadlineMs = Infinity): SolverResult {
        const timeLimitSecs = deadlineMs === Infinity
            ? 600
            : Math.max(1, Math.ceil((deadlineMs - performance.now()) / 1000));

        const xsb = mapToXsb(this.map);
        const raw = solve_xsb(xsb, timeLimitSecs, 0);
        const json = JSON.parse(raw) as {
            status: string;
            solution?: string;
            message?: string;
        };

        if (json.status === 'solved' && json.solution) {
            return {
                status: 'solved',
                path: convertLurdToWasd(json.solution),
                nodesExpanded: 0,
            };
        }

        if (json.status === 'error') {
            return { status: 'limit-reached', nodesExpanded: 0 };
        }

        return { status: 'limit-reached', nodesExpanded: 0 };
    }
}
