import type { Equipment } from './game/types';
import type { WorldDelta } from './net/protocol';

/**
 * Terraria-style save split (v2 — old `tsokoban_progress` key is abandoned):
 *  - Character saves travel with the person:  tsokoban_characters  → CharacterSave[]
 *  - A world IS a seed:                       tsokoban_world:<seed> → WorldSave
 *  - Last selections (menu preselect):        tsokoban_last
 */

type OwnableEquipment = Exclude<Equipment, 'none'>;

export interface CharacterSave {
  id: string;
  name: string;
  fishCount: number;
  itemCounts: { hint: number; plus: number; undo: number };
  equipment: Equipment;
  equipmentOwned: OwnableEquipment[];
  discoveredStructures: string[];
  createdAt: number;
}

export interface WorldSave {
  completedLevels: number[];
  chestOpened: boolean;
  completedGeneratedLevels: string[];
  lastPlayedAt: number;
}

export interface WorldFlagsSnapshot {
  completedLevels: number[];
  chestOpened: boolean;
  completedGeneratedLevels: string[];
}

interface LastUsed {
  characterId: string;
  seed: string;
}

const CHARACTERS_KEY = 'tsokoban_characters';
const WORLD_KEY_PREFIX = 'tsokoban_world:';
const LAST_KEY = 'tsokoban_last';

