import { myRand, randColorBiome } from '../utils';
import { MAP_DATA } from './mapData';
import { showThemeDialog } from '../ui/themeDialog';
import { showSettingsDialog } from '../ui/settingsDialog';
import { createDialog } from '../ui/dialog';
import { themeManager, THEMES } from '../theme';
import { characterManager, worldManager } from '../save';
import { settingsManager } from '../settings';
import { generatePuzzle } from './puzzleGenerator';
import { getBiomeAt, getAllBiomeSpritesPaths } from './biomes';
import { applyStructuresToGrid, registerStructure, resolveSpecialLevelIdAt, resolveStructureDiscoveryAt } from './worldStructures';
import { lakeIslandStructure } from './structures';
import type { Equipment } from './types';
import type { GeneratedLevelMeta } from './puzzleGenerator';
import type { MultiplayerSession, PeerWorldState } from '../net/MultiplayerSession';
import { PEER_TINT } from '../net/protocol';
import type { Dir, LevelRef } from '../net/protocol';

registerStructure(lakeIslandStructure);

export class LevelSelect {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private catImg: HTMLImageElement;
    private chestImg: HTMLImageElement;
    private equipmentImg: HTMLImageElement;
    private fishCountEl: HTMLElement;
    private currentCatImgPath: string = '';
    private currentChestImgPath: string = '';
    private isChestOpening: boolean = false;
    private uiOverlay: HTMLElement | null = null;
    private messageEl: HTMLElement | null = null;
    private messageTimeout: any = null;
    private structureDiscoverEl: HTMLElement | null = null;
    private structureDiscoverTimeout: any = null;
    private currentStructureZoneId: string | null = null;
    private chunks: Map<string, Int8Array> = new Map();
    private catX: number = 0;
    private catY: number = 0;
    private catDir: 'front' | 'back' | 'left' | 'right' = 'front';
    private isMoving: boolean = false;
    private moveProgress: number = 0;
    private moveStartX: number = 0;
    private moveStartY: number = 0;
    private moveTargetX: number = 0;
    private moveTargetY: number = 0;
    private movePath: {x: number, y: number}[] = [];
    private isMouseMoving: boolean = false;
    private currentMoveDuration: number = 150;
    private readonly MOVE_DURATION_PER_TILE = 150; // ms
    private lastFrameTime: number = 0;
    private isCameraFollowing: boolean = false;

    private anchorX: number = 0;
    private anchorY: number = 0;
    private nodeWidth: number = 40;
    private images: Map<string, HTMLImageElement> = new Map();
    private themeListener: (theme: any) => void;
    
    private readonly CHUNK_WIDTH = 40;  // 2x screen width
    private readonly CHUNK_HEIGHT = 30; // 2x screen height
    private readonly HALO_SIZE = 10;
    private readonly CA_ITERATIONS = 5; // Reduced to preserve medium features
    
    private WATER = -3;
    private ROCK = -2;
    private CHEST = -1;
    private SPECIAL_LEVEL = -4;
    private DECORATION = -5;
    private readonly GENERATED_LEVEL = 50;
    private readonly LEVEL_SPACING = 6;
    private readonly GENERATED_LEVEL_CELL = 10; // cell size for generated level placement
    
    private onLevelSelect: (levelIndex: number, generatedData?: number[][], generatedMeta?: GeneratedLevelMeta, specialLevelId?: string, returnWorldPos?: {x: number, y: number}) => void;
    private onBack: () => void;
    private boundKeyDown: (e: KeyboardEvent) => void;

    private isDragging = false;
    private lastMouseX = 0;
    private lastMouseY = 0;
    private mouseDownX = 0;
    private mouseDownY = 0;

    private generatedPuzzleCache: Map<string, { data: number[][], meta: GeneratedLevelMeta }> = new Map();

    // Multiplayer state
    private session?: MultiplayerSession;
    private onMpLevelSelect?: (ref: LevelRef, returnPos: { x: number; y: number }) => void;
    private peerImg: HTMLImageElement;
    private peerNameEl: HTMLDivElement;
    private currentPeerImgPath: string = '';
    private peerState: PeerWorldState | null = null;
    private peerAnim: { fromX: number; fromY: number; toX: number; toY: number; start: number } | null = null;
    private pendingGuestSpawn = false;
    private readyDialog: HTMLElement | null = null;

    constructor(container: HTMLElement, onLevelSelect: (levelIndex: number, generatedData?: number[][], generatedMeta?: GeneratedLevelMeta, specialLevelId?: string, returnWorldPos?: {x: number, y: number}) => void, onBack: () => void, initialLevelIndex: number = 0, initialWorldPos?: {x: number, y: number}, session?: MultiplayerSession, onMpLevelSelect?: (ref: LevelRef, returnPos: { x: number; y: number }) => void) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 800;
        this.canvas.height = 600;
        this.canvas.style.display = 'block';
        this.canvas.style.imageRendering = 'pixelated';
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.zIndex = '0';
        this.ctx = this.canvas.getContext('2d')!;
        this.ctx.imageSmoothingEnabled = false;
        container.appendChild(this.canvas);

        this.catImg = document.createElement('img');
        this.catImg.style.position = 'absolute';
        this.catImg.style.pointerEvents = 'none';
        this.catImg.style.imageRendering = 'pixelated';
        this.catImg.style.width = `${this.nodeWidth}px`;
        this.catImg.style.height = `${this.nodeWidth}px`;
        this.catImg.style.zIndex = '10';
        this.catImg.style.display = 'block';
        container.appendChild(this.catImg);

        this.peerImg = document.createElement('img');
        this.peerImg.style.position = 'absolute';
        this.peerImg.style.pointerEvents = 'none';
        this.peerImg.style.imageRendering = 'pixelated';
        this.peerImg.style.width = `${this.nodeWidth}px`;
        this.peerImg.style.height = `${this.nodeWidth}px`;
        this.peerImg.style.zIndex = '10';
        this.peerImg.style.display = 'none';
        container.appendChild(this.peerImg);

        this.peerNameEl = document.createElement('div');
        this.peerNameEl.style.position = 'absolute';
        this.peerNameEl.style.fontFamily = 'Pixel';
        this.peerNameEl.style.fontSize = '12px';
        this.peerNameEl.style.color = '#fff';
        this.peerNameEl.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
        this.peerNameEl.style.transform = 'translateX(-50%)';
        this.peerNameEl.style.pointerEvents = 'none';
        this.peerNameEl.style.whiteSpace = 'nowrap';
        this.peerNameEl.style.zIndex = '11';
        this.peerNameEl.style.display = 'none';
        container.appendChild(this.peerNameEl);

        this.chestImg = document.createElement('img');
        this.chestImg.style.position = 'absolute';
        this.chestImg.style.pointerEvents = 'none';
        this.chestImg.style.imageRendering = 'pixelated';
        this.chestImg.style.width = `${this.nodeWidth}px`;
        this.chestImg.style.height = `${this.nodeWidth}px`;
        this.chestImg.style.zIndex = '9';
        this.chestImg.style.display = 'none';
        container.appendChild(this.chestImg);

        this.equipmentImg = document.createElement('img');
        this.equipmentImg.style.position = 'absolute';
        this.equipmentImg.style.bottom = '20px';
        this.equipmentImg.style.right = '20px';
        this.equipmentImg.style.width = '64px';
        this.equipmentImg.style.height = '64px';
        this.equipmentImg.style.zIndex = '100';
        this.equipmentImg.style.pointerEvents = 'auto';
        this.equipmentImg.style.cursor = 'pointer';
        this.equipmentImg.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
        this.equipmentImg.style.borderRadius = '8px';
        this.equipmentImg.onclick = () => {
            const current = characterManager.getEquipment();
            const next: Equipment = current === 'none' ? 'boat' : (current === 'boat' ? 'wing' : 'none');
            characterManager.setEquipment(next);
            this.session?.sendEquip(next);
            this.updateEquipmentUI();
            this.draw();
        };
        container.appendChild(this.equipmentImg);

        this.fishCountEl = document.createElement('div');
        this.fishCountEl.style.position = 'absolute';
        this.fishCountEl.style.bottom = '90px';
        this.fishCountEl.style.right = '20px';
        this.fishCountEl.style.zIndex = '100';
        this.fishCountEl.style.fontFamily = 'Pixel, monospace';
        this.fishCountEl.style.fontSize = '16px';
        this.fishCountEl.style.color = '#fff';
        this.fishCountEl.style.textShadow = '1px 1px 2px rgba(0,0,0,0.6)';
        this.fishCountEl.style.textAlign = 'center';
        this.fishCountEl.style.minWidth = '64px';
        container.appendChild(this.fishCountEl);

