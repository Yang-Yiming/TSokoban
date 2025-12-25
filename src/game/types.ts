export class Coordinate {
    public x: number;
    public y: number;
    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    equals(other: Coordinate): boolean {
        return this.x === other.x && this.y === other.y;
    }

    toString(): string {
        return `${this.x},${this.y}`;
    }

    add(other: Coordinate): Coordinate {
        return new Coordinate(this.x + other.x, this.y + other.y);
    }

    subtract(other: Coordinate): Coordinate {
        return new Coordinate(this.x - other.x, this.y - other.y);
    }
}

export enum TileType {
    Empty = 0,
    Wall = 1,
    Box = 2,
    Player = 4,
    Goal = 8,
}

export const TILE_MASK = {
    WALL: 1,
    BOX: 2,
    PLAYER: 4,
    GOAL: 8,
};
