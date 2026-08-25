import { SokobanMap } from './SokobanMap';
import { GameScene } from './GameScene';
import type { CatRenderState } from './GameScene';
import { MAP_DATA, SPECIAL_LEVEL_LIBRARY } from './mapData';
import { AStarSolver } from './AStarSolver';
import type { GeneratedLevelMeta } from './puzzleGenerator';
import { TILE_MASK } from './types';

import type { MultiplayerSession } from '../net/MultiplayerSession';
import type { LevelRef, Spawn } from '../net/protocol';
import { PEER_TINT } from '../net/protocol';

import { showThemeDialog } from '../ui/themeDialog';
import { showSettingsDialog } from '../ui/settingsDialog';
import { settingsManager } from '../settings';
import { progressManager } from '../progress';

export interface MpContext {
    session: MultiplayerSession;
    ref: LevelRef;
    /** spawns[0] = host, spawns[1] = guest. Null for solo entries (peer not in this level). */
    spawns: [Spawn, Spawn] | null;
    returnPos: { x: number; y: number };
}

export class GameController {
    private currentMap: SokobanMap | null = null;
    private scene: GameScene;
    private currentLevelIndex: number = 0;
    private isGeneratedLevel: boolean = false;
    private isSpecialLevel: boolean = false;
    private currentSpecialLevelId: string | null = null;
    private generatedLevelData: number[][] | null = null;
    private generatedLevelMeta: GeneratedLevelMeta | null = null;
    private optimalSteps: number = 0;
    private stepCount: number = 0;
    private stepLimit: number = 0;
    
    private playerOrientation: number = 2; // 1:up, 2:down, 3:left, 4:right
    private isGameOver: boolean = false;
    private moveAnimDuration: number = 150;
    private lastMoveTime: number = 0;
    private lastMoveDir: { x: number, y: number } = { x: 0, y: 0 };
    private lastPushedBox: { x: number, y: number } | null = null;
    private moveQueue: { dx: number, dy: number, orientation: number }[] = [];
    private bgm: HTMLAudioElement | null = null;
    private bgmPlayOnceHandler: (() => void) | null = null;
    private isDestroyed: boolean = false;
    private eventListeners: { target: EventTarget, type: string, handler: any }[] = [];
    private currentOverlay: HTMLElement | null = null;

    // Multiplayer state
    private mp: MpContext | null = null;
    private peerPos: { x: number, y: number } | null = null;
    private peerOrientation: number = 2;
    private peerAnim: { dx: number, dy: number, start: number } | null = null;
    private peerLastPushed: { x: number, y: number } | null = null;
    private winDeclared: boolean = false;

    private uiElements: {
        levelText: HTMLElement;
        stepText: HTMLElement;
        limitText: HTMLElement;
        itemHintText?: HTMLElement;
        itemPlusText?: HTMLElement;
        itemUndoText?: HTMLElement;
    } | null = null;

    private onExit: (lastLevelIndex?: number) => void;
    private container: HTMLElement;
    private settingsListener: (settings: any) => void;

