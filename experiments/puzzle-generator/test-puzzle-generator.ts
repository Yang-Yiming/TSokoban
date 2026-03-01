import { generatePuzzle } from '../../src/game/puzzleGenerator';

type Sample = {
  worldX: number;
  worldY: number;
  seed: number;
  difficulty: number;
};

const FALLBACK_SHAPE = {
  width: 5,
  height: 5,
  signature: [
    [1, 1, 1, 1, 1],
    [1, 0, 8, 0, 1],
    [1, 4, 2, 0, 1],
    [1, 0, 2, 8, 1],
    [1, 1, 1, 1, 1],
  ],
};

function isFallback(data: number[][]): boolean {
  if (data.length !== FALLBACK_SHAPE.height) return false;
  if (data.some((row) => row.length !== FALLBACK_SHAPE.width)) return false;

  for (let y = 0; y < FALLBACK_SHAPE.height; y++) {
    for (let x = 0; x < FALLBACK_SHAPE.width; x++) {
      if (data[y][x] !== FALLBACK_SHAPE.signature[y][x]) return false;
    }
  }
  return true;
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function runTest() {
  const seeds = [0, 1, 7, 53, 97, 12345, -42];
  const coords = range(-20, 20)
    .flatMap((x) => range(-20, 20).map((y) => ({ x, y })))
    .filter(({ x, y }) => (Math.abs(x) + Math.abs(y)) % 4 === 0);

  const difficulties = [1, 2, 3, 4, 5];

  const allSamples: Sample[] = [];
  for (const seed of seeds) {
    for (const { x, y } of coords) {
      for (const difficulty of difficulties) {
        allSamples.push({ worldX: x, worldY: y, seed, difficulty });
      }
    }
  }

  let fallbackCount = 0;
  let generatedCount = 0;
  const byDifficulty = new Map<number, { total: number; fallback: number }>();
  const fallbackExamples: Sample[] = [];
  const nonFallbackExamples: Array<Sample & { width: number; height: number; optimalSteps?: number }> = [];

  for (const sample of allSamples) {
    const result = generatePuzzle(sample.worldX, sample.worldY, sample.seed, sample.difficulty);

    if (!result) {
      fallbackCount++;
      const stats = byDifficulty.get(sample.difficulty) ?? { total: 0, fallback: 0 };
      stats.total++;
      stats.fallback++;
      byDifficulty.set(sample.difficulty, stats);
      if (fallbackExamples.length < 5) fallbackExamples.push(sample);
      continue;
    }

    const fallback = isFallback(result.data);
    const stats = byDifficulty.get(sample.difficulty) ?? { total: 0, fallback: 0 };
    stats.total++;
    if (fallback) {
      stats.fallback++;
      fallbackCount++;
      if (fallbackExamples.length < 5) fallbackExamples.push(sample);
    } else {
      generatedCount++;
      if (nonFallbackExamples.length < 5) {
        nonFallbackExamples.push({
          ...sample,
          width: result.data[0]?.length ?? 0,
          height: result.data.length,
          optimalSteps: result.meta.optimalSteps,
        });
      }
    }
    byDifficulty.set(sample.difficulty, stats);
  }

  const total = allSamples.length;
  const fallbackRate = ((fallbackCount / total) * 100).toFixed(2);

  console.log('=== Puzzle Generator Smoke Test ===');
  console.log(`Total samples: ${total}`);
  console.log(`Fallback count: ${fallbackCount}`);
  console.log(`Generated (non-fallback) count: ${generatedCount}`);
  console.log(`Fallback rate: ${fallbackRate}%`);
  console.log('');

  console.log('By difficulty:');
  for (const d of difficulties) {
    const stats = byDifficulty.get(d) ?? { total: 0, fallback: 0 };
    const rate = stats.total > 0 ? ((stats.fallback / stats.total) * 100).toFixed(2) : '0.00';
    console.log(`  D${d}: fallback ${stats.fallback}/${stats.total} (${rate}%)`);
  }

  console.log('');
  console.log('Fallback examples:', fallbackExamples);
  console.log('Non-fallback examples:', nonFallbackExamples);
}

runTest();