        this.onLevelSelect = onLevelSelect;
        this.onBack = onBack;
        
        // Initial cat position
        if (initialWorldPos) {
            this.catX = initialWorldPos.x;
            this.catY = initialWorldPos.y;
        } else {
            this.catX = initialLevelIndex * this.LEVEL_SPACING;
            this.catY = myRand(initialLevelIndex, 777, 0, -4, 4);
        }

        this.anchorX = 800 / 2 - this.catX * this.nodeWidth - this.nodeWidth / 2;
        this.anchorY = 600 / 2 - this.catY * this.nodeWidth - this.nodeWidth / 2;

        this.session = session;
        this.onMpLevelSelect = onMpLevelSelect;
        if (session) {
            if (session.isGuest) {
                // Guest cat wears the tint; its spawn is resolved once the host's position arrives.
                this.catImg.style.filter = PEER_TINT;
                this.catImg.style.display = 'none';
                this.pendingGuestSpawn = true;
            } else {
                this.peerImg.style.filter = PEER_TINT;
            }
            session.onPeerWorldUpdate = (peer) => this.handlePeerWorldUpdate(peer);
            session.onReadyPrompt = () => this.showReadyPrompt();
            session.onReadyCancelled = () => this.closeReadyDialog();
            // Restore the peer's latest known state (e.g. when coming back from a level).
            if (session.peer) {
                this.handlePeerWorldUpdate(session.peer);
            }
        }

