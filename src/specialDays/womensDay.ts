import type { SpecialDayEffect } from './index';
import { themeManager, THEMES } from '../theme';

let animationId: number | null = null;
const petals: HTMLDivElement[] = [];
let originalThemeIndex: number | null = null;
let styleElement: HTMLStyleElement | null = null;

interface Petal {
  element: HTMLDivElement;
  x: number;
  y: number;
  speed: number;
  sway: number;
  swayOffset: number;
  rotation: number;
  rotationSpeed: number;
}

const petalData: Petal[] = [];

// Weighted emoji pool: 🌸 30%, 🌷 20%, rest 10% each
const EMOJI_POOL = ['🌸','🌸','🌸','🌷','🌷','🌹','💐','🌺','🌻','💮'];

function pickEmoji(): string {
  return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
}

function createPetals(app: HTMLElement): void {
  for (let i = 0; i < 8; i++) {
    const petal = document.createElement('div');
    const size = 20 + Math.random() * 20;
    petal.textContent = pickEmoji();
    petal.style.cssText = `
      position: fixed;
      font-size: ${size}px;
      opacity: ${0.6 + Math.random() * 0.4};
      pointer-events: none;
      z-index: 6;
      user-select: none;
    `;

    petals.push(petal);
    app.appendChild(petal);

    petalData.push({
      element: petal,
      x: Math.random() * window.innerWidth,
      y: -(Math.random() * 200),
      speed: 0.3 + Math.random() * 0.4,
      sway: 30 + Math.random() * 40,
      swayOffset: Math.random() * Math.PI * 2,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 2
    });
  }
}

function animatePetals(): void {
  const time = Date.now() / 1000;

  for (const p of petalData) {
    p.y += p.speed;
    p.rotation += p.rotationSpeed;
    const swayX = Math.sin(time + p.swayOffset) * p.sway;

    if (p.y > window.innerHeight + 50) {
      p.y = -50;
      p.x = Math.random() * window.innerWidth;
      p.element.textContent = pickEmoji();
    }

    p.element.style.left = `${p.x + swayX}px`;
    p.element.style.top = `${p.y}px`;
    p.element.style.transform = `rotate(${p.rotation}deg)`;
  }

  animationId = requestAnimationFrame(animatePetals);
}

function apply(app: HTMLElement): void {
  // Store and switch theme to 春梅红 (index 1)
  originalThemeIndex = THEMES.findIndex(t => t.name === themeManager.currentTheme.name);
  themeManager.setTheme(1);

  // Create falling flower petals
  createPetals(app);
  animatePetals();

  // Add body class and inject styles for spring atmosphere
  document.body.classList.add('womens-day');
  styleElement = document.createElement('style');
  styleElement.textContent = `
    body.womens-day {
      background: linear-gradient(to bottom, #fce4ec, #f8bbd0) !important;
    }
    body.womens-day #app {
      background: linear-gradient(to bottom, #fce4ec, #f3e5f5) !important;
    }
    body.womens-day .cloud {
      filter: brightness(1.05) saturate(1.2) hue-rotate(-10deg) !important;
    }
    body.womens-day button,
    body.womens-day .menu-button {
      color: #880e4f !important;
      text-shadow: 0 0 8px rgba(233, 30, 99, 0.3);
    }
    body.womens-day #game-container {
      background: radial-gradient(ellipse at center, #fce4ec 0%, #f8bbd0 100%) !important;
    }
  `;
  document.head.appendChild(styleElement);
}

function cleanup(): void {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  petals.forEach(p => p.remove());
  petals.length = 0;
  petalData.length = 0;

  // Restore theme
  if (originalThemeIndex !== null) {
    themeManager.setTheme(originalThemeIndex);
    originalThemeIndex = null;
  }

  // Remove body class and style element
  document.body.classList.remove('womens-day');
  styleElement?.remove();
  styleElement = null;
}

export default {
  name: "Women's Day",
  apply,
  cleanup
} as SpecialDayEffect;
