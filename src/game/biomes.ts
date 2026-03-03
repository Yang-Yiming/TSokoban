import { myRand } from '../utils';

export type BiomeId = 'grassland' | 'lake' | 'highlands' | 'darkforest';

export interface BiomeDef {
    id: BiomeId;
    name: string;
    baseColor: { r: number; g: number; b: number };
    colorVariation: number;
    waterLargeZoneChance: number;
    waterMediumZoneChance: number;
    waterFillProb: number;
    rockBaseProb: number;
    waterColors: { deep: string; mid: string; light: string };
    bushSprites: [string, string, string];
    lilySprites: [string, string, string] | null;
    flowerChance: number;
    flowerPetalColor: string;
    flowerCenterColor: string;
}

export const BIOME_DEFS: Record<BiomeId, BiomeDef> = {
    grassland: {
        id: 'grassland',
        name: '草原',
        baseColor: { r: 124, g: 153, b: 32 },
        colorVariation: 10,
        waterLargeZoneChance: 8,
        waterMediumZoneChance: 45,
        waterFillProb: 55,
        rockBaseProb: 10,
        waterColors: { deep: '#4c6e78', mid: '#5d9798', light: '#77ad9d' },
        bushSprites: [
            '/assets/images/bush/Snow_bush1.png',
            '/assets/images/bush/Snow_bush2.png',
            '/assets/images/bush/Snow_bush3.png',
        ],
        lilySprites: [
            '/assets/images/bush/lily1.png',
            '/assets/images/bush/lily2.png',
            '/assets/images/bush/lily3.png',
        ],
        flowerChance: 6,
        flowerPetalColor: 'white',
        flowerCenterColor: '#f0c864',
    },
    lake: {
        id: 'lake',
        name: '湖区',
        baseColor: { r: 68, g: 98, b: 94 },
        colorVariation: 8,
        waterLargeZoneChance: 25,
        waterMediumZoneChance: 65,
        waterFillProb: 62,
        rockBaseProb: 3,
        waterColors: { deep: '#2e4f5a', mid: '#3d7080', light: '#5a9aa0' },
        bushSprites: [
            '/assets/images/bush/Fern1_1.png',
            '/assets/images/bush/Fern1_2.png',
            '/assets/images/bush/Fern1_3.png',
        ],
        lilySprites: [
            '/assets/images/bush/lily11.png',
            '/assets/images/bush/lily22.png',
            '/assets/images/bush/lily33.png',
        ],
        flowerChance: 4,
        flowerPetalColor: '#c8e0ff',
        flowerCenterColor: '#a0c8e8',
    },
    highlands: {
        id: 'highlands',
        name: '山地',
        baseColor: { r: 174, g: 164, b: 154 },
        colorVariation: 12,
        waterLargeZoneChance: 2,
        waterMediumZoneChance: 15,
        waterFillProb: 40,
        rockBaseProb: 30,
        waterColors: { deep: '#5a6a6e', mid: '#7a8e8a', light: '#9aaba0' },
        bushSprites: [
            '/assets/images/bush/Autumn_bush1.png',
            '/assets/images/bush/Autumn_bush2.png',
            '/assets/images/bush/Autumn_bush3.png',
        ],
        lilySprites: null,
        flowerChance: 12,
        flowerPetalColor: '#e8d8f0',
        flowerCenterColor: '#c8b0d0',
    },
    darkforest: {
        id: 'darkforest',
        name: '暗森林',
        baseColor: { r: 62, g: 48, b: 58 },
        colorVariation: 6,
        waterLargeZoneChance: 5,
        waterMediumZoneChance: 20,
        waterFillProb: 50,
        rockBaseProb: 22,
        waterColors: { deep: '#1e2a2e', mid: '#2e3e3a', light: '#3e5048' },
        bushSprites: [
            '/assets/images/bush/Broken_tree1.png',
            '/assets/images/bush/Broken_tree2.png',
            '/assets/images/bush/Bush_simple1_1.png',
        ],
        lilySprites: null,
        flowerChance: 20,
        flowerPetalColor: '#f1939c',
        flowerCenterColor: '#d07080',
    },
};

const BIOME_UNIT = 120;
const BLEND_BORDER = 8;

const BIOME_IDS: BiomeId[] = ['grassland', 'lake', 'highlands', 'darkforest'];

