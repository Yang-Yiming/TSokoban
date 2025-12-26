import { SokobanMap } from './SokobanMap';
import { GameScene } from './GameScene';
import { MAP_DATA } from './mapData';
import { AStarSolver } from './AStarSolver';

import { showThemeDialog } from '../ui/themeDialog';
import { showSettingsDialog } from '../ui/settingsDialog';
import { settingsManager } from '../settings';

export class GameController {
    private currentMap: SokobanMap | null = null;
    private scene: GameScene;
    private currentLevelIndex: number = 0;
    private stepCount: number = 0;
    private stepLimit: number = 0;
    private itemCounts = { hint: 3, plus: 3, undo: 3 };
    
    private playerOrientation: number = 2; // 1:up, 2:down, 3:left, 4:right
    private isGameOver: boolean = false;
    private moveAnimDuration: number = 150;
    private lastMoveTime: number = 0;
    private lastMoveDir: { x: number, y: number } = { x: 0, y: 0 };
    private lastPushedBox: { x: number, y: number } | null = null;
    private bgm: HTMLAudioElement | null = null;
    private isDestroyed: boolean = false;
    private eventListeners: { target: EventTarget, type: string, handler: any }[] = [];
    private currentOverlay: HTMLElement | null = null;

    private uiElements: {
        levelText: HTMLElement;
        stepText: HTMLElement;
        limitText: HTMLElement;
        itemHintText: HTMLElement;
        itemPlusText: HTMLElement;
        itemUndoText: HTMLElement;
    } | null = null;

    private onExit: () => void;
    private container: HTMLElement;
    private settingsListener: (settings: any) => void;

    constructor(container: HTMLElement, onExit: () => void) {
        this.container = container;
        this.scene = new GameScene(container);
        this.onExit = onExit;
        
        this.settingsListener = (settings) => {
            this.moveAnimDuration = settings.moveAnimDuration;
            if (this.bgm) {
                this.bgm.volume = settings.volume / 100;
            }
        };
        settingsManager.addListener(this.settingsListener);

        this.setupInput();
        this.createUI(container);
        this.startAnimationLoop();
        this.startBGM();
    }

    public destroy() {
        this.isDestroyed = true;
        if (this.bgm) {
            this.bgm.pause();
            this.bgm = null;
        }
        this.eventListeners.forEach(({ target, type, handler }) => {
            target.removeEventListener(type, handler);
        });
        this.eventListeners = [];
        settingsManager.removeListener(this.settingsListener);
        this.scene.destroy();
    }

    private addManagedEventListener(target: EventTarget, type: string, handler: any) {
        target.addEventListener(type, handler);
        this.eventListeners.push({ target, type, handler });
    }

    private startBGM() {
        if (this.bgm) this.bgm.pause();
        this.bgm = new Audio('/assets/music/classic.m4a');
        this.bgm.loop = true;
        this.bgm.volume = settingsManager.currentSettings.volume / 100;
        this.bgm.play().catch(() => {
            console.log('BGM play failed: User interaction required');
            // Try to play on first click
            const playOnce = () => {
                this.bgm?.play();
                window.removeEventListener('click', playOnce);
            };
            window.addEventListener('click', playOnce);
        });
    }

