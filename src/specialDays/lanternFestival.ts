import type { SpecialDayEffect } from './index';

let animationId: number | null = null;
const lanterns: HTMLImageElement[] = [];
let overlay: HTMLDivElement | null = null;

interface Lantern {
  element: HTMLImageElement;
  x: number;
  y: number;
  speed: number;
  drift: number;
}

const lanternData: Lantern[] = [];

function createOverlay(app: HTMLElement): void {
  overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 20, 0.6);
    pointer-events: none;
    z-index: 5;
  `;
  app.appendChild(overlay);
}

function createLanterns(app: HTMLElement): void {
  const variants = ['lantern0.gif', 'lantern1.gif'];

  for (let i = 0; i < 4; i++) {
    const lantern = document.createElement('img');
    lantern.src = `assets/images/${variants[i % 2]}`;
    lantern.style.cssText = `
      position: fixed;
      width: 60px;
      height: 80px;
      pointer-events: none;
      z-index: 6;
    `;

    lanterns.push(lantern);
    app.appendChild(lantern);

    lanternData.push({
      element: lantern,
      x: Math.random() * window.innerWidth,
      y: window.innerHeight + Math.random() * 200,
      speed: 0.1 + Math.random() * 0.2,
      drift: (Math.random() - 0.5) * 0.3
    });
  }
}

function animateLanterns(): void {
  for (const lantern of lanternData) {
    lantern.y -= lantern.speed;
    lantern.x += lantern.drift;

    if (lantern.y < -100) {
      lantern.y = window.innerHeight + 50;
      lantern.x = Math.random() * window.innerWidth;
    }

    lantern.element.style.left = `${lantern.x}px`;
    lantern.element.style.top = `${lantern.y}px`;
  }

  animationId = requestAnimationFrame(animateLanterns);
}

function apply(app: HTMLElement): void {
  createOverlay(app);
  createLanterns(app);
  animateLanterns();
}

function cleanup(): void {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  lanterns.forEach(l => l.remove());
  lanterns.length = 0;
  lanternData.length = 0;

  overlay?.remove();
  overlay = null;
}

export default {
  name: 'Lantern Festival',
  apply,
  cleanup
} as SpecialDayEffect;
