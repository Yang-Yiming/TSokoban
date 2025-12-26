export interface ThemeInfo {
  name: string;
  color: { r: number; g: number; b: number };
  cssColor: string;
}

export const THEMES: ThemeInfo[] = [
  { name: '苔藓绿', color: { r: 124, g: 153, b: 32 }, cssColor: 'rgb(124, 153, 32)' },
  { name: '春梅红', color: { r: 241, g: 147, b: 156 }, cssColor: 'rgb(241, 147, 156)' },
  { name: '远山紫', color: { r: 204, g: 204, b: 214 }, cssColor: 'rgb(204, 204, 214)' },
  { name: '深灰蓝', color: { r: 68, g: 78, b: 94 }, cssColor: 'rgb(68, 78, 94)' },
  { name: 'yym 色', color: { r: 124, g: 113, b: 32 }, cssColor: 'rgb(124, 113, 32)' },
  { name: 'gyx 色', color: { r: 124, g: 111, b: 52 }, cssColor: 'rgb(124, 111, 52)' }
];

type ThemeChangeListener = (theme: ThemeInfo) => void;

class ThemeManager {
  private currentThemeIndex = 0;
  private listeners: ThemeChangeListener[] = [];

  get currentTheme(): ThemeInfo {
    return THEMES[this.currentThemeIndex];
  }

  setTheme(index: number) {
    if (index >= 0 && index < THEMES.length) {
      this.currentThemeIndex = index;
      this.notifyListeners();
    }
  }

  nextTheme() {
    this.currentThemeIndex = (this.currentThemeIndex + 1) % THEMES.length;
    this.notifyListeners();
  }

  addListener(listener: ThemeChangeListener) {
    this.listeners.push(listener);
    listener(this.currentTheme);
  }

  removeListener(listener: ThemeChangeListener) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private notifyListeners() {
    const theme = this.currentTheme;
    this.listeners.forEach(l => l(theme));
  }
}

export const themeManager = new ThemeManager();
