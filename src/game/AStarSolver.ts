import { SokobanMap } from './SokobanMap';
import type { SolverResult } from './AStarSolverV2';
import { AStarSolverV2 } from './AStarSolverV2';
import { AStarSolverF2 } from './AStarSolverF2';

export type { SolverResult };

export class AStarSolver {
    private map: SokobanMap;
    constructor(map: SokobanMap) { this.map = map; }

    solve(maxNodes?: number, deadlineMs?: number): SolverResult {
        const boxCount = this.map.getBoxes().length;
        const impl = boxCount > 5
            ? new AStarSolverF2(this.map)
            : new AStarSolverV2(this.map);
        return impl.solve(maxNodes, deadlineMs);
    }
}
