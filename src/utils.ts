import { themeManager } from './theme';
import { settingsManager } from './settings';

export function generatePseudoRandom(x: number, y: number, z: number): number {
  x ^= x << 6;
  y ^= y << 5;
  z ^= z << 4;
  x ^= x >> 7;
  y ^= y >> 3;
  z ^= z >> 1;
  return (x ^ y ^ z);
}

export function myRand(a: number, b: number, c: number, l: number, r: number): number {
  const seed = parseInt(settingsManager.currentSettings.mapSeed) || 0;
  const randomNumber = generatePseudoRandom(a, b, c ^ seed);
  return (Math.abs(randomNumber) % (r - l + 1)) + l;
}

export function randColor(dx: number, dy: number): string {
  const themeColor = themeManager.currentTheme.color;
  const R = themeColor.r + myRand(dx, dy, 1, -10, 10);
  const G = themeColor.g + myRand(dx, dy, 2, -10, 10);
  const B = themeColor.b + myRand(dx, dy, 3, -10, 10);
  return `rgb(${R}, ${G}, ${B})`;
}

export function randColorBiome(dx: number, dy: number, baseColor: { r: number; g: number; b: number }, variation: number): string {
  const R = baseColor.r + myRand(dx, dy, 1, -variation, variation);
  const G = baseColor.g + myRand(dx, dy, 2, -variation, variation);
  const B = baseColor.b + myRand(dx, dy, 3, -variation, variation);
  return `rgb(${R}, ${G}, ${B})`;
}
