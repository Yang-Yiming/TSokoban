import type { Equipment } from './game/types';

export interface Progress {
    completedLevels: number[]; // indices of completed levels
    itemCounts: {
        hint: number;
        plus: number;
        undo: number;
    };
    chestOpened: boolean;
    equipment: Equipment;
    discoveredStructures: string[];
    fishCount: number;
    completedGeneratedLevels: string[]; // "worldX,worldY" keys
}

class ProgressManager {
    private progress: Progress;

    constructor() {
        const saved = localStorage.getItem('tsokoban_progress');
        if (saved) {
            try {
                this.progress = JSON.parse(saved);
                // Ensure all fields exist
                if (!this.progress.completedLevels) this.progress.completedLevels = [];
                if (!this.progress.itemCounts) this.progress.itemCounts = { hint: 3, plus: 3, undo: 3 };
                if (this.progress.chestOpened === undefined) this.progress.chestOpened = false;
                if (!this.progress.equipment) this.progress.equipment = 'none';
                if (!this.progress.discoveredStructures) this.progress.discoveredStructures = [];
                if (this.progress.fishCount === undefined) this.progress.fishCount = 0;
                if (!this.progress.completedGeneratedLevels) this.progress.completedGeneratedLevels = [];
            } catch (e) {
                this.progress = this.getDefaultProgress();
            }
        } else {
            this.progress = this.getDefaultProgress();
        }
    }

    private getDefaultProgress(): Progress {
        return {
            completedLevels: [],
            itemCounts: { hint: 3, plus: 3, undo: 3 },
            chestOpened: false,
            equipment: 'none',
            discoveredStructures: [],
            fishCount: 0,
            completedGeneratedLevels: []
        };
    }

    save() {
        localStorage.setItem('tsokoban_progress', JSON.stringify(this.progress));
    }

    getEquipment(): Equipment {
        return this.progress.equipment || 'none';
    }

    setEquipment(equipment: Equipment) {
        this.progress.equipment = equipment;
        this.save();
    }

    isLevelCompleted(index: number): boolean {
        return this.progress.completedLevels.includes(index);
    }

    allLevelsCompleted(upToIndex: number): boolean {
        for (let i = 0; i <= upToIndex; i++) {
            if (!this.isLevelCompleted(i)) return false;
        }
        return true;
    }

    completeLevel(index: number) {
        if (!this.isLevelCompleted(index)) {
            this.progress.completedLevels.push(index);
            // Reward for levels 1-15 (indices 0-14)
            if (index < 15) {
                this.progress.itemCounts.hint += 2;
                this.progress.itemCounts.plus += 2;
                this.progress.itemCounts.undo += 2;
            }
            this.save();
            return true; // First time completion
        }
        return false;
    }

    getItemCounts() {
        return { ...this.progress.itemCounts };
    }

    setItemCounts(counts: { hint: number, plus: number, undo: number }) {
        this.progress.itemCounts = { ...counts };
        this.save();
    }

    useItem(type: 'hint' | 'plus' | 'undo') {
        if (this.progress.itemCounts[type] > 0) {
            this.progress.itemCounts[type]--;
            this.save();
            return true;
        }
        return false;
    }

    isChestOpened(): boolean {
        return this.progress.chestOpened;
    }

    openChest() {
        this.progress.chestOpened = true;
        this.save();
    }

    hasDiscoveredStructure(structureId: string): boolean {
        return this.progress.discoveredStructures.includes(structureId);
    }

    discoverStructure(structureId: string): boolean {
        if (this.hasDiscoveredStructure(structureId)) return false;
        this.progress.discoveredStructures.push(structureId);
        this.save();
        return true;
    }

    getFishCount(): number {
        return this.progress.fishCount;
    }

    addFish(amount: number) {
        this.progress.fishCount += amount;
        this.save();
    }

    isGeneratedLevelCompleted(worldX: number, worldY: number): boolean {
        return this.progress.completedGeneratedLevels.includes(`${worldX},${worldY}`);
    }

    completeGeneratedLevel(worldX: number, worldY: number) {
        const key = `${worldX},${worldY}`;
        if (!this.progress.completedGeneratedLevels.includes(key)) {
            this.progress.completedGeneratedLevels.push(key);
            this.save();
        }
    }

    exportSave(): string {
        return btoa(JSON.stringify(this.progress));
    }

    importSave(data: string): boolean {
        try {
            const parsed = JSON.parse(atob(data));
            if (parsed && typeof parsed === 'object') {
                this.progress = { ...this.getDefaultProgress(), ...parsed };
                this.save();
                return true;
            }
        } catch (e) {
            console.error('Failed to import save:', e);
        }
        return false;
    }

    clearSave() {
        this.progress = this.getDefaultProgress();
        this.save();
    }
}

export const progressManager = new ProgressManager();
