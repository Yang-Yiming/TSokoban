export interface Progress {
    completedLevels: number[]; // indices of completed levels
    itemCounts: {
        hint: number;
        plus: number;
        undo: number;
    };
    chestOpened: boolean;
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
            chestOpened: false
        };
    }

    save() {
        localStorage.setItem('tsokoban_progress', JSON.stringify(this.progress));
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