    private startAnimationLoop() {
        const loop = () => {
            if (this.isDestroyed) return;
            if (this.currentMap) {
                const now = performance.now();
                const progress = Math.min(1, (now - this.lastMoveTime) / this.moveAnimDuration);
                
                this.scene.render(this.currentMap, {
                    orientation: this.playerOrientation,
                    isMoving: progress < 1,
                    progress: progress,
                    moveDir: this.lastMoveDir,
                    pushedBox: this.lastPushedBox
                });
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    public setMoveAnimDuration(duration: number) {
        this.moveAnimDuration = duration;
    }

    private createUI(container: HTMLElement) {
        const uiOverlay = document.createElement('div');
        uiOverlay.className = 'game-ui-overlay';
        container.appendChild(uiOverlay);

        // Top Left: Stats
        const stats = document.createElement('div');
        stats.className = 'ui-stats';
        const levelText = document.createElement('div');
        const stepText = document.createElement('div');
        const limitText = document.createElement('div');
        stats.appendChild(levelText);
        stats.appendChild(stepText);
        stats.appendChild(limitText);
        uiOverlay.appendChild(stats);

        // Top Right: Icons
        const topIcons = document.createElement('div');
        topIcons.className = 'ui-top-icons';
        ['theme', 'home', 'settings'].forEach(name => {
            const img = document.createElement('img');
            img.src = `/assets/images/${name}.png`;
            img.onmouseenter = () => img.src = `/assets/images/${name}_clicked.png`;
            img.onmouseleave = () => img.src = `/assets/images/${name}.png`;
            img.onclick = () => {
                if (name === 'home') {
                    if (this.bgm) this.bgm.pause();
                    this.onExit();
                }
                else if (name === 'theme') showThemeDialog(this.container);
                else if (name === 'settings') this.showSettings();
            };
            topIcons.appendChild(img);
        });
        uiOverlay.appendChild(topIcons);

        // Bottom Left: Items
        const itemBar = document.createElement('div');
        itemBar.className = 'ui-item-bar';
        const items = [
            { id: 'hint', img: 'hint.png', count: this.itemCounts.hint, action: () => this.useHint() },
            { id: 'plus', img: 'plus.png', count: this.itemCounts.plus, action: () => this.usePlus() },
            { id: 'undo', img: 'withdraw.png', count: this.itemCounts.undo, action: () => this.useUndo() }
        ];

        const itemTexts: any = {};
        items.forEach(item => {
            const group = document.createElement('div');
            group.className = 'item-group';
            const img = document.createElement('img');
            img.src = `/assets/images/${item.img}`;
            img.className = 'draggable-item';
            
            // Drag to use logic
            let isDragging = false;
            let startX = 0, startY = 0;
            
            img.addEventListener('mousedown', (e) => {
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                img.style.zIndex = '1000';
                img.style.cursor = 'grabbing';
            });

            const moveHandler = (e: MouseEvent) => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                img.style.transform = `translate(${dx}px, ${dy}px)`;
            };

            const upHandler = (e: MouseEvent) => {
                if (!isDragging) return;
                isDragging = false;
                img.style.zIndex = '';
                img.style.cursor = 'grab';
                img.style.transform = 'none';

                // If dragged upwards significantly, use the item
                if (startY - e.clientY > 50) {
                    item.action();
                }
            };

            this.addManagedEventListener(window, 'mousemove', moveHandler);
            this.addManagedEventListener(window, 'mouseup', upHandler);

            const text = document.createElement('div');
            text.innerText = `x${item.count}`;
            group.appendChild(img);
            group.appendChild(text);
            itemBar.appendChild(group);
            itemTexts[item.id] = text;
        });
        uiOverlay.appendChild(itemBar);

        // Bottom Right: Directions
        const directions = document.createElement('div');
        directions.className = 'ui-directions';
        const dirKeys = ['up', 'left', 'down', 'right'];
        dirKeys.forEach(dir => {
            const img = document.createElement('img');
            img.src = `/assets/images/direction/${dir}.png`;
            img.className = `dir-${dir}`;
            directions.appendChild(img);
        });
        const shortcutHint = document.createElement('div');
        shortcutHint.className = 'shortcut-hint';
        shortcutHint.innerText = 'R: 重置 ESC: 退出';
        directions.appendChild(shortcutHint);
        uiOverlay.appendChild(directions);

        this.uiElements = {
            levelText, stepText, limitText,
            itemHintText: itemTexts.hint,
            itemPlusText: itemTexts.plus,
            itemUndoText: itemTexts.undo
        };
    }

    private updateUI() {
        if (!this.uiElements) return;
        this.uiElements.levelText.innerText = `关卡 ${this.currentLevelIndex + 1}`;
        this.uiElements.stepText.innerText = `移动步数: ${this.stepCount}`;
        this.uiElements.limitText.innerText = `步数限制: ${this.stepLimit}`;
        this.uiElements.itemHintText.innerText = `x${this.itemCounts.hint}`;
        this.uiElements.itemPlusText.innerText = `x${this.itemCounts.plus}`;
        this.uiElements.itemUndoText.innerText = `x${this.itemCounts.undo}`;
    }

    private useHint() {
        const now = performance.now();
        if (this.itemCounts.hint <= 0 || !this.currentMap || this.isGameOver || (now - this.lastMoveTime < this.moveAnimDuration)) return;
        
        const solver = new AStarSolver(this.currentMap);
        const solution = solver.solve(5000);
        
        if (solution && solution.length > 0) {
            const nextMove = solution[0];
            let dx = 0, dy = 0;
            let orientation = 2;

            switch (nextMove) {
                case 'w': dx = 0; dy = -1; orientation = 1; break;
                case 's': dx = 0; dy = 1; orientation = 2; break;
                case 'a': dx = -1; dy = 0; orientation = 3; break;
                case 'd': dx = 1; dy = 0; orientation = 4; break;
            }

            const moveResult = this.currentMap.movePlayer(dx, dy);
            if (moveResult.moved) {
                this.playerOrientation = orientation;
                this.lastMoveTime = performance.now();
                this.lastMoveDir = { x: dx, y: dy };
                this.lastPushedBox = moveResult.pushedBox || null;
                
                const playerPos = this.currentMap.getPlayerPosition();
                if (playerPos) {
                    this.scene.triggerCameraFollow(playerPos.x, playerPos.y);
                }

                this.stepCount++;
                this.itemCounts.hint--;
                this.updateUI();

                if (this.currentMap.isWin()) {
                    this.isGameOver = true;
                    this.showWinAnimation(() => this.nextLevel());
                }
            }
        } else {
            alert('此局无解，建议重置或撤销！');
        }
    }

    private usePlus() {
        if (this.itemCounts.plus <= 0 || !this.currentMap) return;
        this.stepLimit += 5;
        this.itemCounts.plus--;
        
        if (this.isGameOver && this.stepCount < this.stepLimit && !this.currentMap.isDeadlock()) {
            this.isGameOver = false;
            if (this.currentOverlay) {
                this.currentOverlay.remove();
                this.currentOverlay = null;
            }
        }
        
        this.updateUI();
    }

    private useUndo() {
        if (this.itemCounts.undo <= 0 || !this.currentMap) return;
        if (this.currentMap.undo()) {
            this.isGameOver = false;
            if (this.currentOverlay) {
                this.currentOverlay.remove();
                this.currentOverlay = null;
            }
            this.stepCount--;
            this.itemCounts.undo--;
            this.lastMoveTime = 0; // Reset animation to snap to previous position
            this.updateUI();
        }
    }

    loadLevel(index: number) {
        if (index < 0 || index >= MAP_DATA.length) return;
        
        if (this.currentOverlay) {
            this.currentOverlay.remove();
            this.currentOverlay = null;
        }

        // Add fade-in effect (Matching Level.java)
        const fadeOverlay = document.createElement('div');
        fadeOverlay.className = 'fade-in-overlay';
        this.scene.getCanvas().parentElement?.appendChild(fadeOverlay);
        
        // Trigger fade out of the black screen
        setTimeout(() => {
            fadeOverlay.classList.add('hide');
            setTimeout(() => fadeOverlay.remove(), 1000);
        }, 50);

        this.currentLevelIndex = index;
        this.currentMap = new SokobanMap(MAP_DATA[index]);
        this.stepCount = 0;
        this.isGameOver = false;
        
        // Calculate step limit using A*
        const solver = new AStarSolver(this.currentMap);
        const solution = solver.solve(10000);
        this.stepLimit = (solution ? solution.length : 20) + 15;

        this.scene.setInitialAnchor(this.currentMap);
        this.updateUI();
    }

    private setupInput() {
        const keyHandler = (e: KeyboardEvent) => {
            if (!this.currentMap || this.isDestroyed || this.isGameOver) return;

            // Prevent moving while animation is playing
            const now = performance.now();
            if (now - this.lastMoveTime < this.moveAnimDuration) return;

            let moveResult: { moved: boolean, pushedBox?: { x: number, y: number } } = { moved: false };
            let newOrientation = this.playerOrientation;
            let dx = 0, dy = 0;

            switch (e.key) {
                case 'ArrowUp':
                case 'w':
                    newOrientation = 1;
                    dx = 0; dy = -1;
                    moveResult = this.currentMap.movePlayer(dx, dy);
                    break;
                case 'ArrowDown':
                case 's':
                    newOrientation = 2;
                    dx = 0; dy = 1;
                    moveResult = this.currentMap.movePlayer(dx, dy);
                    break;
                case 'ArrowLeft':
                case 'a':
                    newOrientation = 3;
                    dx = -1; dy = 0;
                    moveResult = this.currentMap.movePlayer(dx, dy);
                    break;
                case 'ArrowRight':
                case 'd':
                    newOrientation = 4;
                    dx = 1; dy = 0;
                    moveResult = this.currentMap.movePlayer(dx, dy);
                    break;
                case 'r':
                    this.loadLevel(this.currentLevelIndex);
                    return;
                case 'Escape':
                    this.destroy();
                    this.onExit();
                    return;
            }

            this.playerOrientation = newOrientation;

            if (moveResult.moved) {
                const playerPos = this.currentMap.getPlayerPosition();
                if (playerPos) {
                    this.scene.triggerCameraFollow(playerPos.x, playerPos.y);
                }

                this.lastMoveTime = performance.now();
                this.lastMoveDir = { x: dx, y: dy };
                this.lastPushedBox = moveResult.pushedBox || null;

                this.stepCount++;
                this.updateUI();
                
                if (this.currentMap.isWin()) {
                    this.isGameOver = true;
                    this.showWinAnimation(() => this.nextLevel());
                } else if (this.stepCount >= this.stepLimit) {
                    this.isGameOver = true;
                    this.showLoseAnimation('晕', '好累……', () => this.loadLevel(this.currentLevelIndex));
                } else if (this.isDeadlockDetected()) {
                    this.isGameOver = true;
                    this.showLoseAnimation('菜', '有的猫活着……', () => this.loadLevel(this.currentLevelIndex));
                }
            }
        };
        this.addManagedEventListener(window, 'keydown', keyHandler);
    }

    private isDeadlockDetected(): boolean {
        if (!this.currentMap) return false;
        
        // Basic deadlock check (corners)
        if (this.currentMap.isDeadlock()) return true;

        // Advanced A* deadlock check
        if (settingsManager.currentSettings.useAStar) {
            const solver = new AStarSolver(this.currentMap);
            // Use a smaller node limit for real-time check to avoid lag
            const solution = solver.solve(2000); 
            if (solution === null) {
                // If A* can't find a solution within 2000 nodes, 
                // it's either unsolvable or too complex.
                // For "smarter" judgment, we treat it as unsolvable.
                return true;
            }
        }

        return false;
    }

    nextLevel() {
        this.loadLevel((this.currentLevelIndex + 1) % MAP_DATA.length);
    }

    private showWinAnimation(callback: () => void) {
        if (this.isDestroyed) return;
        const overlay = document.createElement('div');
        this.currentOverlay = overlay;
        overlay.className = 'win-overlay';
        overlay.innerHTML = `
            <div class="win-content">
                <div class="win-line"></div>
                <div class="win-text">完成</div>
                <div class="win-line"></div>
            </div>
        `;
        this.scene.getCanvas().parentElement?.appendChild(overlay);

        // Sequence: In -> Pause -> Out (Matching Win.java)
        setTimeout(() => {
            if (this.isDestroyed || this.currentOverlay !== overlay) {
                overlay.remove();
                return;
            }
            overlay.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            if (this.isDestroyed || this.currentOverlay !== overlay) {
                overlay.remove();
                return;
            }
            overlay.classList.add('exit');
            setTimeout(() => {
                if (this.currentOverlay === overlay) {
                    overlay.remove();
                    this.currentOverlay = null;
                }
                if (!this.isDestroyed) callback();
            }, 150);
        }, 500);
    }

    private showLoseAnimation(text: string, subtext: string, callback: () => void) {
        if (this.isDestroyed) return;
        const overlay = document.createElement('div');
        this.currentOverlay = overlay;
        overlay.className = 'lose-overlay';
        overlay.innerHTML = `
            <div class="lose-content">
                <div class="lose-text">${text}</div>
                <div class="lose-subtext">${subtext}</div>
            </div>
        `;
        this.scene.getCanvas().parentElement?.appendChild(overlay);

        // Fade in background (400ms)
        setTimeout(() => {
            if (this.isDestroyed || this.currentOverlay !== overlay) {
                overlay.remove();
                return;
            }
            overlay.classList.add('show');
            
            // Fade in text (800ms) after background starts
            setTimeout(() => {
                if (this.isDestroyed || this.currentOverlay !== overlay) return;
                overlay.classList.add('show-text');
                
                // Auto restart after text fade in finishes
                setTimeout(() => {
                    if (this.currentOverlay === overlay) {
                        overlay.remove();
                        this.currentOverlay = null;
                    }
                    if (!this.isDestroyed) callback();
                }, 1200); // Wait for text fade (800ms) + a small pause
            }, 400);
        }, 10);
    }

    private showSettings() {
        showSettingsDialog(this.container);
    }
}
