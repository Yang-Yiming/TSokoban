import type { SpecialDayEffect } from './index';
import { themeManager, THEMES } from '../theme';

let animationId: number | null = null;
const hearts: HTMLDivElement[] = [];
let originalThemeIndex: number | null = null;
let styleElement: HTMLStyleElement | null = null;

interface Heart {
  element: HTMLDivElement;
  x: number;
  y: number;
  speed: number;
  sway: number;
  swayOffset: number;
  scale: number;
  pulseOffset: number;
}

const heartData: Heart[] = [];

// Weighted emoji pool: 💗 25%, 💕 25%, 💖 20%, 💝 15%, 💞 15%
const EMOJI_POOL = ['💗','💗','💗','💗','💗','💕','💕','💕','💕','💕','💖','💖','💖','💖','💝','💝','💝','💞','💞','💞'];

function pickEmoji(): string {
  return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
}

function createHearts(app: HTMLElement): void {
  for (let i = 0; i < 10; i++) {
    const heart = document.createElement('div');
    const size = 18 + Math.random() * 22;
    heart.textContent = pickEmoji();
    heart.style.cssText = `
      position: fixed;
      font-size: ${size}px;
      opacity: ${0.5 + Math.random() * 0.5};
      pointer-events: none;
      z-index: 6;
      user-select: none;
    `;

    hearts.push(heart);
    app.appendChild(heart);

    heartData.push({
      element: heart,
      x: Math.random() * window.innerWidth,
      y: window.innerHeight + Math.random() * 200,
      speed: 0.2 + Math.random() * 0.3,
      sway: 20 + Math.random() * 30,
      swayOffset: Math.random() * Math.PI * 2,
      scale: 1,
      pulseOffset: Math.random() * Math.PI * 2
    });
  }
}

function animateHearts(): void {
  const time = Date.now() / 1000;

  for (const h of heartData) {
    h.y -= h.speed;
    const swayX = Math.sin(time * 0.8 + h.swayOffset) * h.sway;
    // Gentle pulse effect
    h.scale = 1 + Math.sin(time * 1.5 + h.pulseOffset) * 0.1;

    if (h.y < -50) {
      h.y = window.innerHeight + 50;
      h.x = Math.random() * window.innerWidth;
      h.element.textContent = pickEmoji();
    }

    h.element.style.left = `${h.x + swayX}px`;
    h.element.style.top = `${h.y}px`;
    h.element.style.transform = `scale(${h.scale})`;
  }

  animationId = requestAnimationFrame(animateHearts);
}

function apply(app: HTMLElement): void {
  // Store and switch theme to gyx 色 (index 5)
  originalThemeIndex = THEMES.findIndex(t => t.name === themeManager.currentTheme.name);
  themeManager.setTheme(5);

  // Create floating hearts (rising upward ~ love grows)
  createHearts(app);
  animateHearts();

  // Add body class and inject styles for warm romantic atmosphere
  document.body.classList.add('anniversary-day');
  styleElement = document.createElement('style');
  styleElement.textContent = `
    body.anniversary-day {
      background: linear-gradient(to bottom, #fff3e0, #ffe0b2) !important;
    }
    body.anniversary-day #app {
      background: linear-gradient(to bottom, #fff8e1, #ffe0b2, #fce4ec) !important;
    }
    body.anniversary-day .cloud {
      filter: brightness(1.08) saturate(1.15) hue-rotate(-5deg) !important;
    }
    body.anniversary-day button,
    body.anniversary-day .menu-button {
      color: #bf360c !important;
      text-shadow: 0 0 8px rgba(255, 138, 101, 0.4);
    }
    body.anniversary-day #game-container {
      background: radial-gradient(ellipse at center, #fff8e1 0%, #ffe0b2 100%) !important;
    }
  `;
  document.head.appendChild(styleElement);
}

function cleanup(): void {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  hearts.forEach(h => h.remove());
  hearts.length = 0;
  heartData.length = 0;

  // Restore theme
  if (originalThemeIndex !== null) {
    themeManager.setTheme(originalThemeIndex);
    originalThemeIndex = null;
  }

  // Remove body class and style element
  document.body.classList.remove('anniversary-day');
  styleElement?.remove();
  styleElement = null;
}

export default {
  name: 'Anniversary Day',
  apply,
  cleanup
} as SpecialDayEffect;
