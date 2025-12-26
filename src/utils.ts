import { themeManager } from './theme';

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
  const randomNumber = generatePseudoRandom(a, b, c);
  return (randomNumber % (r - l + 1)) + l;
}

export function randColor(dx: number, dy: number): string {
  const themeColor = themeManager.currentTheme.color;
  const R = themeColor.r + myRand(dx, dy, 1, -10, 10);
  const G = themeColor.g + myRand(dx, dy, 2, -10, 10);
  const B = themeColor.b + myRand(dx, dy, 3, -10, 10);
  return `rgb(${R}, ${G}, ${B})`;
}