    constructor(container: HTMLElement, onExit: (lastLevelIndex?: number) => void, mp?: MpContext) {
        this.container = container;
        this.scene = new GameScene(container);
        this.onExit = onExit;
        this.mp = mp ?? null;

        if (this.mp) {
            const { session } = this.mp;
            session.onPeerMove = (dx, dy) => this.applyPeerMove(dx, dy);
            session.onPeerWin = () => this.handlePeerWin();
            session.onPeerRestart = () => this.doRestart(false);
            session.onPeerExitLevel = () => {
                // Peer left the level while I'm still in it — remove their cat.
                this.peerPos = null;
                this.peerAnim = null;
                this.peerLastPushed = null;
                this.scene.setPeerVisible(false);
            };
            // Guest cat wears the tint on both screens.
            this.scene.setPlayerTint(session.isGuest ? PEER_TINT : null);
            this.scene.setPeerTint(session.isHost ? PEER_TINT : null);
        }
        
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
        if (this.mp) {
            this.mp.session.onPeerMove = () => {};
            this.mp.session.onPeerWin = () => {};
            this.mp.session.onPeerRestart = () => {};
            this.mp.session.onPeerExitLevel = () => {};
        }
        if (this.bgmPlayOnceHandler) {
            window.removeEventListener('click', this.bgmPlayOnceHandler);
            this.bgmPlayOnceHandler = null;
        }
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
            this.bgmPlayOnceHandler = playOnce;
            window.addEventListener('click', playOnce);
        });
    }

    private startAnimationLoop() {
        const loop = () => {
            if (this.isDestroyed) return;
            if (this.currentMap) {
                const now = performance.now();
                let progress = Math.min(1, (now - this.lastMoveTime) / this.moveAnimDuration);
                
                if (progress >= 1 && this.moveQueue.length > 0 && !this.isGameOver) {
                    const next = this.moveQueue.shift()!;
                    this.executeMove(next.dx, next.dy, next.orientation);
                    progress = 0;
                }

                let peerState: CatRenderState | undefined;
                if (this.mp && this.peerPos) {
                    let peerProgress = 1;
                    if (this.peerAnim) {
                        peerProgress = Math.min(1, (now - this.peerAnim.start) / this.moveAnimDuration);
                        if (peerProgress >= 1) {
                            this.peerAnim = null;
                            this.peerLastPushed = null;
                        }
                    }
                    peerState = {
                        orientation: this.peerOrientation,
                        isMoving: peerProgress < 1,
                        progress: peerProgress,
                        moveDir: this.peerAnim ? { x: this.peerAnim.dx, y: this.peerAnim.dy } : { x: 0, y: 0 },
                        pushedBox: this.peerLastPushed,
                        tileX: this.peerPos.x,
                        tileY: this.peerPos.y
                    };
                }

                this.scene.render(this.currentMap, {
                    orientation: this.playerOrientation,
                    isMoving: progress < 1,
                    progress: progress,
                    moveDir: this.lastMoveDir,
                    pushedBox: this.lastPushedBox
                }, peerState);
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    private executeMove(dx: number, dy: number, orientation: number) {
        if (!this.currentMap || this.isGameOver) {
            this.moveQueue = [];
            return false;
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
            this.updateUI();
            this.mp?.session.sendMove(dx, dy);
            this.checkEndOfMove();
            return true;
        } else {
            this.playerOrientation = orientation;
            this.moveQueue = [];
            return false;
        }
    }

    /** Win/step-limit/deadlock checks after any successful move (either player). */
    private checkEndOfMove() {
        if (!this.currentMap) return;
        if (this.currentMap.isWin()) {
            this.isGameOver = true;
            this.moveQueue = [];
            if (!this.winDeclared) {
                this.winDeclared = true;
                this.mp?.session.sendWin();
            }
            this.showWinAnimation(() => this.onExit(this.currentLevelIndex));
        } else if (this.stepCount >= this.stepLimit) {
            this.isGameOver = true;
            this.moveQueue = [];
            this.showLoseAnimation('晕', '好累……', () => this.afterLose());
        } else if (this.isDeadlockDetected()) {
            this.isGameOver = true;
            this.moveQueue = [];
            this.showLoseAnimation('菜', '有的猫活着……', () => this.afterLose());
        }
    }

    private afterLose() {
        if (this.mp) this.doRestart(true);
        else this.reloadCurrentLevel();
    }

    /** Apply a peer's move to the shared map (peer cat is tracked outside SokobanMap). */
    private applyPeerMove(dx: number, dy: number) {
        if (!this.currentMap || !this.mp || this.isDestroyed || this.isGameOver || !this.peerPos) return;

        const nx = this.peerPos.x + dx;
        const ny = this.peerPos.y + dy;
        if (this.currentMap.hasWall(nx, ny)) return;

        let pushed: { x: number, y: number } | null = null;
        if (this.currentMap.hasBox(nx, ny)) {
            const bx = nx + dx;
            const by = ny + dy;
            if (this.currentMap.hasWall(bx, by) || this.currentMap.hasBox(bx, by)) return;
            this.currentMap.setTile(nx, ny, this.currentMap.getTile(nx, ny) & ~TILE_MASK.BOX);
            this.currentMap.setTile(bx, by, this.currentMap.getTile(bx, by) | TILE_MASK.BOX);
            pushed = { x: bx, y: by };
        }

        this.peerAnim = { dx, dy, start: performance.now() };
        this.peerLastPushed = pushed;
        this.peerPos = { x: nx, y: ny };
        this.peerOrientation = dy < 0 ? 1 : dy > 0 ? 2 : dx < 0 ? 3 : 4;

        this.stepCount++;
        this.updateUI();
        this.checkEndOfMove();
    }

    private handlePeerWin() {
        if (!this.currentMap || this.winDeclared) return;
        this.winDeclared = true;
        this.isGameOver = true;
        this.moveQueue = [];
        this.showWinAnimation(() => this.onExit(this.currentLevelIndex));
    }

    private doRestart(broadcast: boolean) {
        if (!this.mp) {
            this.reloadCurrentLevel();
            return;
        }
        if (broadcast) this.mp.session.sendRestart();
        this.loadMultiplayerLevel(this.mp.ref);
    }

    private reloadCurrentLevel() {
        if (this.isGeneratedLevel && this.generatedLevelData && this.generatedLevelMeta) {
            this.loadGeneratedLevel(this.generatedLevelData, this.generatedLevelMeta);
        } else if (this.isSpecialLevel && this.currentSpecialLevelId) {
            this.loadSpecialLevel(this.currentSpecialLevelId);
        } else {
            this.loadLevel(this.currentLevelIndex);
        }
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
                    this.onExit(this.currentLevelIndex);
                }
                else if (name === 'theme') showThemeDialog(this.container);
                else if (name === 'settings') this.showSettings();
            };
            topIcons.appendChild(img);
        });
        uiOverlay.appendChild(topIcons);

        // Bottom Left: Items (undo/hint disabled in multiplayer)
        const itemBar = document.createElement('div');
        itemBar.className = 'ui-item-bar';
        const currentItems = progressManager.getItemCounts();
        const items = [
            { id: 'hint', img: 'hint.png', count: currentItems.hint, action: () => this.useHint() },
            { id: 'plus', img: 'plus.png', count: currentItems.plus, action: () => this.usePlus() },
            { id: 'undo', img: 'withdraw.png', count: currentItems.undo, action: () => this.useUndo() }
        ].filter(item => !this.mp || item.id === 'plus');

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
        if (this.isGeneratedLevel && this.generatedLevelMeta) {
            const d = this.generatedLevelMeta.difficulty;
            this.uiElements.levelText.innerText = `探索 ${'★'.repeat(d)}`;
        } else if (this.isSpecialLevel && this.currentSpecialLevelId) {
            this.uiElements.levelText.innerText = `特殊关卡 ${this.currentSpecialLevelId}`;
        } else {
            this.uiElements.levelText.innerText = `关卡 ${this.currentLevelIndex + 1}`;
        }
        this.uiElements.stepText.innerText = `移动步数: ${this.stepCount}`;
        this.uiElements.limitText.innerText = `步数限制: ${Number.isFinite(this.stepLimit) ? this.stepLimit : '∞'}`;
        const counts = progressManager.getItemCounts();
        if (this.uiElements.itemHintText) this.uiElements.itemHintText.innerText = `x${counts.hint}`;
        if (this.uiElements.itemPlusText) this.uiElements.itemPlusText.innerText = `x${counts.plus}`;
        if (this.uiElements.itemUndoText) this.uiElements.itemUndoText.innerText = `x${counts.undo}`;
    }

    private useHint() {
        if (this.mp) return;
        const now = performance.now();
        if (progressManager.getItemCounts().hint <= 0 || !this.currentMap || this.isGameOver || (now - this.lastMoveTime < this.moveAnimDuration) || this.moveQueue.length > 0) return;
        
        const solver = new AStarSolver(this.currentMap);
        const result = solver.solve(5000);
        
        if (result.status === 'solved' && result.path && result.path.length > 0) {
            const movesToTake = Math.min(result.path.length, 3);
            for (let i = 0; i < movesToTake; i++) {
                const move = result.path[i];
                let dx = 0, dy = 0, orientation = 2;
                switch (move) {
                    case 'w': dx = 0; dy = -1; orientation = 1; break;
                    case 's': dx = 0; dy = 1; orientation = 2; break;
                    case 'a': dx = -1; dy = 0; orientation = 3; break;
                    case 'd': dx = 1; dy = 0; orientation = 4; break;
                }
                this.moveQueue.push({ dx, dy, orientation });
            }
            progressManager.useItem('hint');
            this.updateUI();
        } else {
            alert('此局无解，建议重置或撤销！');
        }
    }

    private usePlus() {
        if (progressManager.getItemCounts().plus <= 0 || !this.currentMap) return;
        this.stepLimit += 5;
        progressManager.useItem('plus');
        
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
        if (this.mp) return;
        if (progressManager.getItemCounts().undo <= 0 || !this.currentMap) return;
        if (this.currentMap.undo()) {
            this.isGameOver = false;
            if (this.currentOverlay) {
                this.currentOverlay.remove();
                this.currentOverlay = null;
            }
            this.stepCount--;
            progressManager.useItem('undo');
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
        this.isGeneratedLevel = false;
        this.isSpecialLevel = false;
        this.currentSpecialLevelId = null;
        this.generatedLevelData = null;
        this.generatedLevelMeta = null;
        this.currentMap = new SokobanMap(MAP_DATA[index]);
        this.stepCount = 0;
        this.isGameOver = false;

        // Calculate step limit using A*
        const solver = new AStarSolver(this.currentMap);
        const result = solver.solve(10000);
        if (result.status === 'solved' && result.path) {
            this.optimalSteps = result.path.length;
            this.stepLimit = this.optimalSteps + 15;
        } else {
            this.optimalSteps = 0;
            this.stepLimit = Number.POSITIVE_INFINITY;
        }

        this.scene.setInitialAnchor(this.currentMap);
        this.updateUI();
    }

    loadSpecialLevel(specialLevelId: string) {
        const entry = SPECIAL_LEVEL_LIBRARY[specialLevelId];
        if (!entry) return;

        if (this.currentOverlay) {
            this.currentOverlay.remove();
            this.currentOverlay = null;
        }

        const fadeOverlay = document.createElement('div');
        fadeOverlay.className = 'fade-in-overlay';
        this.scene.getCanvas().parentElement?.appendChild(fadeOverlay);

        setTimeout(() => {
            fadeOverlay.classList.add('hide');
            setTimeout(() => fadeOverlay.remove(), 1000);
        }, 50);

        this.currentLevelIndex = -1;
        this.isGeneratedLevel = false;
        this.isSpecialLevel = true;
        this.currentSpecialLevelId = specialLevelId;
        this.generatedLevelData = null;
        this.generatedLevelMeta = null;
        this.currentMap = new SokobanMap(entry.data);
        this.stepCount = 0;
        this.isGameOver = false;

        const solver = new AStarSolver(this.currentMap);
        const result = solver.solve(10000);
        if (result.status === 'solved' && result.path) {
            this.optimalSteps = result.path.length;
            this.stepLimit = this.optimalSteps + 15;
        } else {
            this.optimalSteps = 0;
            this.stepLimit = Number.POSITIVE_INFINITY;
        }

        this.scene.setInitialAnchor(this.currentMap);
        this.updateUI();
    }

    loadGeneratedLevel(data: number[][], meta: GeneratedLevelMeta) {
        if (this.currentOverlay) {
            this.currentOverlay.remove();
            this.currentOverlay = null;
        }

        const fadeOverlay = document.createElement('div');
        fadeOverlay.className = 'fade-in-overlay';
        this.scene.getCanvas().parentElement?.appendChild(fadeOverlay);
        setTimeout(() => {
            fadeOverlay.classList.add('hide');
            setTimeout(() => fadeOverlay.remove(), 1000);
        }, 50);

        this.isGeneratedLevel = true;
        this.isSpecialLevel = false;
        this.currentSpecialLevelId = null;
        this.generatedLevelData = data;
        this.generatedLevelMeta = meta;
        this.currentLevelIndex = -1;
        this.currentMap = new SokobanMap(data);
        this.stepCount = 0;
        this.isGameOver = false;

        if (typeof meta.optimalSteps === 'number') {
            this.optimalSteps = meta.optimalSteps;
            this.stepLimit = this.optimalSteps + 15;
        } else {
            this.optimalSteps = 0;
            this.stepLimit = Number.POSITIVE_INFINITY;
        }

        this.scene.setInitialAnchor(this.currentMap);
        this.updateUI();
    }

    /**
     * Multiplayer shared level: builds the map from a LevelRef (deterministic on
     * both clients), overrides spawn points, uses optimalSteps + 25 as limit.
     */
    loadMultiplayerLevel(ref: LevelRef) {
        if (!this.mp) return;
        const mp = this.mp;

        if (this.currentOverlay) {
            this.currentOverlay.remove();
            this.currentOverlay = null;
        }

        const fadeOverlay = document.createElement('div');
        fadeOverlay.className = 'fade-in-overlay';
        this.scene.getCanvas().parentElement?.appendChild(fadeOverlay);
        setTimeout(() => {
            fadeOverlay.classList.add('hide');
            setTimeout(() => fadeOverlay.remove(), 1000);
        }, 50);

        this.isGeneratedLevel = false;
        this.isSpecialLevel = false;
        this.currentSpecialLevelId = null;
        this.generatedLevelData = null;
        this.generatedLevelMeta = null;

        let data: number[][];
        if (ref.kind === 'handcrafted') {
            this.currentLevelIndex = ref.index;
            data = MAP_DATA[ref.index];
        } else if (ref.kind === 'special') {
            const entry = SPECIAL_LEVEL_LIBRARY[ref.id];
            if (!entry) return;
            this.currentLevelIndex = -1;
            this.isSpecialLevel = true;
            this.currentSpecialLevelId = ref.id;
            data = entry.data;
        } else {
            this.currentLevelIndex = -1;
            this.isGeneratedLevel = true;
            this.generatedLevelData = ref.data;
            this.generatedLevelMeta = ref.meta;
            data = ref.data;
        }

        this.currentMap = new SokobanMap(data);

        this.stepCount = 0;
        this.isGameOver = false;
        this.moveQueue = [];
        this.winDeclared = false;
        this.peerAnim = null;
        this.peerLastPushed = null;
        this.peerOrientation = 2;

        if (mp.spawns) {
            // Shared session: strip the map's default player, place both cats.
            const mySpawn = mp.spawns[mp.session.isHost ? 0 : 1];
            const peerSpawn = mp.spawns[mp.session.isHost ? 1 : 0];
            for (let y = 0; y < this.currentMap.getHeight(); y++) {
                for (let x = 0; x < this.currentMap.getWidth(); x++) {
                    if (this.currentMap.hasPlayer(x, y)) {
                        this.currentMap.setTile(x, y, this.currentMap.getTile(x, y) & ~TILE_MASK.PLAYER);
                    }
                }
            }
            this.currentMap.setTile(mySpawn.x, mySpawn.y, this.currentMap.getTile(mySpawn.x, mySpawn.y) | TILE_MASK.PLAYER);
            this.peerPos = { x: peerSpawn.x, y: peerSpawn.y };
            this.scene.setPeerVisible(true);
        } else {
            // Solo entry in a multiplayer session: no peer cat in this level.
            this.peerPos = null;
            this.scene.setPeerVisible(false);
        }

        // Step limit: A* for static levels, generator meta for generated ones. +25 in MP.
        if (ref.kind === 'generated' && typeof ref.meta.optimalSteps === 'number') {
            this.optimalSteps = ref.meta.optimalSteps;
            this.stepLimit = this.optimalSteps + 25;
        } else {
            const solver = new AStarSolver(this.currentMap);
            const result = solver.solve(10000);
            if (result.status === 'solved' && result.path) {
                this.optimalSteps = result.path.length;
                this.stepLimit = this.optimalSteps + 25;
            } else {
                this.optimalSteps = 0;
                this.stepLimit = Number.POSITIVE_INFINITY;
            }
        }

        this.scene.setInitialAnchor(this.currentMap);
        this.updateUI();
    }

    private setupInput() {
        const keyHandler = (e: KeyboardEvent) => {
            if (!this.currentMap || this.isDestroyed || this.isGameOver) return;

            // Manual movement input cancels any pending hint replay (same as LevelSelect pathfinding)
            const isMovementKey = ['w', 'a', 's', 'd', 'h', 'j', 'k', 'l'].includes(e.key) || e.key.startsWith('Arrow');
            if (isMovementKey && this.moveQueue.length > 0) {
                this.moveQueue = [];
            }

            // Prevent moving while animation is playing
            const now = performance.now();
            if (now - this.lastMoveTime < this.moveAnimDuration) return;

            let moveResult: { moved: boolean, pushedBox?: { x: number, y: number } } = { moved: false };
            let newOrientation = this.playerOrientation;
            let dx = 0, dy = 0;

            switch (e.key) {
                case 'ArrowUp':
                case 'w':
                case 'k':
                    newOrientation = 1;
                    dx = 0; dy = -1;
                    moveResult = this.currentMap.movePlayer(dx, dy);
                    break;
                case 'ArrowDown':
                case 's':
                case 'j':
                    newOrientation = 2;
                    dx = 0; dy = 1;
                    moveResult = this.currentMap.movePlayer(dx, dy);
                    break;
                case 'ArrowLeft':
                case 'a':
                case 'h':
                    newOrientation = 3;
                    dx = -1; dy = 0;
                    moveResult = this.currentMap.movePlayer(dx, dy);
                    break;
                case 'ArrowRight':
                case 'd':
                case 'l':
                    newOrientation = 4;
                    dx = 1; dy = 0;
                    moveResult = this.currentMap.movePlayer(dx, dy);
                    break;
                case 'r':
                    if (this.mp) this.doRestart(true);
                    else this.reloadCurrentLevel();
                    return;
                case 'Escape':
                    this.destroy();
                    this.onExit(this.currentLevelIndex);
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
                this.mp?.session.sendMove(dx, dy);
                this.checkEndOfMove();
            }
        };
        this.addManagedEventListener(window, 'keydown', keyHandler);
    }

    private isDeadlockDetected(): boolean {
        if (!this.currentMap) return false;
        
        // Basic deadlock check (corners)
        if (this.currentMap.isDeadlock()) return true;

        // Advanced A* deadlock check (disabled in multiplayer: the peer's cat
        // breaks single-player solvability assumptions)
        if (!this.mp && settingsManager.currentSettings.useAStar) {
            const solver = new AStarSolver(this.currentMap);
            // Use a smaller node limit for real-time check to avoid lag
            const result = solver.solve(2000); 
            if (result.status === 'unsolvable') {
                return true;
            }
        }

        return false;
    }

    private getStarRating(): number {
        if (this.optimalSteps <= 0) return 1;
        const ratio = this.stepCount / this.optimalSteps;
        if (ratio <= 1.0) return 3;
        if (ratio <= 1.5) return 2;
        return 1;
    }

    private calculateFishDrop(): number {
        const stars = this.getStarRating();
        const difficulty = this.generatedLevelMeta?.difficulty ?? 1;
        let fish = 1;
        if (stars >= 3) fish += 1;
        if (difficulty >= 4) fish += 1;
        return fish;
    }

    private showWinAnimation(callback: () => void) {
        if (this.isDestroyed) return;
        const stars = this.getStarRating();
        const starText = '★'.repeat(stars) + '☆'.repeat(3 - stars);
        const fishReward = this.isGeneratedLevel ? this.calculateFishDrop() : 0;
        const fishHtml = fishReward > 0
            ? `<div class="win-fish">+${fishReward} <img src="/assets/images/fish.png" alt="小鱼干"></div>`
            : '';
        const overlay = document.createElement('div');
        this.currentOverlay = overlay;
        overlay.className = 'win-overlay';
        overlay.innerHTML = `
            <div class="win-content">
                <div class="win-line"></div>
                <div class="win-text">完成</div>
                <div class="win-stars">${starText}</div>
                ${fishHtml}
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
                if (!this.isDestroyed) {
                    if (!this.isGeneratedLevel && !this.isSpecialLevel) {
                        progressManager.completeLevel(this.currentLevelIndex);
                    } else if (this.isGeneratedLevel && this.generatedLevelMeta) {
                        progressManager.addFish(fishReward);
                        progressManager.completeGeneratedLevel(
                            this.generatedLevelMeta.worldX,
                            this.generatedLevelMeta.worldY
                        );
                    }
                    callback();
                }
            }, 150);
        }, 700);
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
