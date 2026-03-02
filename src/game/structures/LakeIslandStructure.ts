import { getBiomeAt } from '../biomes';
import { SPECIAL_LEVEL_LIBRARY } from '../mapData';
import type { StructureDefinition, StructurePlacement } from '../worldStructures';

const STRUCTURE_ID = 'lake_island';
const DEFAULT_REGION_WIDTH = 140;
const DEFAULT_REGION_HEIGHT = 110;
const DEFAULT_RANDOM_CHANCE_PERCENT = 7;
const MAX_LAKE_RADIUS = 40;

function hashInt(a: number, b: number, c: number, d: number): number {
    let value = (a | 0) ^ ((b * 374761393) | 0) ^ ((c * 668265263) | 0) ^ ((d * 1442695041) | 0);
    value = (value ^ (value >>> 13)) | 0;
    value = Math.imul(value, 1274126177) | 0;
    value = (value ^ (value >>> 16)) | 0;
    return value;
}

function seededRange(seedA: number, seedB: number, seedC: number, seedD: number, min: number, max: number): number {
    const span = max - min + 1;
    const value = Math.abs(hashInt(seedA, seedB, seedC, seedD));
    return min + (value % span);
}

function shouldIncludeCenterInChunk(
    centerX: number,
    centerY: number,
    context: {
        worldMinX: number;
        worldMinY: number;
        fullWidth: number;
        fullHeight: number;
    }
): boolean {
    const minX = context.worldMinX - (MAX_LAKE_RADIUS + 2);
    const minY = context.worldMinY - (MAX_LAKE_RADIUS + 2);
    const maxX = context.worldMinX + context.fullWidth + (MAX_LAKE_RADIUS + 2);
    const maxY = context.worldMinY + context.fullHeight + (MAX_LAKE_RADIUS + 2);
    return centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY;
}

function getSpawnGuaranteedCenter(mapSeed: number): { x: number; y: number } {
    const spawnX = 0;
    const spawnY = seededRange(0, 777, mapSeed, 0, -4, 4);
    const offsetX = seededRange(mapSeed, 7001, 17, 0, -10, 10);
    const offsetY = seededRange(mapSeed, 7001, 23, 0, 40, 56);
    return {
        x: spawnX + offsetX,
        y: spawnY - offsetY
    };
}

function pickHardSpecialLevelId(worldX: number, worldY: number, mapSeed: number): string {
    const all = Object.values(SPECIAL_LEVEL_LIBRARY).filter((entry) => entry.difficulty === 'hard');
    const tagged = all.filter((entry) => entry.tags.includes('lake_island'));
    const pool = tagged.length > 0 ? tagged : all;
    if (pool.length === 0) return 'special_hard_1';

    const index = seededRange(worldX, worldY, mapSeed, 999, 0, pool.length - 1);
    return pool[index].id;
}

function getRandomPlacementForRegion(mapSeed: number, regionX: number, regionY: number): StructurePlacement | null {
    const roll = seededRange(mapSeed, regionX, regionY, 311, 0, 99);
    if (roll >= DEFAULT_RANDOM_CHANCE_PERCENT) return null;

    const centerX = regionX * DEFAULT_REGION_WIDTH + seededRange(mapSeed, regionX, regionY, 401, 22, DEFAULT_REGION_WIDTH - 22);
    const centerY = regionY * DEFAULT_REGION_HEIGHT + seededRange(mapSeed, regionX, regionY, 402, 22, DEFAULT_REGION_HEIGHT - 22);

    if (getBiomeAt(centerX, centerY).id !== 'lake') return null;

    return {
        structureId: STRUCTURE_ID,
        worldX: centerX,
        worldY: centerY,
        seed: hashInt(mapSeed, centerX, centerY, 501)
    };
}

function getLakeIslandCenterAt(worldX: number, worldY: number, mapSeed: number): { x: number; y: number } | null {
    const guaranteed = getSpawnGuaranteedCenter(mapSeed);
    if (worldX === guaranteed.x && worldY === guaranteed.y) {
        return guaranteed;
    }

    const regionX = Math.floor(worldX / DEFAULT_REGION_WIDTH);
    const regionY = Math.floor(worldY / DEFAULT_REGION_HEIGHT);
    const placement = getRandomPlacementForRegion(mapSeed, regionX, regionY);
    if (!placement) return null;

    if (placement.worldX === worldX && placement.worldY === worldY) {
        return { x: placement.worldX, y: placement.worldY };
    }

    return null;
}