// localStorage is origin-scoped (the LAN server's IP is part of the origin),
// so character codes are the way to carry a character across hosts.
function b64encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function b64decode(s: string): string {
  return decodeURIComponent(escape(atob(s)));
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function emptyWorld(): WorldSave {
  return { completedLevels: [], chestOpened: false, completedGeneratedLevels: [], lastPlayedAt: 0 };
}

function sanitizeCharacter(raw: Partial<CharacterSave>): CharacterSave {
  const equipment: Equipment = raw.equipment ?? 'none';
  // Equipment used to be free to toggle; anything an old save has equipped is
  // treated as owned so the ownership split doesn't take items away.
  const legacyOwned: OwnableEquipment[] =
    !Array.isArray(raw.equipmentOwned) && equipment !== 'none' ? [equipment] : [];
  return {
    // Keep the original id when present so full-backup imports can dedupe.
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: typeof raw.name === 'string' && raw.name ? raw.name : '喵',
    fishCount: typeof raw.fishCount === 'number' ? raw.fishCount : 0,
    itemCounts: {
      hint: raw.itemCounts?.hint ?? 3,
      plus: raw.itemCounts?.plus ?? 3,
      undo: raw.itemCounts?.undo ?? 3,
    },
    equipment,
    equipmentOwned: Array.isArray(raw.equipmentOwned)
      ? [...new Set(raw.equipmentOwned.filter((e) => e === 'boat' || e === 'wing'))]
      : legacyOwned,
    discoveredStructures: Array.isArray(raw.discoveredStructures) ? raw.discoveredStructures : [],
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------- characters

class CharacterManager {
  private characters: CharacterSave[];
  private activeId: string | null = null;

  constructor() {
    this.characters = loadJson<CharacterSave[]>(CHARACTERS_KEY, []);
  }

  private persist(): void {
    saveJson(CHARACTERS_KEY, this.characters);
  }

  list(): CharacterSave[] {
    return this.characters;
  }

  get(id: string): CharacterSave | null {
    return this.characters.find((c) => c.id === id) ?? null;
  }

  get active(): CharacterSave | null {
    return this.activeId ? this.get(this.activeId) : null;
  }

  setActive(id: string): void {
    this.activeId = id;
    const last = this.getLastUsed();
    saveJson(LAST_KEY, { ...last, characterId: id });
  }

  create(name: string): CharacterSave {
    const c = sanitizeCharacter({ name });
    this.characters.push(c);
    this.persist();
    return c;
  }

  remove(id: string): void {
    this.characters = this.characters.filter((c) => c.id !== id);
    if (this.activeId === id) this.activeId = null;
    this.persist();
  }

  /** All mutations below operate on the ACTIVE character (chosen at menu time). */

  private mutate(fn: (c: CharacterSave) => void): void {
    const c = this.active;
    if (!c) return;
    fn(c);
    this.persist();
  }

  getName(): string {
    return this.active?.name ?? '喵';
  }

  getFishCount(): number {
    return this.active?.fishCount ?? 0;
  }

  addFish(n: number): void {
    this.mutate((c) => { c.fishCount += n; });
  }

  getItemCounts(): { hint: number; plus: number; undo: number } {
    const c = this.active;
    return c ? { ...c.itemCounts } : { hint: 0, plus: 0, undo: 0 };
  }

  useItem(type: 'hint' | 'plus' | 'undo'): boolean {
    const c = this.active;
    if (!c || c.itemCounts[type] <= 0) return false;
    c.itemCounts[type]--;
    this.persist();
    return true;
  }

  getEquipment(): Equipment {
    const c = this.active;
    if (!c) return 'none';
    // Equipped gear must be owned; anything else reads as barefoot.
    return c.equipment !== 'none' && !c.equipmentOwned.includes(c.equipment)
      ? 'none'
      : c.equipment;
  }

  setEquipment(e: Equipment): void {
    this.mutate((c) => {
      if (e !== 'none' && !c.equipmentOwned.includes(e)) return;
      c.equipment = e;
    });
  }

  getOwnedEquipment(): OwnableEquipment[] {
    return this.active ? [...this.active.equipmentOwned] : [];
  }

  ownsEquipment(e: Equipment): boolean {
    return e !== 'none' && (this.active?.equipmentOwned.includes(e) ?? false);
  }

  /** Grants an equipment once per character; returns true only on first grant. */
  grantEquipment(e: OwnableEquipment): boolean {
    let granted = false;
    this.mutate((c) => {
      if (!c.equipmentOwned.includes(e)) {
        c.equipmentOwned.push(e);
        granted = true;
      }
    });
    return granted;
  }

  hasDiscoveredStructure(id: string): boolean {
    return this.active?.discoveredStructures.includes(id) ?? false;
  }

  discoverStructure(id: string): boolean {
    const c = this.active;
    if (!c || c.discoveredStructures.includes(id)) return false;
    c.discoveredStructures.push(id);
    this.persist();
    return true;
  }

  /** Character code — carry a character to another origin/host. */
  exportCharacter(id: string): string | null {
    const c = this.get(id);
    return c ? b64encode(JSON.stringify(c)) : null;
  }

  importCharacter(code: string): boolean {
    try {
      const raw = JSON.parse(b64decode(code.trim()));
      if (!raw || typeof raw !== 'object') return false;
      this.characters.push(sanitizeCharacter(raw));
      this.persist();
      return true;
    } catch {
      return false;
    }
  }

  getLastUsed(): LastUsed {
    return loadJson<LastUsed>(LAST_KEY, { characterId: '', seed: '' });
  }
}

export const characterManager = new CharacterManager();

// -------------------------------------------------------------------- worlds

class WorldManager {
  private cache = new Map<string, WorldSave>();
  private activeSeed = '0';
  /** Guest mode: reads come from the host's world snapshot, writes are no-ops. */
  private mirror: WorldSave | null = null;

  getSeed(): string {
    return this.activeSeed;
  }

  /** Entering a world (solo/host). Loads or creates that seed's save. */
  setActiveSeed(seed: string): void {
    this.activeSeed = seed || '0';
    const w = this.loadWorld(this.activeSeed);
    w.lastPlayedAt = Date.now();
    this.persistWorld(this.activeSeed);
    const last = characterManager.getLastUsed();
    saveJson(LAST_KEY, { ...last, seed: this.activeSeed });
  }

  /** Guest mode: render the HOST's world truth, never persist it locally. */
  setMirror(flags: WorldFlagsSnapshot | null): void {
    this.mirror = flags
      ? {
          completedLevels: [...flags.completedLevels],
          chestOpened: flags.chestOpened,
          completedGeneratedLevels: [...flags.completedGeneratedLevels],
          lastPlayedAt: 0,
        }
      : null;
  }

  applyDelta(delta: WorldDelta): void {
    if (!this.mirror) return;
    switch (delta.t) {
      case 'levelCompleted':
        if (delta.index !== undefined && !this.mirror.completedLevels.includes(delta.index)) {
          this.mirror.completedLevels.push(delta.index);
        }
        break;
      case 'chestOpened':
        this.mirror.chestOpened = true;
        break;
      case 'generatedCompleted': {
        const k = `${delta.x},${delta.y}`;
        if (!this.mirror.completedGeneratedLevels.includes(k)) {
          this.mirror.completedGeneratedLevels.push(k);
        }
        break;
      }
    }
  }

  private loadWorld(seed: string): WorldSave {
    let w = this.cache.get(seed);
    if (!w) {
      w = loadJson<WorldSave>(WORLD_KEY_PREFIX + seed, emptyWorld());
      this.cache.set(seed, w);
    }
    return w;
  }

  private persistWorld(seed: string): void {
    saveJson(WORLD_KEY_PREFIX + seed, this.loadWorld(seed));
  }

  private view(): WorldSave {
    return this.mirror ?? this.loadWorld(this.activeSeed);
  }

  // ---- reads (mirror-aware) ----

  isLevelCompleted(index: number): boolean {
    return this.view().completedLevels.includes(index);
  }

  allLevelsCompleted(upTo: number): boolean {
    for (let i = 0; i <= upTo; i++) {
      if (!this.isLevelCompleted(i)) return false;
    }
    return true;
  }

  isChestOpened(): boolean {
    return this.view().chestOpened;
  }

  isGeneratedLevelCompleted(x: number, y: number): boolean {
    return this.view().completedGeneratedLevels.includes(`${x},${y}`);
  }

  // ---- writes (no-op in guest mode; host's worldUpdate deltas update the mirror) ----

  completeLevel(index: number): boolean {
    if (this.mirror) return false;
    const w = this.loadWorld(this.activeSeed);
    if (w.completedLevels.includes(index)) return false;
    w.completedLevels.push(index);
    w.lastPlayedAt = Date.now();
    this.persistWorld(this.activeSeed);
    return true;
  }

  openChest(): void {
    if (this.mirror) return;
    const w = this.loadWorld(this.activeSeed);
    w.chestOpened = true;
    w.lastPlayedAt = Date.now();
    this.persistWorld(this.activeSeed);
  }

  completeGeneratedLevel(x: number, y: number): boolean {
    if (this.mirror) return false;
    const w = this.loadWorld(this.activeSeed);
    const k = `${x},${y}`;
    if (w.completedGeneratedLevels.includes(k)) return false;
    w.completedGeneratedLevels.push(k);
    w.lastPlayedAt = Date.now();
    this.persistWorld(this.activeSeed);
    return true;
  }

  // ---- host: snapshot for joining guests ----

  exportFlags(): WorldFlagsSnapshot {
    const w = this.loadWorld(this.activeSeed);
    return {
      completedLevels: [...w.completedLevels],
      chestOpened: w.chestOpened,
      completedGeneratedLevels: [...w.completedGeneratedLevels],
    };
  }

  listWorlds(): { seed: string; save: WorldSave }[] {
    const out: { seed: string; save: WorldSave }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(WORLD_KEY_PREFIX)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key)!);
        if (parsed && Array.isArray(parsed.completedLevels)) {
          out.push({ seed: key.slice(WORLD_KEY_PREFIX.length), save: parsed as WorldSave });
        }
      } catch { /* skip corrupt entries */ }
    }
    out.sort((a, b) => b.save.lastPlayedAt - a.save.lastPlayedAt);
    return out;
  }
}

