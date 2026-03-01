import { generatePuzzle } from '../../src/game/puzzleGenerator';

const seeds = [0, 53, 97];
const coords: Array<{ x: number; y: number }> = [];
for (let x = -10; x <= 10; x += 2) {
  for (let y = -10; y <= 10; y += 2) {
    coords.push({ x, y });
  }
}

let total = 0;
let failed = 0;
let success = 0;

// Per-difficulty counters
const byDiff: Record<number, { total: number; success: number; steps: number[] }> = {};
for (let d = 1; d <= 5; d++) byDiff[d] = { total: 0, success: 0, steps: [] };

for (const seed of seeds) {
  for (const c of coords) {
    for (let difficulty = 1; difficulty <= 5; difficulty++) {
      total++;
      byDiff[difficulty].total++;
      const result = generatePuzzle(c.x, c.y, seed, difficulty);
      if (!result) {
        failed++;
      } else {
        success++;
        byDiff[difficulty].success++;
        if (result.meta.optimalSteps !== undefined) byDiff[difficulty].steps.push(result.meta.optimalSteps);
      }
    }
  }
}

console.log('=== Quick Generator Check ===');
console.log(`Total: ${total}`);
console.log(`Success: ${success}`);
console.log(`Failed (null): ${failed}`);
console.log(`Failure rate: ${((failed / total) * 100).toFixed(2)}%`);
console.log('');
console.log('By difficulty:');
for (let d = 1; d <= 5; d++) {
  const { total: t, success: s, steps } = byDiff[d];
  const avgSteps = steps.length ? (steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(1) : 'n/a';
  console.log(`  D${d}: ${s}/${t} succeeded (${((s/t)*100).toFixed(1)}%), avg steps: ${avgSteps}`);
}
