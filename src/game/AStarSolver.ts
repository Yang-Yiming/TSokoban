import { Coordinate } from './types';
import { SokobanMap } from './SokobanMap';

interface GameState {
    player: string; // "x,y"
    boxes: string[]; // ["x,y", ...] sorted
}

class Node {
    public state: GameState;
    public g: number;
    public h: number;
    public parent: Node | null;
    public move: string;

    constructor(
        state: GameState,
        g: number,
        h: number,
        parent: Node | null = null,
        move: string = ""
    ) {
        this.state = state;
        this.g = g;
        this.h = h;
        this.parent = parent;
        this.move = move;
    }

    get f(): number {
        return this.g + this.h;
    }

    getStateKey(): string {
        return `${this.state.player}|${this.state.boxes.join('|')}`;
    }
}

export interface SolverResult {
    status: 'solved' | 'unsolvable' | 'limit-reached';
    path?: string;
    nodesExpanded: number;
}

export class AStarSolver {
    private walls: Set<string> = new Set();
    private goals: Set<string> = new Set();
    private initialMap: SokobanMap;
    private width: number = 0;
    private height: number = 0;

    constructor(initialMap: SokobanMap) {
        this.initialMap = initialMap;
        this.width = initialMap.getWidth();
        this.height = initialMap.getHeight();
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const coord = `${x},${y}`;
                if (initialMap.hasWall(x, y)) this.walls.add(coord);
                if (initialMap.hasGoal(x, y)) this.goals.add(coord);
            }
        }
    }

    private heuristic(boxes: Coordinate[]): number {
        let totalDist = 0;
        const goalCoords = Array.from(this.goals).map(s => {
            const [x, y] = s.split(',').map(Number);
            return new Coordinate(x, y);
        });

        for (const box of boxes) {
            let minDist = Infinity;
            for (const goal of goalCoords) {
                const dist = Math.abs(box.x - goal.x) + Math.abs(box.y - goal.y);
                if (dist < minDist) minDist = dist;
            }
            totalDist += minDist;
        }
        return totalDist;
    }

    private isDeadlock(box: Coordinate): boolean {
        const coord = `${box.x},${box.y}`;
        if (this.goals.has(coord)) return false;

        const up = `${box.x},${box.y - 1}`;
        const down = `${box.x},${box.y + 1}`;
        const left = `${box.x - 1},${box.y}`;
        const right = `${box.x + 1},${box.y}`;

        const wallUp = this.walls.has(up);
        const wallDown = this.walls.has(down);
        const wallLeft = this.walls.has(left);
        const wallRight = this.walls.has(right);

        if ((wallUp || wallDown) && (wallLeft || wallRight)) {
            return true; // Corner deadlock
        }
        return false;
    }

    solve(maxNodes: number = 10000): SolverResult {
        const startPlayer = this.initialMap.getPlayerPosition()!;
        const startBoxes = this.initialMap.getBoxes().map(b => b.toString()).sort();
        
        const startNode = new Node(
            { player: startPlayer.toString(), boxes: startBoxes },
            0,
            this.heuristic(this.initialMap.getBoxes())
        );

        const openList: Node[] = [startNode];
        const closedSet: Set<string> = new Set();
        let nodesCount = 0;

        while (openList.length > 0) {
            if (nodesCount >= maxNodes) {
                return { status: 'limit-reached', nodesExpanded: nodesCount };
            }

            // Simple priority queue: find min f
            let minIdx = 0;
            for (let i = 1; i < openList.length; i++) {
                if (openList[i].f < openList[minIdx].f) minIdx = i;
            }
            const current = openList.splice(minIdx, 1)[0];
            nodesCount++;

            const key = current.getStateKey();
            if (closedSet.has(key)) continue;
            closedSet.add(key);

            // Check win
            if (current.state.boxes.every(b => this.goals.has(b))) {
                return { status: 'solved', path: this.reconstructPath(current), nodesExpanded: nodesCount };
            }

            // Try moves
            const [px, py] = current.state.player.split(',').map(Number);
            const directions = [
                { dx: 0, dy: -1, char: 'w' },
                { dx: 0, dy: 1, char: 's' },
                { dx: -1, dy: 0, char: 'a' },
                { dx: 1, dy: 0, char: 'd' }
            ];

            for (const dir of directions) {
                const nx = px + dir.dx;
                const ny = py + dir.dy;
                const nCoord = `${nx},${ny}`;

                if (this.walls.has(nCoord)) continue;

                if (current.state.boxes.includes(nCoord)) {
                    const bx = nx + dir.dx;
                    const by = ny + dir.dy;
                    const bCoord = `${bx},${by}`;

                    if (this.walls.has(bCoord) || current.state.boxes.includes(bCoord)) continue;
                    if (this.isDeadlock(new Coordinate(bx, by))) continue;

                    const nextBoxes = current.state.boxes.map(b => b === nCoord ? bCoord : b).sort();
                    const nextNode = new Node(
                        { player: nCoord, boxes: nextBoxes },
                        current.g + 1,
                        this.heuristic(nextBoxes.map(s => {
                            const [x, y] = s.split(',').map(Number);
                            return new Coordinate(x, y);
                        })),
                        current,
                        dir.char
                    );
                    openList.push(nextNode);
                } else {
                    const nextNode = new Node(
                        { player: nCoord, boxes: current.state.boxes },
                        current.g + 1,
                        current.h,
                        current,
                        dir.char
                    );
                    openList.push(nextNode);
                }
            }
        }

        return { status: 'unsolvable', nodesExpanded: nodesCount };
    }

    private reconstructPath(node: Node): string {
        let path = "";
        let curr: Node | null = node;
        while (curr && curr.move) {
            path = curr.move + path;
            curr = curr.parent;
        }
        return path;
    }
}