export const worldManager = new WorldManager();

// ------------------------------------------------------------- full backup

export function exportAllSaves(): string {
  const worlds: Record<string, WorldSave> = {};
  for (const { seed, save } of worldManager.listWorlds()) {
    worlds[seed] = save;
  }
  return b64encode(JSON.stringify({
    characters: characterManager.list(),
    worlds,
  }));
}

export function importAllSaves(code: string): boolean {
  try {
    const raw = JSON.parse(b64decode(code.trim()));
    if (!raw || !Array.isArray(raw.characters)) return false;
    const existing = new Set(characterManager.list().map((c) => c.id));
    for (const c of raw.characters) {
      if (!existing.has(c.id)) {
        characterManager.importCharacter(b64encode(JSON.stringify(c)));
      }
    }
    if (raw.worlds && typeof raw.worlds === 'object') {
      for (const [seed, w] of Object.entries(raw.worlds as Record<string, WorldSave>)) {
        if (w && Array.isArray(w.completedLevels)) {
          saveJson(WORLD_KEY_PREFIX + seed, w);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function clearAllSaves(): void {
  const removeKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key === CHARACTERS_KEY || key === LAST_KEY || key.startsWith(WORLD_KEY_PREFIX))) {
      removeKeys.push(key);
    }
  }
  removeKeys.forEach((k) => localStorage.removeItem(k));
}
