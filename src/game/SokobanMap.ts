import { Coordinate, TILE_MASK } from './types';

export class SokobanMap {
    private matrix: number[][];
    private width: number;
    private height: number;
    private history: number[][][] = [];

    constructor(data: number[][]) {
        this.height = data.length;
        this.width = data[0].length;
        this.matrix = data.map(row => [...row]);
    }

    getWidth(): number { return this.width; }
    getHeight(): number { return this.height; }

    getTile(x: number, y: number): number {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
        return this.matrix[y][x];
    }

    setTile(x: number, y: number, value: number) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.matrix[y][x] = value;
        }
    }

    hasWall(x: number, y: number): boolean {
        return (this.getTile(x, y) & TILE_MASK.WALL) !== 0;
    }

    hasBox(x: number, y: number): boolean {
        return (this.getTile(x, y) & TILE_MASK.BOX) !== 0;
    }

    hasPlayer(x: number, y: number): boolean {
        return (this.getTile(x, y) & TILE_MASK.PLAYER) !== 0;
    }

    hasGoal(x: number, y: number): boolean {
        return (this.getTile(x, y) & TILE_MASK.GOAL) !== 0;
    }

    getPlayerPosition(): Coordinate | null {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.hasPlayer(x, y)) return new Coordinate(x, y);
            }
        }
        return null;
    }

    getBoxes(): Coordinate[] {
        const boxes: Coordinate[] = [];
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.hasBox(x, y)) boxes.push(new Coordinate(x, y));
            }
        }
        return boxes;
    }

    getGoals(): Coordinate[] {
        const goals: Coordinate[] = [];
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.hasGoal(x, y)) goals.push(new Coordinate(x, y));
            }
        }
        return goals;
    }

    isWin(): boolean {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.hasGoal(x, y) && !this.hasBox(x, y)) return false;
            }
        }
        return true;
    }

    isDeadlock(): boolean {
        const boxes = this.getBoxes();
        for (const box of boxes) {
            if (this.hasGoal(box.x, box.y)) continue;

            const up = this.hasWall(box.x, box.y - 1);
            const down = this.hasWall(box.x, box.y + 1);
            const left = this.hasWall(box.x - 1, box.y);
            const right = this.hasWall(box.x + 1, box.y);

            if ((up && left) || (up && right) || (down && left) || (down && right)) {
                return true;
            }
        }
        return false;
    }

    clone(): SokobanMap {
        return new SokobanMap(this.matrix);
    }

    private pushHistory() {
        this.history.push(this.matrix.map(row => [...row]));
    }

    undo(): boolean {
        const last = this.history.pop();
        if (last) {
            this.matrix = last;
            return true;
        }
        return false;
    }

    // Move logic
    movePlayer(dx: number, dy: number): { moved: boolean, pushedBox?: { x: number, y: number } } {
        const pos = this.getPlayerPosition();
        if (!pos) return { moved: false };

        const nx = pos.x + dx;
        const ny = pos.y + dy;

        if (this.hasWall(nx, ny)) return { moved: false };

        let pushedBox = undefined;
        if (this.hasBox(nx, ny)) {
            const bx = nx + dx;
            const by = ny + dy;
            if (this.hasWall(bx, by) || this.hasBox(bx, by)) return { moved: false };

            this.pushHistory();
            // Move box
            this.setTile(nx, ny, this.getTile(nx, ny) & ~TILE_MASK.BOX);
            this.setTile(bx, by, this.getTile(bx, by) | TILE_MASK.BOX);
            pushedBox = { x: bx, y: by };
        } else {
            this.pushHistory();
        }

        // Move player
        this.setTile(pos.x, pos.y, this.getTile(pos.x, pos.y) & ~TILE_MASK.PLAYER);
        this.setTile(nx, ny, this.getTile(nx, ny) | TILE_MASK.PLAYER);
        return { moved: true, pushedBox };
    }
}