function getLakeRadius(placement: StructurePlacement): number {
    return seededRange(placement.seed, placement.worldX, placement.worldY, 701, 22, 40);
}

function getIslandCoreRadius(placement: StructurePlacement): number {
    return seededRange(placement.seed, placement.worldX, placement.worldY, 707, 4, 6);
}

function findContainingIslandPlacement(worldX: number, worldY: number, mapSeed: number): StructurePlacement | null {
    const guaranteedCenter = getSpawnGuaranteedCenter(mapSeed);
    const guaranteedPlacement: StructurePlacement = {
        structureId: STRUCTURE_ID,
        worldX: guaranteedCenter.x,
        worldY: guaranteedCenter.y,
        seed: hashInt(mapSeed, guaranteedCenter.x, guaranteedCenter.y, 601)
    };

    const guaranteedRadius = getLakeRadius(guaranteedPlacement);
    const gdx = worldX - guaranteedPlacement.worldX;
    const gdy = worldY - guaranteedPlacement.worldY;
    if (gdx * gdx + gdy * gdy <= guaranteedRadius * guaranteedRadius) {
        return guaranteedPlacement;
    }

    const regionX = Math.floor(worldX / DEFAULT_REGION_WIDTH);
    const regionY = Math.floor(worldY / DEFAULT_REGION_HEIGHT);
    for (let ry = regionY - 1; ry <= regionY + 1; ry++) {
        for (let rx = regionX - 1; rx <= regionX + 1; rx++) {
            const placement = getRandomPlacementForRegion(mapSeed, rx, ry);
            if (!placement) continue;
            const radius = getLakeRadius(placement);
            const dx = worldX - placement.worldX;
            const dy = worldY - placement.worldY;
            if (dx * dx + dy * dy <= radius * radius) {
                return placement;
            }
        }
    }

    return null;
}