const SPAWN_BIOME_DEFS: BiomeDef[] = [
    // Theme 0: 苔藓绿
    { ...BIOME_DEFS.grassland, name: '出生地' },
    // Theme 1: 春梅红
    { ...BIOME_DEFS.grassland, name: '出生地', baseColor: { r: 241, g: 147, b: 156 }, flowerPetalColor: '#ffc0cb', flowerCenterColor: '#ff69b4' },
    // Theme 2: 远山紫
    { ...BIOME_DEFS.highlands, name: '出生地' },
    // Theme 3: 深灰蓝
    { ...BIOME_DEFS.lake, name: '出生地' },
    // Theme 4: yym色
    { ...BIOME_DEFS.grassland, name: '出生地', baseColor: { r: 124, g: 113, b: 32 } },
    // Theme 5: gyx色
    { ...BIOME_DEFS.grassland, name: '出生地', baseColor: { r: 124, g: 111, b: 52 } },
];

function pickBiomeId(biomeX: number, biomeY: number): BiomeId {
    const dist = Math.sqrt(biomeX * biomeX + biomeY * biomeY);
    const roll = myRand(biomeX, biomeY, 7777, 0, 99);

    if (dist < 2) {
        return 'grassland';
    } else if (dist <= 5) {
        // grassland 40%, lake 35%, highlands 25%
        if (roll < 40) return 'grassland';
        if (roll < 75) return 'lake';
        return 'highlands';
    } else {
        // each 25%
        if (roll < 25) return 'grassland';
        if (roll < 50) return 'lake';
        if (roll < 75) return 'highlands';
        return 'darkforest';
    }
}

function getBiomeForUnit(bx: number, by: number, themeIndex: number): BiomeDef {
    if (bx >= -1 && bx <= 0 && by >= -1 && by <= 0) {
        return SPAWN_BIOME_DEFS[themeIndex];
    }
    return BIOME_DEFS[pickBiomeId(bx, by)];
}

function isSameBiome(b1: BiomeDef, b2: BiomeDef): boolean {
    return b1.id === b2.id &&
           b1.baseColor.r === b2.baseColor.r &&
           b1.baseColor.g === b2.baseColor.g &&
           b1.baseColor.b === b2.baseColor.b;
}

/**
 * Get the biome definition for a given world tile coordinate.
 * At biome boundaries (within BLEND_BORDER tiles), there's a probability-based
 * blend that may return a neighboring biome's definition for smoother transitions.
 */
export function getBiomeAt(x: number, y: number, themeIndex?: number): BiomeDef {
    const biomeX = Math.floor(x / BIOME_UNIT);
    const biomeY = Math.floor(y / BIOME_UNIT);
    const theme = themeIndex ?? 0;

    const primaryBiome = getBiomeForUnit(biomeX, biomeY, theme);

    // Unified boundary blending logic
    const localX = ((x % BIOME_UNIT) + BIOME_UNIT) % BIOME_UNIT;
    const localY = ((y % BIOME_UNIT) + BIOME_UNIT) % BIOME_UNIT;
    const distToEdgeX = Math.min(localX, BIOME_UNIT - 1 - localX);
    const distToEdgeY = Math.min(localY, BIOME_UNIT - 1 - localY);
    const distToEdge = Math.min(distToEdgeX, distToEdgeY);

    if (distToEdge < BLEND_BORDER) {
        let neighborBX = biomeX;
        let neighborBY = biomeY;
        if (distToEdgeX <= distToEdgeY) {
            neighborBX += (localX < BIOME_UNIT / 2) ? -1 : 1;
        } else {
            neighborBY += (localY < BIOME_UNIT / 2) ? -1 : 1;
        }

        const neighborBiome = getBiomeForUnit(neighborBX, neighborBY, theme);
        if (!isSameBiome(neighborBiome, primaryBiome)) {
            const blendChance = Math.floor(((BLEND_BORDER - distToEdge) / BLEND_BORDER) * 50);
            if (myRand(x, y, 8888, 0, 99) < blendChance) {
                return neighborBiome;
            }
        }
    }

    return primaryBiome;
}

/** Get all unique sprite paths across all biomes for preloading */
export function getAllBiomeSpritesPaths(): string[] {
    const paths = new Set<string>();
    for (const id of BIOME_IDS) {
        const def = BIOME_DEFS[id];
        for (const s of def.bushSprites) paths.add(s);
        if (def.lilySprites) {
            for (const s of def.lilySprites) paths.add(s);
        }
    }
    return Array.from(paths);
}