        this.boundKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.onBack();
                return;
            }

            if (this.pendingGuestSpawn) return;

            const key = e.key.toLowerCase();
            const isMovementKey = ['w', 'a', 's', 'd', 'h', 'j', 'k', 'l'].includes(key)
                || e.key.startsWith('Arrow');

            if (isMovementKey && this.isMoving && this.movePath.length > 0) {
                // Interrupt pathfinding move
                this.movePath = [];
            }

            if (this.isMoving) return;

            let dx = 0;
            let dy = 0;
            let newDir: typeof this.catDir = this.catDir;

            if (key === 'w' || key === 'k' || e.key === 'ArrowUp') { dy = -1; newDir = 'back'; }
            else if (key === 's' || key === 'j' || e.key === 'ArrowDown') { dy = 1; newDir = 'front'; }
            else if (key === 'a' || key === 'h' || e.key === 'ArrowLeft') { dx = -1; newDir = 'left'; }
            else if (key === 'd' || key === 'l' || e.key === 'ArrowRight') { dx = 1; newDir = 'right'; }
            else if (e.key === 'Enter') {
                this.tryEnterLevel(this.catX, this.catY);
                return;
            } else if (key === 'p') {
                if (this.session && this.onMpLevelSelect) {
                    const ref: LevelRef = { kind: 'special', id: 'special_hard_1' };
                    this.session.sendEnter(this.catX, this.catY);
                    this.onMpLevelSelect(ref, { x: this.catX, y: this.catY });
                } else {
                    this.onLevelSelect(-1, undefined, undefined, 'special_hard_1', { x: this.catX, y: this.catY });
                }
                return;
            }

            if (dx !== 0 || dy !== 0) {
                this.catDir = newDir;
                const targetX = this.catX + dx;
                const targetY = this.catY + dy;
                const tile = this.getTileAt(targetX, targetY);
                
                const equipment = characterManager.getEquipment();
                let canMove = false;
                if (equipment === 'wing') {
                    canMove = true; // Wing can go anywhere
                } else if (equipment === 'boat') {
                    canMove = (tile !== this.ROCK && tile !== this.CHEST);
                } else {
                    canMove = (tile !== this.WATER && tile !== this.ROCK && tile !== this.CHEST);
                }

                if (canMove) {
                    this.startMove(targetX, targetY);
                } else {
                    this.draw(); // Just update direction
                }
            }
        };
        window.addEventListener('keydown', this.boundKeyDown);

        this.themeListener = () => {
            this.draw();
        };
        themeManager.addListener(this.themeListener);
        
        this.loadImages().then(() => {
            this.init();
            this.createUI(container);
            requestAnimationFrame(this.animate.bind(this));
        });

        // Dragging listeners
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            this.mouseDownX = e.clientX;
            this.mouseDownY = e.clientY;
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                this.anchorX += dx;
                this.anchorY += dy;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                // No need to call draw() here, animate() handles it
            }
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        // Add click listener for level selection
        this.canvas.addEventListener('click', (e) => {
            if (this.isMoving || this.pendingGuestSpawn) return;
            
            // If moved more than 10px, it's a drag, not a click
            const dragDist = Math.sqrt(Math.pow(e.clientX - this.mouseDownX, 2) + Math.pow(e.clientY - this.mouseDownY, 2));
            if (dragDist > 10) return;

            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const tileX = Math.floor((mouseX - this.anchorX) / this.nodeWidth);
            const tileY = Math.floor((mouseY - this.anchorY) / this.nodeWidth);
            
            if (tileX === this.catX && tileY === this.catY) {
                this.tryEnterLevel(tileX, tileY);
                return;
            }

            const equipment = characterManager.getEquipment();

            if (equipment === 'wing') {
                // Wing can move anywhere directly
                this.startMove(tileX, tileY, [], true);
            } else {
                // None or Boat use A*
                const path = this.findPath(this.catX, this.catY, tileX, tileY);
                if (path && path.length > 0) {
                    const first = path.shift()!;
                    this.startMove(first.x, first.y, path, true);
                }
            }
        });
    }

    private startMove(tx: number, ty: number, path: {x: number, y: number}[] = [], isMouse: boolean = false) {
        const dx = tx - this.catX;
        const dy = ty - this.catY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0 && path.length === 0) return;

        // Walking away cancels my pending ready request (peer's prompt closes too)
        this.session?.cancelReady();

        this.isMoving = true;
        this.isMouseMoving = isMouse;
        this.moveProgress = 0;
        this.moveStartX = this.catX;
        this.moveStartY = this.catY;
        this.moveTargetX = tx;
        this.moveTargetY = ty;
        this.movePath = path;

        // Proportional duration, but capped for very long distances
        this.currentMoveDuration = Math.min(dist * this.MOVE_DURATION_PER_TILE, 800);

        if (Math.abs(dx) > Math.abs(dy)) {
            this.catDir = dx > 0 ? 'right' : 'left';
        } else {
            this.catDir = dy > 0 ? 'front' : 'back';
        }
    }

    private tryEnterLevel(tileX: number, tileY: number) {
        if (this.session && this.onMpLevelSelect) {
            this.tryEnterLevelMp(tileX, tileY);
            return;
        }
        const val = this.getTileAt(tileX, tileY);
        if (val > 0 && val < this.GENERATED_LEVEL) {
            // Handcrafted level
            this.onLevelSelect(val - 1);
        } else if (val === this.SPECIAL_LEVEL) {
            const mapSeed = parseInt(worldManager.getSeed(), 10) || 0;
            const specialLevelId = resolveSpecialLevelIdAt(tileX, tileY, mapSeed);
            if (specialLevelId) {
                this.onLevelSelect(-1, undefined, undefined, specialLevelId, { x: tileX, y: tileY });
            }
        } else if (val === this.GENERATED_LEVEL) {
            // Generated level - generate puzzle from world coordinates
            const key = `${tileX},${tileY}`;
            let cached = this.generatedPuzzleCache.get(key);
            if (!cached) {
                const seed = parseInt(worldManager.getSeed()) || 0;
                const difficulty = this.getDifficultyAt(tileX, tileY);
                const result = generatePuzzle(tileX, tileY, seed, difficulty);
                if (result) {
                    cached = result;
                    this.generatedPuzzleCache.set(key, result);
                } else {
                    // Generation failed — erase the tile so it no longer appears on the map
                    this.setTileAt(tileX, tileY, 0);
                    return;
                }
            }
            if (cached) {
                this.onLevelSelect(-1, cached.data, cached.meta);
            }
        }
    }

    // ---- Multiplayer: level entry & ready-check ----

    private levelRefAt(tileX: number, tileY: number): LevelRef | null {
        const val = this.getTileAt(tileX, tileY);
        if (val > 0 && val < this.GENERATED_LEVEL) {
            return { kind: 'handcrafted', index: val - 1 };
        }
        if (val === this.SPECIAL_LEVEL) {
            const mapSeed = parseInt(worldManager.getSeed(), 10) || 0;
            const id = resolveSpecialLevelIdAt(tileX, tileY, mapSeed);
            return id ? { kind: 'special', id } : null;
        }
        if (val === this.GENERATED_LEVEL) {
            const key = `${tileX},${tileY}`;
            let cached = this.generatedPuzzleCache.get(key);
            if (!cached) {
                const seed = parseInt(worldManager.getSeed()) || 0;
                const difficulty = this.getDifficultyAt(tileX, tileY);
                const result = generatePuzzle(tileX, tileY, seed, difficulty);
                if (!result) {
                    this.setTileAt(tileX, tileY, 0);
                    return null;
                }
                cached = result;
                this.generatedPuzzleCache.set(key, result);
            }
            return { kind: 'generated', x: tileX, y: tileY, data: cached.data, meta: cached.meta };
        }
        return null;
    }

    private tryEnterLevelMp(tileX: number, tileY: number) {
        const ref = this.levelRefAt(tileX, tileY);
        if (!ref || !this.session || !this.onMpLevelSelect) return;

        const peer = this.peerState;
        const sharedTile = !!(peer && !peer.inLevel && peer.x === tileX && peer.y === tileY);
        if (sharedTile) {
            // Both cats on the tile: start the ready-check handshake.
            if (this.session.requestReady(ref)) {
                this.showReadyWaiting();
            }
        } else {
            // Solo entry — the peer will see this cat standing on the tile.
            this.session.sendEnter(tileX, tileY);
            this.onMpLevelSelect(ref, { x: tileX, y: tileY });
        }
    }

    private showReadyWaiting() {
        if (!this.uiOverlay) return;
        this.closeReadyDialog();
        const { shade, paper } = createDialog(this.uiOverlay!, '共同进入', () => {
            this.session?.cancelReady();
        });
        const text = document.createElement('div');
        text.className = 'mp-dialog-text';
        text.innerText = '等待对方确认…（1/2）';
        paper.appendChild(text);
        this.readyDialog = shade;
    }

    private showReadyPrompt() {
        if (!this.uiOverlay) return;
        this.closeReadyDialog();
        const { shade, paper } = createDialog(this.uiOverlay!, '共同进入', () => {
            this.session?.declineReady();
        });
        const text = document.createElement('div');
        text.className = 'mp-dialog-text';
        text.innerText = `${this.session?.peerName ?? '对方'} 想一起进入这个关卡`;
        paper.appendChild(text);

        const row = document.createElement('div');
        row.className = 'settings-row';
        const okBtn = document.createElement('button');
        okBtn.innerText = '确认';
        okBtn.onclick = () => {
            this.session?.acceptReady();
            this.closeReadyDialog();
        };
        const noBtn = document.createElement('button');
        noBtn.innerText = '取消';
        noBtn.style.color = 'red';
        noBtn.onclick = () => {
            this.session?.declineReady();
            this.closeReadyDialog();
        };
        row.appendChild(okBtn);
        row.appendChild(noBtn);
        paper.appendChild(row);
        this.readyDialog = shade;
    }

    private closeReadyDialog() {
        if (this.readyDialog) {
            this.readyDialog.remove();
            this.readyDialog = null;
        }
    }

    // ---- Multiplayer: peer world state ----

    private sendPos() {
        if (!this.session) return;
        this.session.sendPos(this.catX, this.catY, this.catDir, characterManager.getEquipment());
    }

    private handlePeerWorldUpdate(peer: PeerWorldState) {
        const prev = this.peerState;
        this.peerState = peer;
        if (peer.inLevel) {
            this.peerAnim = null;
        } else if (prev && (prev.x !== peer.x || prev.y !== peer.y)) {
            const fromX = this.peerAnim ? this.peerAnim.toX : prev.x;
            const fromY = this.peerAnim ? this.peerAnim.toY : prev.y;
            this.peerAnim = { fromX, fromY, toX: peer.x, toY: peer.y, start: performance.now() };
        }
        if (this.pendingGuestSpawn && !peer.inLevel) {
            this.resolveGuestSpawn(peer.x, peer.y);
        }
    }

    /** Guest: pick a walkable tile next to the host to spawn on. */
    private resolveGuestSpawn(hostX: number, hostY: number) {
        this.pendingGuestSpawn = false;
        let spawn: { x: number; y: number } | null = null;
        const visited = new Set<string>([`${hostX},${hostY}`]);
        const queue = [{ x: hostX, y: hostY }];
        while (queue.length > 0 && !spawn) {
            const cur = queue.shift()!;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = cur.x + dx;
                const ny = cur.y + dy;
                const k = `${nx},${ny}`;
                if (visited.has(k)) continue;
                visited.add(k);
                const tile = this.getTileAt(nx, ny);
                if (tile === this.WATER || tile === this.ROCK || tile === this.CHEST) continue;
                if (!spawn) spawn = { x: nx, y: ny };
                queue.push({ x: nx, y: ny });
            }
        }
        const target = spawn ?? { x: hostX, y: hostY };
        this.catX = target.x;
        this.catY = target.y;
        this.anchorX = 800 / 2 - this.catX * this.nodeWidth - this.nodeWidth / 2;
        this.anchorY = 600 / 2 - this.catY * this.nodeWidth - this.nodeWidth / 2;
        this.catImg.style.display = 'block';
        this.sendPos();
    }

    private drawPeer() {
        const peer = this.peerState;
        if (!peer || !this.session) {
            this.peerImg.style.display = 'none';
            this.peerNameEl.style.display = 'none';
            return;
        }
        let x = peer.x;
        let y = peer.y;
        let progress = 1;
        if (this.peerAnim) {
            progress = Math.min(1, (performance.now() - this.peerAnim.start) / this.MOVE_DURATION_PER_TILE);
            if (progress >= 1) {
                this.peerAnim = null;
            } else {
                x = this.peerAnim.fromX + (this.peerAnim.toX - this.peerAnim.fromX) * progress;
                y = this.peerAnim.fromY + (this.peerAnim.toY - this.peerAnim.fromY) * progress;
            }
        }
        const screenX = this.anchorX + x * this.nodeWidth;
        const screenY = this.anchorY + y * this.nodeWidth;
        const tile = this.getTileAt(Math.round(x), Math.round(y));
        const { path, flip } = this.pickCatSprite(peer.equipment, peer.dir, progress < 1, false, tile);
        if (this.currentPeerImgPath !== path) {
            this.currentPeerImgPath = path;
            this.peerImg.src = path;
        }
        this.peerImg.style.left = `${screenX}px`;
        this.peerImg.style.top = `${screenY}px`;
        this.peerImg.style.transform = flip ? 'scaleX(-1)' : 'none';
        this.peerImg.style.display = 'block';

        const peerName = this.session?.peerName;
        if (peerName) {
            this.peerNameEl.textContent = peerName;
            this.peerNameEl.style.left = `${screenX + this.nodeWidth / 2}px`;
            this.peerNameEl.style.top = `${screenY - 16}px`;
            this.peerNameEl.style.display = 'block';
        } else {
            this.peerNameEl.style.display = 'none';
        }
    }

    getCatTile(): { x: number; y: number } {
        return { x: this.catX, y: this.catY };
    }

    private getDifficultyAt(x: number, y: number): number {
        const dist = Math.sqrt(x * x + y * y);
        if (dist < 30) return 1;
        if (dist < 60) return 2;
        if (dist < 100) return 3;
        if (dist < 150) return 4;
        return 5;
    }

    private animate(time: number) {
        if (!this.lastFrameTime) this.lastFrameTime = time;
        const dt = Math.min(time - this.lastFrameTime, 100); // Cap dt to avoid huge jumps
        this.lastFrameTime = time;

        if (this.isMoving) {
            this.moveProgress += dt / this.currentMoveDuration;
            
            // Check if leaving chest vicinity during move
            const currentX = this.moveStartX + (this.moveTargetX - this.moveStartX) * this.moveProgress;
            const currentY = this.moveStartY + (this.moveTargetY - this.moveStartY) * this.moveProgress;
            this.checkMessageAutoHide(currentX, currentY);

            if (this.moveProgress >= 1) {
                this.catX = this.moveTargetX;
                this.catY = this.moveTargetY;
                this.moveProgress = 0;
                if (this.session) this.sendPos();
                
                if (this.movePath.length > 0) {
                    const next = this.movePath.shift()!;
                    this.startMove(next.x, next.y, this.movePath, this.isMouseMoving);
                } else {
                    this.isMoving = false;
                    this.isMouseMoving = false;
                    this.checkChestInteraction();
                }
            }
        }

        const currentX = this.isMoving
            ? Math.round(this.moveStartX + (this.moveTargetX - this.moveStartX) * this.moveProgress)
            : this.catX;
        const currentY = this.isMoving
            ? Math.round(this.moveStartY + (this.moveTargetY - this.moveStartY) * this.moveProgress)
            : this.catY;
        this.checkStructureDiscovery(currentX, currentY);

        this.updateCamera();
        this.draw();
        requestAnimationFrame(this.animate.bind(this));
    }

    private checkStructureDiscovery(tileX: number, tileY: number) {
        const mapSeed = parseInt(worldManager.getSeed(), 10) || 0;
        const discovery = resolveStructureDiscoveryAt(tileX, tileY, mapSeed);
        const zoneId = discovery?.id ?? null;

        if (zoneId === this.currentStructureZoneId) return;
        this.currentStructureZoneId = zoneId;

        if (!discovery) return;

        const promptMode = settingsManager.currentSettings.structureDiscoveryPromptMode;
        if (promptMode === 'always') {
            this.showStructureDiscover(discovery.name);
            return;
        }

        if (characterManager.discoverStructure(discovery.id)) {
            this.showStructureDiscover(discovery.name);
        }
    }

    private showStructureDiscover(name: string) {
        if (!this.structureDiscoverEl) return;
        if (this.structureDiscoverTimeout) {
            clearTimeout(this.structureDiscoverTimeout);
            this.structureDiscoverTimeout = null;
        }

        this.structureDiscoverEl.innerText = name;
        this.structureDiscoverEl.style.opacity = '1';

        this.structureDiscoverTimeout = setTimeout(() => {
            if (!this.structureDiscoverEl) return;
            this.structureDiscoverEl.style.opacity = '0';
            this.structureDiscoverTimeout = null;
        }, 2000);
    }

    private getCurrentThemeIndex(): number {
        const currentTheme = themeManager.currentTheme;
        const index = THEMES.findIndex(t => t.name === currentTheme.name);
        return index >= 0 ? index : 0;
    }

    private getChestPos() {
        const level16Index = 15;
        const x = level16Index * this.LEVEL_SPACING + 2;
        const y = myRand(level16Index, 777, 0, -4, 4);
        return { x, y };
    }

    private checkChestInteraction() {
        const { x: chestX, y: chestY } = this.getChestPos();

        // Check if cat is adjacent to chest
        const dx = Math.abs(this.catX - chestX);
        const dy = Math.abs(this.catY - chestY);

        if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
            const level16Completed = this.worldLevelCompleted(15);
            const chestOpened = this.worldChestOpened();

            if (!chestOpened && !this.isChestOpening) {
                if (level16Completed && (!this.session || this.session.isHost)) {
                    // Start opening animation
                    this.isChestOpening = true;
                    // Force a source reset to ensure gif plays from start
                    this.currentChestImgPath = ''; 
                    this.draw(); 
                    setTimeout(() => {
                        worldManager.openChest();
                        this.session?.sendWorldUpdate({ t: 'chestOpened' });
                        this.isChestOpening = false;
                        this.draw();
                    }, 500);
                } else {
                    const screenX = this.anchorX + chestX * this.nodeWidth + this.nodeWidth / 2;
                    const screenY = this.anchorY + chestY * this.nodeWidth - 10;
                    this.showMessage('没钥匙...', screenX, screenY);
                }
            }
        }
    }

    private updateCamera() {
        const targetCatX = this.isMoving ? 
            this.moveStartX + (this.moveTargetX - this.moveStartX) * this.moveProgress : 
            this.catX;
        const targetCatY = this.isMoving ? 
            this.moveStartY + (this.moveTargetY - this.moveStartY) * this.moveProgress : 
            this.catY;

        const idealAnchorX = 800 / 2 - targetCatX * this.nodeWidth - this.nodeWidth / 2;
        const idealAnchorY = 600 / 2 - targetCatY * this.nodeWidth - this.nodeWidth / 2;

        if (this.isDragging) {
            this.isCameraFollowing = false;
            return;
        }

        const dx = idealAnchorX - this.anchorX;
        const dy = idealAnchorY - this.anchorY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Trigger follow if cat moves and is outside threshold
        const threshold = 180; 
        if (this.isMoving && dist > threshold) {
            this.isCameraFollowing = true;
        }

        if (this.isCameraFollowing) {
            // Pull back smoothly
            this.anchorX += dx * 0.08;
            this.anchorY += dy * 0.08;
            
            // Stop following when very close to centered
            if (dist < 1) {
                this.anchorX = idealAnchorX;
                this.anchorY = idealAnchorY;
                this.isCameraFollowing = false;
            }
        }
    }

    private async loadImages() {
        const imagePaths = [
            ...getAllBiomeSpritesPaths(),
            '/assets/images/level.png',
            '/assets/images/item/cloud.png',
            '/assets/images/player_cat/cat_stand.gif',
            '/assets/images/player_cat/cat_stand_back.gif',
            '/assets/images/player_cat/cat_stand_front.gif',
            '/assets/images/player_cat/cat_run.gif',
            '/assets/images/player_cat/cat_run_back.gif',
            '/assets/images/player_cat/cat_run_front.gif',
            '/assets/images/player_cat/cat_boat_up.gif',
            '/assets/images/player_cat/cat_boat_down.gif',
            '/assets/images/player_cat/cat_boat_right.gif',
            '/assets/images/player_cat/cat_fly_up.gif',
            '/assets/images/player_cat/cat_fly_down.gif',
            '/assets/images/player_cat/cat_fly_right.gif',
            '/assets/images/treasure_closed.png',
            '/assets/images/treasure_open.gif',
            '/assets/images/treasure_opened.png',
            '/assets/images/boat.png',
            '/assets/images/wing.png',
            '/assets/images/none.png'
        ];

        const promises = imagePaths.map(path => {
            return new Promise<void>((resolve) => {
                const img = new Image();
                img.src = path;
                img.onload = () => {
                    this.images.set(path, img);
                    resolve();
                };
                img.onerror = () => {
                    console.error(`Failed to load image: ${path}`);
                    resolve();
                };
            });
        });

        await Promise.all(promises);
    }

    private init() {
        const mapSeed = parseInt(worldManager.getSeed(), 10) || 0;
        this.currentStructureZoneId = resolveStructureDiscoveryAt(this.catX, this.catY, mapSeed)?.id ?? null;
        this.checkChestInteraction();
        this.updateEquipmentUI();
        this.updateFishCountUI();
        this.draw();
        if (this.session && !this.pendingGuestSpawn) {
            this.sendPos();
        }
    }

    private updateEquipmentUI() {
        const equipment = characterManager.getEquipment();
        this.equipmentImg.src = `/assets/images/${equipment}.png`;
        this.equipmentImg.style.opacity = equipment === 'none' ? '0.6' : '1';
    }

    private updateFishCountUI() {
        const count = characterManager.getFishCount();
        this.fishCountEl.innerHTML = `<img src="/assets/images/fish.png" alt="小鱼干" style="width:16px;height:16px;image-rendering:pixelated;vertical-align:-3px;margin-right:2px;"> ×${count}`;
        this.fishCountEl.style.display = count > 0 ? '' : 'none';
    }

    private findPath(startX: number, startY: number, targetX: number, targetY: number): {x: number, y: number}[] | null {
        const equipment = characterManager.getEquipment();
        const isWaterObstacle = equipment === 'none';
        
        if (startX === targetX && startY === targetY) return null;

        const openSet: {x: number, y: number, g: number, h: number, f: number, parent: any}[] = [];
        const closedSet = new Set<string>();

        const startNode = {
            x: startX,
            y: startY,
            g: 0,
            h: Math.abs(targetX - startX) + Math.abs(targetY - startY),
            f: 0,
            parent: null as any
        };
        startNode.f = startNode.h;
        openSet.push(startNode);

        const maxIterations = 2000;
        let iterations = 0;

        while (openSet.length > 0 && iterations < maxIterations) {
            iterations++;
            let currentIndex = 0;
            for (let i = 1; i < openSet.length; i++) {
                if (openSet[i].f < openSet[currentIndex].f) currentIndex = i;
            }
            const current = openSet.splice(currentIndex, 1)[0];

            if (current.x === targetX && current.y === targetY) {
                const path = [];
                let temp = current;
                while (temp.parent) {
                    path.push({x: temp.x, y: temp.y});
                    temp = temp.parent;
                }
                return path.reverse();
            }

            closedSet.add(`${current.x},${current.y}`);

            const currentTile = this.getTileAt(current.x, current.y);
            const neighbors = [
                {x: current.x + 1, y: current.y},
                {x: current.x - 1, y: current.y},
                {x: current.x, y: current.y + 1},
                {x: current.x, y: current.y - 1}
            ];

            for (const neighbor of neighbors) {
                if (closedSet.has(`${neighbor.x},${neighbor.y}`)) continue;

                const tile = this.getTileAt(neighbor.x, neighbor.y);
                let isObstacle = false;
                if (tile === this.ROCK || tile === this.CHEST) isObstacle = true;
                if (isWaterObstacle && tile === this.WATER) isObstacle = true;

                if (isObstacle) {
                    if (!(neighbor.x === targetX && neighbor.y === targetY)) {
                        continue;
                    } else {
                        // If target is obstacle, we can't land there unless it's wing
                        // But A* is only for none/boat.
                        continue;
                    }
                }

                let stepCost = 1;
                if (equipment === 'boat') {
                    const isCurrentWater = currentTile === this.WATER;
                    const isNeighborWater = tile === this.WATER;
                    if (isCurrentWater !== isNeighborWater) {
                        stepCost += 2;
                    }
                }

                const g = current.g + stepCost;
                const h = Math.abs(targetX - neighbor.x) + Math.abs(targetY - neighbor.y);
                const f = g + h;

                const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
                if (existing) {
                    if (g < existing.g) {
                        existing.g = g;
                        existing.f = f;
                        existing.parent = current;
                    }
                } else {
                    openSet.push({x: neighbor.x, y: neighbor.y, g, h, f, parent: current});
                }
            }
        }

        return null;
    }

    // ---- World-truth helpers (worldManager handles the guest mirror internally) ----

    private worldLevelCompleted(index: number): boolean {
        return worldManager.isLevelCompleted(index);
    }

    private worldAllLevelsCompleted(upTo: number): boolean {
        return worldManager.allLevelsCompleted(upTo);
    }

    private worldChestOpened(): boolean {
        return worldManager.isChestOpened();
    }

    private worldGeneratedCompleted(x: number, y: number): boolean {
        return worldManager.isGeneratedLevelCompleted(x, y);
    }

    private getInitialTileState(x: number, y: number): number {
        // 1. Level placement (Deterministic but scattered)
        const index = Math.round(x / this.LEVEL_SPACING);
        let isLevelColumn = x % this.LEVEL_SPACING === 0 && x >= 0 && index < MAP_DATA.length;

        // Logic: 1-15 (0-14) always accessible. 16+ (15+) only if 1-15 are completed.
        if (isLevelColumn && index >= 15) {
            if (!this.worldAllLevelsCompleted(14)) {
                isLevelColumn = false;
            }
        }

        const targetY = isLevelColumn ? myRand(index, 777, 0, -4, 4) : 999;

        if (isLevelColumn && y === targetY) {
            return index + 1;
        }

        // Treasure Chest next to Level 16 (index 15)
        const { x: chestX, y: chestY } = this.getChestPos();
        if (x === chestX && y === chestY) {
            return this.CHEST;
        }

        // 1b. Generated level placement (cell-based, beyond handcrafted area)
        const genLevel = this.getGeneratedLevelAt(x, y);
        if (genLevel) {
            if (this.worldGeneratedCompleted(x, y)) {
                return this.DECORATION;
            }
            return this.GENERATED_LEVEL;
        }

        // 2. Dryness Field calculation (Find the actual nearest level)
        const chebyshevDist = this.getDistToNearestLevel(x, y);

        // Get biome parameters for this tile
        const biome = getBiomeAt(x, y, this.getCurrentThemeIndex());

        // 3. Super Large Lake Zones (Rare)
        const lZoneX = Math.floor(x / 24);
        const lZoneY = Math.floor(y / 24);
        const isLargeZone = myRand(lZoneX, lZoneY, 999, 0, 100) < biome.waterLargeZoneChance;

        // 4. Medium Lake Zones (Common)
        const mZoneX = Math.floor(x / 8);
        const mZoneY = Math.floor(y / 8);
        const isMediumZone = myRand(mZoneX, mZoneY, 888, 0, 100) < biome.waterMediumZoneChance;

        // 5. Initialize Water
        let waterProb = 0;
        if (isLargeZone) waterProb = biome.waterFillProb + 3;
        else if (isMediumZone) waterProb = biome.waterFillProb;

        // Apply Dryness Field
        if (chebyshevDist <= 1) {
            waterProb = 0;
        } else if (chebyshevDist === 2) {
            waterProb *= 0.4;
        }

        if (waterProb > 0 && myRand(x, y, 0, 0, 100) < waterProb) {
            return this.WATER;
        }

        // 6. Rocks/Bushes
        let rockProb = biome.rockBaseProb;
        if (chebyshevDist <= 1) rockProb = 0;

        if (myRand(x, y, 1, 0, 100) < rockProb) return this.ROCK;

        return 0;
    }

    /** Check if a generated level node should be placed at (x, y) */
    private getGeneratedLevelAt(x: number, y: number): boolean {
        const cell = this.GENERATED_LEVEL_CELL;
        const cellX = Math.floor(x / cell);
        const cellY = Math.floor(y / cell);

        // Only place generated levels outside the handcrafted level corridor
        const handcraftedMaxX = MAP_DATA.length * this.LEVEL_SPACING + 5;
        const inHandcraftedZone = x >= -3 && x <= handcraftedMaxX && y >= -8 && y <= 8;
        if (inHandcraftedZone) return false;

        // Each cell has a 40% chance of containing a generated level
        if (myRand(cellX, cellY, 555, 0, 100) >= 40) return false;

        // Deterministic position within cell
        const nodeX = cellX * cell + myRand(cellX, cellY, 111, 1, cell - 2);
        const nodeY = cellY * cell + myRand(cellX, cellY, 222, 1, cell - 2);

        return x === nodeX && y === nodeY;
    }

    /** Get Chebyshev distance to nearest level node (handcrafted or generated) */
    private getDistToNearestLevel(x: number, y: number): number {
        // Check nearest handcrafted level
        let minDist = 999;
        const nearestIndex = Math.max(0, Math.min(MAP_DATA.length - 1, Math.round(x / this.LEVEL_SPACING)));
        const levelX = nearestIndex * this.LEVEL_SPACING;
        const levelY = myRand(nearestIndex, 777, 0, -4, 4);
        const dx1 = Math.abs(x - levelX);
        const dy1 = Math.abs(y - levelY);
        minDist = Math.max(dx1, dy1);

        // Check nearest generated level (check surrounding cells)
        const cell = this.GENERATED_LEVEL_CELL;
        const cellX = Math.floor(x / cell);
        const cellY = Math.floor(y / cell);
        for (let cy = cellY - 1; cy <= cellY + 1; cy++) {
            for (let cx = cellX - 1; cx <= cellX + 1; cx++) {
                const handcraftedMaxX2 = MAP_DATA.length * this.LEVEL_SPACING + 5;
                const nodeX = cx * cell + myRand(cx, cy, 111, 1, cell - 2);
                const nodeY = cy * cell + myRand(cx, cy, 222, 1, cell - 2);
                const inHandcrafted = nodeX >= -3 && nodeX <= handcraftedMaxX2 && nodeY >= -8 && nodeY <= 8;
                if (inHandcrafted) continue;
                if (myRand(cx, cy, 555, 0, 100) >= 40) continue;
                const d = Math.max(Math.abs(x - nodeX), Math.abs(y - nodeY));
                if (d < minDist) minDist = d;
            }
        }

        return minDist;
    }

    private getTileAt(x: number, y: number): number {
        const cx = Math.floor(x / this.CHUNK_WIDTH);
        const cy = Math.floor(y / this.CHUNK_HEIGHT);
        const key = `${cx},${cy}`;
        
        let chunk = this.chunks.get(key);
        if (!chunk) {
            chunk = this.generateChunk(cx, cy);
        }
        
        const lx = ((x % this.CHUNK_WIDTH) + this.CHUNK_WIDTH) % this.CHUNK_WIDTH;
        const ly = ((y % this.CHUNK_HEIGHT) + this.CHUNK_HEIGHT) % this.CHUNK_HEIGHT;
        return chunk[ly * this.CHUNK_WIDTH + lx];
    }

    private setTileAt(x: number, y: number, value: number): void {
        const cx = Math.floor(x / this.CHUNK_WIDTH);
        const cy = Math.floor(y / this.CHUNK_HEIGHT);
        const key = `${cx},${cy}`;
        const chunk = this.chunks.get(key);
        if (!chunk) return;
        const lx = ((x % this.CHUNK_WIDTH) + this.CHUNK_WIDTH) % this.CHUNK_WIDTH;
        const ly = ((y % this.CHUNK_HEIGHT) + this.CHUNK_HEIGHT) % this.CHUNK_HEIGHT;
        chunk[ly * this.CHUNK_WIDTH + lx] = value;
    }

    private generateChunk(cx: number, cy: number): Int8Array {
        const fullWidth = this.CHUNK_WIDTH + 2 * this.HALO_SIZE;
        const fullHeight = this.CHUNK_HEIGHT + 2 * this.HALO_SIZE;
        let grid = new Int8Array(fullWidth * fullHeight);
        
        // 1. Initialize with deterministic random
        for (let y = 0; y < fullHeight; y++) {
            for (let x = 0; x < fullWidth; x++) {
                const worldX = cx * this.CHUNK_WIDTH - this.HALO_SIZE + x;
                const worldY = cy * this.CHUNK_HEIGHT - this.HALO_SIZE + y;
                grid[y * fullWidth + x] = this.getInitialTileState(worldX, worldY);
            }
        }
        
        // 2. Run CA iterations
        for (let i = 0; i < this.CA_ITERATIONS; i++) {
            const nextGrid = new Int8Array(grid);
            for (let y = 1; y < fullHeight - 1; y++) {
                for (let x = 1; x < fullWidth - 1; x++) {
                    const val = grid[y * fullWidth + x];
                    if (val > 0 || val === this.CHEST) continue;
                    
                    let waterNeighbors = 0;
                    let rockNeighbors = 0;
                    
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nVal = grid[(y + dy) * fullWidth + (x + dx)];
                            if (nVal === this.WATER) waterNeighbors++;
                            if (nVal === this.ROCK) rockNeighbors++;
                        }
                    }
                    
                    // Water rules: B5/S45678 (Standard organic growth)
                    if (waterNeighbors >= 5) nextGrid[y * fullWidth + x] = this.WATER;
                    else if (waterNeighbors < 4) {
                        if (val === this.WATER) nextGrid[y * fullWidth + x] = 0;
                    }
                    
                    // Rock rules: Keep them simple and scattered
                    if (val === 0 && rockNeighbors >= 5) {
                        nextGrid[y * fullWidth + x] = this.ROCK;
                    } else if (rockNeighbors < 2) {
                        if (val === this.ROCK) nextGrid[y * fullWidth + x] = 0;
                    }
                }
            }
            grid = nextGrid;
        }

        // 3. Apply world structures (post-CA)
        const mapSeed = parseInt(worldManager.getSeed(), 10) || 0;
        const worldMinX = cx * this.CHUNK_WIDTH - this.HALO_SIZE;
        const worldMinY = cy * this.CHUNK_HEIGHT - this.HALO_SIZE;

        applyStructuresToGrid({
            mapSeed,
            chunkX: cx,
            chunkY: cy,
            chunkWidth: this.CHUNK_WIDTH,
            chunkHeight: this.CHUNK_HEIGHT,
            haloSize: this.HALO_SIZE,
            fullWidth,
            fullHeight,
            worldMinX,
            worldMinY,
            tileValues: {
                WATER: this.WATER,
                ROCK: this.ROCK,
                CHEST: this.CHEST,
                GENERATED_LEVEL: this.GENERATED_LEVEL,
                SPECIAL_LEVEL: this.SPECIAL_LEVEL
            }
        }, grid);
        
        // 4. Extract center CHUNK_WIDTH x CHUNK_HEIGHT
        const result = new Int8Array(this.CHUNK_WIDTH * this.CHUNK_HEIGHT);
        for (let y = 0; y < this.CHUNK_HEIGHT; y++) {
            for (let x = 0; x < this.CHUNK_WIDTH; x++) {
                result[y * this.CHUNK_WIDTH + x] = grid[(y + this.HALO_SIZE) * fullWidth + (x + this.HALO_SIZE)];
            }
        }
        
        this.chunks.set(`${cx},${cy}`, result);
        return result;
    }

    private countNeighbors4(x: number, y: number, goal: number): number {
        let cnt = 0;
        const dx = [1, 0, -1, 0];
        const dy = [0, 1, 0, -1];
        for (let i = 0; i < 4; i++) {
            const xx = x + dx[i];
            const yy = y + dy[i];
            if (xx === 0 && yy === 0) continue;
            const get = this.getTileAt(xx, yy);
            if (get === goal) cnt++;
        }
        return cnt;
    }

    private countNeighbors8_dist2(x: number, y: number, goal: number): number {
        let cnt = 0;
        const dx = [2, 0, -2, 0, 1, 1, -1, -1];
        const dy = [0, 2, 0, -2, 1, -1, 1, -1];
        for (let i = 0; i < 8; i++) {
            const xx = x + dx[i];
            const yy = y + dy[i];
            if (xx === 0 && yy === 0) continue;
            const get = this.getTileAt(xx, yy);
            if (get === goal) cnt++;
        }
        return cnt;
    }

    private createUI(container: HTMLElement) {
        this.uiOverlay = document.createElement('div');
        this.uiOverlay.className = 'game-ui-overlay';
        this.uiOverlay.style.position = 'absolute';
        this.uiOverlay.style.top = '0';
        this.uiOverlay.style.left = '0';
        this.uiOverlay.style.width = '100%';
        this.uiOverlay.style.height = '100%';
        this.uiOverlay.style.pointerEvents = 'none';
        container.appendChild(this.uiOverlay);

        // Top Right: Icons
        const topIcons = document.createElement('div');
        topIcons.className = 'ui-top-icons';
        topIcons.style.pointerEvents = 'auto';
        ['theme', 'home', 'settings'].forEach(name => {
            const img = document.createElement('img');
            img.src = `/assets/images/${name}.png`;
            img.onmouseenter = () => img.src = `/assets/images/${name}_clicked.png`;
            img.onmouseleave = () => img.src = `/assets/images/${name}.png`;
            img.onclick = () => {
                if (name === 'theme') showThemeDialog(container);
                else if (name === 'settings') showSettingsDialog(container);
                else if (name === 'home') this.onBack();
            };
            topIcons.appendChild(img);
        });
        this.uiOverlay.appendChild(topIcons);

        // Bottom Left: Items
        const itemBar = document.createElement('div');
        itemBar.className = 'ui-item-bar';
        itemBar.style.pointerEvents = 'auto';
        const currentItems = characterManager.getItemCounts();
        const items = [
            { id: 'hint', img: 'hint.png', count: currentItems.hint },
            { id: 'plus', img: 'plus.png', count: currentItems.plus },
            { id: 'undo', img: 'withdraw.png', count: currentItems.undo }
        ];

        items.forEach(item => {
            const group = document.createElement('div');
            group.className = 'item-group';
            const img = document.createElement('img');
            img.src = `/assets/images/${item.img}`;
            
            const text = document.createElement('div');
            text.innerText = `x${item.count}`;
            group.appendChild(img);
            group.appendChild(text);
            itemBar.appendChild(group);
        });
        this.uiOverlay.appendChild(itemBar);

        // Message element
        this.messageEl = document.createElement('div');
        this.messageEl.style.position = 'absolute';
        this.messageEl.style.color = 'white';
        this.messageEl.style.fontSize = '16px';
        this.messageEl.style.fontFamily = 'Pixel';
        this.messageEl.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
        this.messageEl.style.pointerEvents = 'none';
        this.messageEl.style.opacity = '0';
        this.messageEl.style.transition = 'opacity 0.3s ease';
        this.messageEl.style.zIndex = '100';
        this.uiOverlay.appendChild(this.messageEl);

        this.structureDiscoverEl = document.createElement('div');
        this.structureDiscoverEl.style.position = 'absolute';
        this.structureDiscoverEl.style.left = '50%';
        this.structureDiscoverEl.style.top = '50%';
        this.structureDiscoverEl.style.transform = 'translate(-50%, -50%)';
        this.structureDiscoverEl.style.color = 'white';
        this.structureDiscoverEl.style.fontSize = '42px';
        this.structureDiscoverEl.style.fontFamily = 'Pixel';
        this.structureDiscoverEl.style.textShadow = '2px 2px 0 rgba(0,0,0,0.75)';
        this.structureDiscoverEl.style.pointerEvents = 'none';
        this.structureDiscoverEl.style.opacity = '0';
        this.structureDiscoverEl.style.transition = 'opacity 0.25s ease';
        this.structureDiscoverEl.style.zIndex = '120';
        this.uiOverlay.appendChild(this.structureDiscoverEl);
    }

    private showMessage(text: string, x: number, y: number) {
        if (!this.messageEl) return;
        if (this.messageTimeout) clearTimeout(this.messageTimeout);

        this.messageEl.innerText = text;
        this.messageEl.style.left = `${x}px`;
        this.messageEl.style.top = `${y}px`;
        this.messageEl.style.transform = 'translateX(-50%)';
        this.messageEl.style.opacity = '1';
        this.messageTimeout = setTimeout(() => {
            if (this.messageEl) this.messageEl.style.opacity = '0';
            this.messageTimeout = null;
        }, 2000);
    }

    private hideMessage() {
        if (!this.messageEl || this.messageEl.style.opacity === '0') return;
        this.messageEl.style.opacity = '0';
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
    }

    private checkMessageAutoHide(x: number, y: number) {
        const { x: chestX, y: chestY } = this.getChestPos();

        const dx = Math.abs(x - chestX);
        const dy = Math.abs(y - chestY);

        // If distance > 1.2 (to allow some buffer during movement), hide message
        if (dx > 1.2 || dy > 1.2) {
            this.hideMessage();
        }
    }

    public draw() {
        // Use biome color at viewport center for background fill
        const centerTileX = Math.floor((400 - this.anchorX) / this.nodeWidth);
        const centerTileY = Math.floor((300 - this.anchorY) / this.nodeWidth);
        const centerBiome = getBiomeAt(centerTileX, centerTileY, this.getCurrentThemeIndex());
        this.ctx.fillStyle = `rgb(${centerBiome.baseColor.r}, ${centerBiome.baseColor.g}, ${centerBiome.baseColor.b})`;
        this.ctx.fillRect(0, 0, 800, 600);

        // Calculate visible tile range
        const leftNum = Math.ceil(this.anchorX / this.nodeWidth);
        const rightNum = Math.ceil((800 - this.anchorX) / this.nodeWidth);
        const upNum = Math.ceil(this.anchorY / this.nodeWidth);
        const downNum = Math.ceil((600 - this.anchorY) / this.nodeWidth);

        // 1. Draw grass background first
        for (let dx = -leftNum; dx < rightNum; ++dx) {
            for (let dy = -upNum; dy < downNum; ++dy) {
                this.drawGrass(dx, dy);
            }
        }

        // 2. Draw obstacles and levels
        for (let dx = -leftNum; dx < rightNum; ++dx) {
            for (let dy = -upNum; dy < downNum; ++dy) {
                const val = this.getTileAt(dx, dy);
                if (val === 0) continue;

                const screenX = this.anchorX + dx * this.nodeWidth;
                const screenY = this.anchorY + dy * this.nodeWidth;

                if (val === this.ROCK) {
                    const biome = getBiomeAt(dx, dy, this.getCurrentThemeIndex());
                    const res = myRand(dx * dx, dy * dy, 0, 1, 30);
                    let imgPath: string;
                    if (res < 11) imgPath = biome.bushSprites[0];
                    else if (res < 21) imgPath = biome.bushSprites[1];
                    else imgPath = biome.bushSprites[2];

                    const img = this.images.get(imgPath);
                    if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                } else if (val === this.WATER) {
                    const biome = getBiomeAt(dx, dy, this.getCurrentThemeIndex());
                    const waterColor = this.countNeighbors4(dx, dy, this.WATER) < 4 ? biome.waterColors.deep : (this.countNeighbors8_dist2(dx, dy, this.WATER) < 8 ? biome.waterColors.mid : biome.waterColors.light);
                    this.ctx.fillStyle = waterColor;
                    this.ctx.fillRect(screenX, screenY, this.nodeWidth, this.nodeWidth);

                    // Lily pads (only if biome has lily sprites)
                    if (biome.lilySprites) {
                        if (myRand(dx, dy, 0, 0, 50) < 1) {
                            const img = this.images.get(biome.lilySprites[0]);
                            if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                        } else if (myRand(dx, dy, 10, 0, 50) < 1) {
                            const img = this.images.get(biome.lilySprites[1]);
                            if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                        } else if (myRand(dx, dy, 20, 0, 50) < 1) {
                            const img = this.images.get(biome.lilySprites[2]);
                            if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                        }
                    }
                } else if (val === this.DECORATION) {
                    // Pixel flower for completed generated level (gold petals)
                    const biome = getBiomeAt(dx, dy, this.getCurrentThemeIndex());
                    this.ctx.fillStyle = randColorBiome(dx, dy, biome.baseColor, biome.colorVariation);
                    this.ctx.fillRect(screenX, screenY, this.nodeWidth, this.nodeWidth);
                    
                    const divide = 8;
                    const dsize = this.nodeWidth / divide;
                    const pieceX = screenX + dsize * 3;
                    const pieceY = screenY + dsize * 2;
                    
                    // Shadow
                    this.ctx.fillStyle = `rgb(${Math.floor(biome.baseColor.r * 0.6)}, ${Math.floor(biome.baseColor.g * 0.6)}, ${Math.floor(biome.baseColor.b * 0.6)})`;
                    this.ctx.fillRect(pieceX, pieceY + dsize * 2, dsize, dsize);
                    this.ctx.fillRect(pieceX - dsize, pieceY + dsize, dsize * 3, dsize);
                    
                    // Petals (Cross shape) - gold color for completed levels
                    this.ctx.fillStyle = '#ffd700';
                    this.ctx.fillRect(pieceX - dsize, pieceY, dsize * 3, dsize);
                    this.ctx.fillRect(pieceX, pieceY - dsize, dsize, dsize * 3);
                    
                    // Center - orange
                    this.ctx.fillStyle = '#ff8c00';
                    this.ctx.fillRect(pieceX, pieceY, dsize, dsize);
                } else if (val === this.GENERATED_LEVEL) {
                    // Generated level node - draw with different style
                    const img = this.images.get('/assets/images/level.png');
                    if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);

                    const difficulty = this.getDifficultyAt(dx, dy);
                    this.ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
                    this.ctx.font = "16px Pixel";
                    this.ctx.textAlign = "center";
                    this.ctx.fillText('★'.repeat(difficulty), screenX + this.nodeWidth / 2, screenY + this.nodeWidth / 2 + 5);
                } else if (val === this.SPECIAL_LEVEL) {
                    const img = this.images.get('/assets/images/level.png');
                    if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);

                    this.ctx.fillStyle = 'rgba(20, 20, 20, 0.65)';
                    this.ctx.fillRect(screenX + 5, screenY + 5, this.nodeWidth - 10, this.nodeWidth - 10);

                    this.ctx.fillStyle = 'rgba(255, 80, 80, 0.98)';
                    this.ctx.font = '24px Pixel';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText('特', screenX + this.nodeWidth / 2, screenY + this.nodeWidth / 2 + 8);
                } else if (val > 0) {
                    // Handcrafted level node
                    const img = this.images.get('/assets/images/level.png');
                    if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                    
                    this.ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
                    this.ctx.font = "25px Pixel";
                    this.ctx.textAlign = "center";
                    this.ctx.fillText(val.toString(), screenX + this.nodeWidth / 2, screenY + this.nodeWidth / 2 + 8);
                }
            }
        }

        // 3. Draw Cat
        this.drawCat();
        this.drawPeer();

        // 4. Draw Chest
        this.drawChest();
    }

    private drawChest() {
        const { x: chestX, y: chestY } = this.getChestPos();

        const screenX = this.anchorX + chestX * this.nodeWidth;
        const screenY = this.anchorY + chestY * this.nodeWidth;

        let imgPath = '/assets/images/treasure_closed.png';
        const chestOpened = this.worldChestOpened();

        if (chestOpened) {
            imgPath = '/assets/images/treasure_opened.png';
        } else if (this.isChestOpening) {
            imgPath = '/assets/images/treasure_open.gif';
        }

        if (this.currentChestImgPath !== imgPath) {
            this.currentChestImgPath = imgPath;
            this.chestImg.src = imgPath;
        }

        this.chestImg.style.left = `${screenX}px`;
        this.chestImg.style.top = `${screenY}px`;
        this.chestImg.style.display = 'block';
    }

    private drawCat() {
        const currentX = this.isMoving ? 
            this.moveStartX + (this.moveTargetX - this.moveStartX) * this.moveProgress : 
            this.catX;
        const currentY = this.isMoving ? 
            this.moveStartY + (this.moveTargetY - this.moveStartY) * this.moveProgress : 
            this.catY;

        const screenX = this.anchorX + currentX * this.nodeWidth;
        const screenY = this.anchorY + currentY * this.nodeWidth;
        
        const equipment = characterManager.getEquipment();
        const tileAtCurrent = this.getTileAt(Math.round(currentX), Math.round(currentY));
        const { path, flip } = this.pickCatSprite(equipment, this.catDir, this.isMoving, this.isMouseMoving, tileAtCurrent);

        if (this.currentCatImgPath !== path) {
            this.currentCatImgPath = path;
            this.catImg.src = path;
        }
        this.catImg.style.left = `${screenX}px`;
        this.catImg.style.top = `${screenY}px`;
        this.catImg.style.transform = flip ? 'scaleX(-1)' : 'none';
    }

    private pickCatSprite(equipment: Equipment, dir: Dir, isMoving: boolean, isMouseMoving: boolean, tileAtCurrent: number): { path: string; flip: boolean } {
        let imgPath = '';
        let flip = false;

        if (equipment === 'boat' && tileAtCurrent === this.WATER) {
            if (dir === 'back') imgPath = '/assets/images/player_cat/cat_boat_up.gif';
            else if (dir === 'front') imgPath = '/assets/images/player_cat/cat_boat_down.gif';
            else if (dir === 'left') {
                imgPath = '/assets/images/player_cat/cat_boat_right.gif';
                flip = true;
            }
            else imgPath = '/assets/images/player_cat/cat_boat_right.gif';
        } else if (equipment === 'wing') {
            const isOverObstacle = tileAtCurrent === this.WATER || tileAtCurrent === this.ROCK || tileAtCurrent === this.CHEST;
            if ((isMoving && isMouseMoving) || isOverObstacle) {
                if (dir === 'back') imgPath = '/assets/images/player_cat/cat_fly_up.gif';
                else if (dir === 'front') imgPath = '/assets/images/player_cat/cat_fly_down.gif';
                else if (dir === 'left') {
                    imgPath = '/assets/images/player_cat/cat_fly_right.gif';
                    flip = true;
                }
                else imgPath = '/assets/images/player_cat/cat_fly_right.gif';
            } else if (isMoving) {
                if (dir === 'back') imgPath = '/assets/images/player_cat/cat_run_back.gif';
                else if (dir === 'front') imgPath = '/assets/images/player_cat/cat_run_front.gif';
                else if (dir === 'left') {
                    imgPath = '/assets/images/player_cat/cat_run.gif';
                    flip = true;
                }
                else imgPath = '/assets/images/player_cat/cat_run.gif';
            } else {
                if (dir === 'back') imgPath = '/assets/images/player_cat/cat_stand_back.gif';
                else if (dir === 'front') imgPath = '/assets/images/player_cat/cat_stand_front.gif';
                else if (dir === 'left') {
                    imgPath = '/assets/images/player_cat/cat_stand.gif';
                    flip = true;
                }
                else imgPath = '/assets/images/player_cat/cat_stand.gif';
            }
        } else {
            if (isMoving) {
                if (dir === 'back') imgPath = '/assets/images/player_cat/cat_run_back.gif';
                else if (dir === 'front') imgPath = '/assets/images/player_cat/cat_run_front.gif';
                else if (dir === 'left') {
                    imgPath = '/assets/images/player_cat/cat_run.gif';
                    flip = true;
                }
                else imgPath = '/assets/images/player_cat/cat_run.gif';
            } else {
                if (dir === 'back') imgPath = '/assets/images/player_cat/cat_stand_back.gif';
                else if (dir === 'front') imgPath = '/assets/images/player_cat/cat_stand_front.gif';
                else if (dir === 'left') {
                    imgPath = '/assets/images/player_cat/cat_stand.gif';
                    flip = true;
                }
                else imgPath = '/assets/images/player_cat/cat_stand.gif';
            }
        }
        return { path: imgPath, flip };
    }

    private drawGrass(dx: number, dy: number) {
        const x = this.anchorX + dx * this.nodeWidth;
        const y = this.anchorY + dy * this.nodeWidth;
        const biome = getBiomeAt(dx, dy, this.getCurrentThemeIndex());
        this.ctx.fillStyle = randColorBiome(dx, dy, biome.baseColor, biome.colorVariation);
        this.ctx.fillRect(x, y, this.nodeWidth, this.nodeWidth);

        const divide = 8;
        const dsize = this.nodeWidth / divide;

        // Edge details (jagged grass look)
        for (let i = 0; i < divide; ++i) {
            if (myRand(dx, dy, i, -10, 10) < 0) {
                const neighborBiome = getBiomeAt(dx, dy - 1, this.getCurrentThemeIndex());
                this.ctx.fillStyle = randColorBiome(dx, dy - 1, neighborBiome.baseColor, neighborBiome.colorVariation);
                this.ctx.fillRect(x + i * dsize, y, dsize, dsize);
            }
        }

        // Grass pieces (vertical blades)
        for (let i = 1; i <= 3; ++i) {
            if (myRand(dx, dy, i, 0, 1) === 0) {
                const pieceX = x + myRand(dx, dy, i, 0, divide - 2) * dsize;
                const pieceY = y + myRand(dx, dy, -i, 0, divide - 1) * dsize;
                const neighborBiome = getBiomeAt(dx, dy - 1, this.getCurrentThemeIndex());
                this.ctx.fillStyle = randColorBiome(dx, dy - 1, neighborBiome.baseColor, neighborBiome.colorVariation);
                this.ctx.fillRect(pieceX, pieceY, dsize, dsize * myRand(dx, dy, i, 2, 5));
            }
        }

        // Flowers
        if (myRand(dx, dy, 0, 0, biome.flowerChance - 1) === 0) {
            const pieceX = x + myRand(dx, dy, 1, 1, divide - 2) * dsize;
            const pieceY = y + myRand(dx, dy, -1, 1, divide - 3) * dsize;

            // Shadow from biome base color
            this.ctx.fillStyle = `rgb(${Math.floor(biome.baseColor.r * 0.6)}, ${Math.floor(biome.baseColor.g * 0.6)}, ${Math.floor(biome.baseColor.b * 0.6)})`;
            this.ctx.fillRect(pieceX, pieceY + dsize * 2, dsize, dsize);
            this.ctx.fillRect(pieceX - dsize, pieceY + dsize, dsize * 3, dsize);

            // Petals (Cross shape)
            this.ctx.fillStyle = biome.flowerPetalColor;
            this.ctx.fillRect(pieceX - dsize, pieceY, dsize * 3, dsize);
            this.ctx.fillRect(pieceX, pieceY - dsize, dsize, dsize * 3);

            // Center
            this.ctx.fillStyle = biome.flowerCenterColor;
            this.ctx.fillRect(pieceX, pieceY, dsize, dsize);
        }
    }

    public destroy() {
        if (this.session) {
            this.session.onPeerWorldUpdate = () => {};
            this.session.onReadyPrompt = () => {};
            this.session.onReadyCancelled = () => {};
        }
        this.closeReadyDialog();
        window.removeEventListener('keydown', this.boundKeyDown);
        themeManager.removeListener(this.themeListener);
        if (this.structureDiscoverTimeout) {
            clearTimeout(this.structureDiscoverTimeout);
            this.structureDiscoverTimeout = null;
        }
        if (this.uiOverlay) {
            this.uiOverlay.remove();
        }
        this.catImg.remove();
        this.peerImg.remove();
        this.peerNameEl.remove();
        this.chestImg.remove();
        this.equipmentImg.remove();
        this.fishCountEl.remove();
        this.canvas.remove();
    }
}