export const lakeIslandStructure: StructureDefinition = {
    id: STRUCTURE_ID,
    enabled: true,
    getPlacementsForChunk(context) {
        const placements: StructurePlacement[] = [];

        const guaranteedCenter = getSpawnGuaranteedCenter(context.mapSeed);
        if (shouldIncludeCenterInChunk(guaranteedCenter.x, guaranteedCenter.y, context)) {
            placements.push({
                structureId: STRUCTURE_ID,
                worldX: guaranteedCenter.x,
                worldY: guaranteedCenter.y,
                seed: hashInt(context.mapSeed, guaranteedCenter.x, guaranteedCenter.y, 601)
            });
        }

        const minRegionX = Math.floor((context.worldMinX - (MAX_LAKE_RADIUS + 1)) / DEFAULT_REGION_WIDTH) - 1;
        const maxRegionX = Math.floor((context.worldMinX + context.fullWidth + (MAX_LAKE_RADIUS + 1)) / DEFAULT_REGION_WIDTH) + 1;
        const minRegionY = Math.floor((context.worldMinY - (MAX_LAKE_RADIUS + 1)) / DEFAULT_REGION_HEIGHT) - 1;
        const maxRegionY = Math.floor((context.worldMinY + context.fullHeight + (MAX_LAKE_RADIUS + 1)) / DEFAULT_REGION_HEIGHT) + 1;

        for (let regionY = minRegionY; regionY <= maxRegionY; regionY++) {
            for (let regionX = minRegionX; regionX <= maxRegionX; regionX++) {
                const placement = getRandomPlacementForRegion(context.mapSeed, regionX, regionY);
                if (!placement) continue;
                if (!shouldIncludeCenterInChunk(placement.worldX, placement.worldY, context)) continue;
                if (placement.worldX === guaranteedCenter.x && placement.worldY === guaranteedCenter.y) continue;
                placements.push(placement);
            }
        }

        return placements;
    },
    stamp(placement, context, api) {
        const lakeRadius = getLakeRadius(placement);
        const islandCoreRadius = getIslandCoreRadius(placement);
        const workRadius = lakeRadius + 2;
        const size = workRadius * 2 + 1;
        const center = workRadius;
        let lakeMask = new Uint8Array(size * size);
        const islandMask = new Uint8Array(size * size);

        const lakeWarpX = seededRange(placement.seed, 11, 0, 0, -2, 2);
        const lakeWarpY = seededRange(placement.seed, 13, 0, 0, -2, 2);
        const islandWarpX = seededRange(placement.seed, 17, 0, 0, -1, 1);
        const islandWarpY = seededRange(placement.seed, 19, 0, 0, -1, 1);

        for (let ly = 0; ly < size; ly++) {
            for (let lx = 0; lx < size; lx++) {
                const dx = lx - center;
                const dy = ly - center;
                const distance = Math.sqrt(dx * dx + dy * dy);

                const boundaryNoise = seededRange(placement.seed, dx, dy, 721, -3, 3);
                const pocketNoise = seededRange(placement.seed, dx, dy, 723, 0, 100);
                const warpedDistance = Math.sqrt((dx - lakeWarpX) * (dx - lakeWarpX) + (dy - lakeWarpY) * (dy - lakeWarpY));
                const edgeThreshold = lakeRadius + boundaryNoise;

                const isLake = (distance <= edgeThreshold && pocketNoise > 18)
                    || (warpedDistance <= lakeRadius - 1 && pocketNoise > 8);
                if (isLake) lakeMask[ly * size + lx] = 1;

                const islandDistance = Math.sqrt(
                    (dx - islandWarpX) * (dx - islandWarpX) + (dy - islandWarpY) * (dy - islandWarpY)
                );
                const islandNoise = seededRange(placement.seed, dx, dy, 727, -1, 0);
                if (islandDistance <= islandCoreRadius + islandNoise) {
                    islandMask[ly * size + lx] = 1;
                }
            }
        }

        // Local CA smoothing for more organic lake outline
        for (let iter = 0; iter < 3; iter++) {
            const nextMask = new Uint8Array(lakeMask);
            for (let ly = 1; ly < size - 1; ly++) {
                for (let lx = 1; lx < size - 1; lx++) {
                    const index = ly * size + lx;
                    if (islandMask[index] === 1) {
                        nextMask[index] = 0;
                        continue;
                    }

                    let waterNeighbors = 0;
                    for (let oy = -1; oy <= 1; oy++) {
                        for (let ox = -1; ox <= 1; ox++) {
                            if (ox === 0 && oy === 0) continue;
                            if (lakeMask[(ly + oy) * size + (lx + ox)] === 1) waterNeighbors++;
                        }
                    }

                    if (lakeMask[index] === 1) {
                        nextMask[index] = waterNeighbors >= 3 ? 1 : 0;
                    } else {
                        nextMask[index] = waterNeighbors >= 5 ? 1 : 0;
                    }
                }
            }
            lakeMask = nextMask;
        }

        // Stamp mask to world
        for (let ly = 0; ly < size; ly++) {
            for (let lx = 0; lx < size; lx++) {
                const index = ly * size + lx;
                const worldX = placement.worldX + (lx - center);
                const worldY = placement.worldY + (ly - center);

                if (worldX === placement.worldX && worldY === placement.worldY) {
                    continue;
                }

                const current = api.getTile(worldX, worldY);
                const isHandcraftedLevel = current > 0 && current < context.tileValues.GENERATED_LEVEL;
                if (isHandcraftedLevel || current === context.tileValues.CHEST) {
                    continue;
                }

                if (islandMask[index] === 1) {
                    api.setTile(worldX, worldY, 0, true);
                } else if (lakeMask[index] === 1) {
                    api.setTile(worldX, worldY, context.tileValues.WATER, true);
                }
            }
        }

        api.setTile(placement.worldX, placement.worldY, context.tileValues.SPECIAL_LEVEL, true);
    },
    resolveSpecialLevelIdAt(worldX, worldY, mapSeed) {
        const center = getLakeIslandCenterAt(worldX, worldY, mapSeed);
        if (!center) return undefined;
        return pickHardSpecialLevelId(center.x, center.y, mapSeed);
    },
    resolveDiscoveryAt(worldX, worldY, mapSeed) {
        const placement = findContainingIslandPlacement(worldX, worldY, mapSeed);
        if (!placement) return undefined;
        return {
            id: STRUCTURE_ID,
            name: '湖心岛'
        };
    }
};
