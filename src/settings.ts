type SettingsChangeListener = (settings: Settings) => void;

export type StructureDiscoveryPromptMode = 'always' | 'firstOnly';

interface Settings {
  moveAnimDuration: number;
  volume: number;
  useAStar: boolean;
  mapSeed: string;
  structureDiscoveryPromptMode: StructureDiscoveryPromptMode;
}

class SettingsManager {
  private settings: Settings = {
    moveAnimDuration: 150,
    volume: 50,
    useAStar: false,
    mapSeed: '53',
    structureDiscoveryPromptMode: 'always'
  };
  private listeners: SettingsChangeListener[] = [];

  get currentSettings(): Settings {
    return { ...this.settings };
  }

  updateSettings(updates: Partial<Settings>) {
    this.settings = { ...this.settings, ...updates };
    this.notifyListeners();
  }

  addListener(listener: SettingsChangeListener) {
    this.listeners.push(listener);
    listener(this.currentSettings);
  }

  removeListener(listener: SettingsChangeListener) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private notifyListeners() {
    this.listeners.forEach(l => l(this.currentSettings));
  }
}

export const settingsManager = new SettingsManager();
