import type { SpecialDayEffect } from './index';
import { themeManager, THEMES } from '../theme';

let animationId: number | null = null;
const lanterns: HTMLImageElement[] = [];
let originalThemeIndex: number | null = null;
const stars: HTMLDivElement[] = [];
let styleElement: HTMLStyleElement | null = null;

interface Lantern {
  element: HTMLImageElement;
  x: number;
  y: number;
  speed: number;
  drift: number;
}

const lanternData: Lantern[] = [];

function createStars(container: HTMLElement, count: number): void {
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.style.cssText = `
      position: absolute;
      width: ${1 + Math.random() * 2}px;
      height: ${1 + Math.random() * 2}px;
      background: ${Math.random() > 0.5 ? '#fff' : '#fffacd'};
      border-radius: 50%;
      opacity: ${0.3 + Math.random() * 0.5};
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      pointer-events: none;
      z-index: 5;
    `;
    container.appendChild(star);
    stars.push(star);
  }
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
      filter: brightness(0.7) drop-shadow(0 0 20px rgba(255, 200, 100, 0.6));
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
  // Store and switch theme to 深灰蓝 (index 3)
  originalThemeIndex = THEMES.findIndex(t => t.name === themeManager.currentTheme.name);
  themeManager.setTheme(3);

  // Add stars to menu
  createStars(app, 18);

  // Create lanterns with glow
  createLanterns(app);
  animateLanterns();

  // Add body class and inject styles for night atmosphere
  document.body.classList.add('lantern-festival');
  styleElement = document.createElement('style');
  styleElement.textContent = `
    body.lantern-festival {
      background: #2a3a4a !important;
    }
    body.lantern-festival #app {
      background: linear-gradient(to bottom, #1a2a3a, #6a7a8a) !important;
    }
    body.lantern-festival .cloud {
      filter: brightness(0.3) !important;
    }
    body.lantern-festival #title {
      filter: brightness(1.8) !important;
    }
    body.lantern-festival .icon-btn img {
      filter: brightness(1.8) !important;
    }
    body.lantern-festival button,
    body.lantern-festival .menu-button {
      color: #f0f0f0 !important;
      text-shadow: 0 0 10px rgba(255, 200, 100, 0.5);
    }
    body.lantern-festival #game-container {
      background: radial-gradient(ellipse at center, #2d3e50 0%, #1a2a3a 100%) !important;
    }
  `;
  document.head.appendChild(styleElement);
}

function cleanup(): void {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  lanterns.forEach(l => l.remove());
  lanterns.length = 0;
  lanternData.length = 0;

  stars.forEach(s => s.remove());
  stars.length = 0;

  // Restore theme
  if (originalThemeIndex !== null) {
    themeManager.setTheme(originalThemeIndex);
    originalThemeIndex = null;
  }

  // Remove body class and style element
  document.body.classList.remove('lantern-festival');
  styleElement?.remove();
  styleElement = null;
}

export default {
  name: 'Lantern Festival',
  apply,
  cleanup
} as SpecialDayEffect;
