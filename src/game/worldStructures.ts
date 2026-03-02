export interface StructurePlacement {
    structureId: string;
    worldX: number;
    worldY: number;
    seed: number;
}

export interface StructureDiscovery {
    id: string;
    name: string;
}

export interface StructureTileValues {
    WATER: number;
    ROCK: number;
    CHEST: number;
    GENERATED_LEVEL: number;
    SPECIAL_LEVEL: number;
}

export interface StructureChunkContext {
    mapSeed: number;
    chunkX: number;
    chunkY: number;
    chunkWidth: number;
    chunkHeight: number;
    haloSize: number;
    fullWidth: number;
    fullHeight: number;
    worldMinX: number;
    worldMinY: number;
    tileValues: StructureTileValues;
}

export interface StructureStampApi {
    setTile(worldX: number, worldY: number, value: number, protect?: boolean): void;
    getTile(worldX: number, worldY: number): number;
    isProtected(worldX: number, worldY: number): boolean;
}

export interface StructureDefinition {
    id: string;
    enabled?: boolean;
    getPlacementsForChunk(context: StructureChunkContext): StructurePlacement[];
    stamp(placement: StructurePlacement, context: StructureChunkContext, api: StructureStampApi): void;
    resolveSpecialLevelIdAt?(worldX: number, worldY: number, mapSeed: number): string | undefined;
    resolveDiscoveryAt?(worldX: number, worldY: number, mapSeed: number): StructureDiscovery | undefined;
}

const structureRegistry: StructureDefinition[] = [];

export function registerStructure(definition: StructureDefinition): void {
    if (structureRegistry.some((entry) => entry.id === definition.id)) return;
    structureRegistry.push(definition);
}

export function getRegisteredStructures(): readonly StructureDefinition[] {
    return structureRegistry;
}

export function getStructuresForChunk(
    context: StructureChunkContext,
    definitions: readonly StructureDefinition[] = structureRegistry
): StructurePlacement[] {
    const placements: StructurePlacement[] = [];
    for (const definition of definitions) {
        if (definition.enabled === false) continue;
        const list = definition.getPlacementsForChunk(context);
        if (list.length > 0) placements.push(...list);
    }
    return placements;
}

export function applyStructuresToGrid(
    context: StructureChunkContext,
    grid: Int8Array,
    definitions: readonly StructureDefinition[] = structureRegistry
): { grid: Int8Array; protectionMask: Uint8Array; placements: StructurePlacement[] } {
    const protectionMask = new Uint8Array(context.fullWidth * context.fullHeight);
    const placements = getStructuresForChunk(context, definitions);

    if (placements.length === 0) {
        return { grid, protectionMask, placements };
    }

    const isInBounds = (worldX: number, worldY: number): boolean => {
        const localX = worldX - context.worldMinX;
        const localY = worldY - context.worldMinY;
        return localX >= 0 && localX < context.fullWidth && localY >= 0 && localY < context.fullHeight;
    };

    const toIndex = (worldX: number, worldY: number): number => {
        const localX = worldX - context.worldMinX;
        const localY = worldY - context.worldMinY;
        return localY * context.fullWidth + localX;
    };

    const api: StructureStampApi = {
        setTile: (worldX, worldY, value, protect = false) => {
            if (!isInBounds(worldX, worldY)) return;
            const index = toIndex(worldX, worldY);
            if (protectionMask[index] === 1) return;
            grid[index] = value;
            if (protect) protectionMask[index] = 1;
        },
        getTile: (worldX, worldY) => {
            if (!isInBounds(worldX, worldY)) return 0;
            return grid[toIndex(worldX, worldY)];
        },
        isProtected: (worldX, worldY) => {
            if (!isInBounds(worldX, worldY)) return false;
            return protectionMask[toIndex(worldX, worldY)] === 1;
        }
    };

    for (const placement of placements) {
        const definition = definitions.find((item) => item.id === placement.structureId);
        if (!definition || definition.enabled === false) continue;
        definition.stamp(placement, context, api);
    }

    return { grid, protectionMask, placements };
}

export function resolveSpecialLevelIdAt(
    worldX: number,
    worldY: number,
    mapSeed: number,
    definitions: readonly StructureDefinition[] = structureRegistry
): string | undefined {
    for (const definition of definitions) {
        if (definition.enabled === false || !definition.resolveSpecialLevelIdAt) continue;
        const specialLevelId = definition.resolveSpecialLevelIdAt(worldX, worldY, mapSeed);
        if (specialLevelId) return specialLevelId;
    }
    return undefined;
}

export function resolveStructureDiscoveryAt(
    worldX: number,
    worldY: number,
    mapSeed: number,
    definitions: readonly StructureDefinition[] = structureRegistry
): StructureDiscovery | undefined {
    for (const definition of definitions) {
        if (definition.enabled === false || !definition.resolveDiscoveryAt) continue;
        const discovery = definition.resolveDiscoveryAt(worldX, worldY, mapSeed);
        if (discovery) return discovery;
    }
    return undefined;
}