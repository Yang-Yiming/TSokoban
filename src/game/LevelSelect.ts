import { myRand, randColor } from '../utils';
import { MAP_DATA } from './mapData';
import { showThemeDialog } from '../ui/themeDialog';
import { showSettingsDialog } from '../ui/settingsDialog';
import { themeManager } from '../theme';
import { progressManager } from '../progress';
import type { Equipment } from './types';

export class LevelSelect {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private catImg: HTMLImageElement;
    private chestImg: HTMLImageElement;
    private equipmentImg: HTMLImageElement;
    private currentCatImgPath: string = '';
    private currentChestImgPath: string = '';
    private isChestOpening: boolean = false;
    private uiOverlay: HTMLElement | null = null;
    private messageEl: HTMLElement | null = null;
    private messageTimeout: any = null;
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
    private readonly LEVEL_SPACING = 6;
    
    private deepBlue = "#4c6e78";
    private blue = "#5d9798";
    private lightBlue = "#77ad9d";

    private onLevelSelect: (levelIndex: number) => void;
    private onBack: () => void;
    private boundKeyDown: (e: KeyboardEvent) => void;

    private isDragging = false;
    private lastMouseX = 0;
    private lastMouseY = 0;
    private mouseDownX = 0;
    private mouseDownY = 0;

    constructor(container: HTMLElement, onLevelSelect: (levelIndex: number) => void, onBack: () => void, initialLevelIndex: number = 0) {
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
            const current = progressManager.getEquipment();
            const next: Equipment = current === 'none' ? 'boat' : (current === 'boat' ? 'wing' : 'none');
            progressManager.setEquipment(next);
            this.updateEquipmentUI();
            this.draw();
        };
        container.appendChild(this.equipmentImg);
        
        this.onLevelSelect = onLevelSelect;
        this.onBack = onBack;
        
        // Initial cat position
        this.catX = initialLevelIndex * this.LEVEL_SPACING;
        this.catY = myRand(initialLevelIndex, 777, 0, -4, 4);
        
        this.anchorX = 800 / 2 - this.catX * this.nodeWidth - this.nodeWidth / 2;
        this.anchorY = 600 / 2 - this.catY * this.nodeWidth - this.nodeWidth / 2;

        this.boundKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.onBack();
            }
            
            const key = e.key.toLowerCase();
            const isWASD = ['w', 'a', 's', 'd'].includes(key);

            if (isWASD && this.isMoving && this.movePath.length > 0) {
                // Interrupt pathfinding move
                this.movePath = [];
                // We let the current tile move finish, or we could snap it.
                // Snapping might be jarring, so let's just clear the path.
            }

            if (this.isMoving) return;

            let dx = 0;
            let dy = 0;
            let newDir: typeof this.catDir = this.catDir;
            
            if (key === 'w') { dy = -1; newDir = 'back'; }
            else if (key === 's') { dy = 1; newDir = 'front'; }
            else if (key === 'a') { dx = -1; newDir = 'left'; }
            else if (key === 'd') { dx = 1; newDir = 'right'; }
            else if (e.key === 'Enter') {
                const val = this.getTileAt(this.catX, this.catY);
                if (val > 0) this.onLevelSelect(val - 1);
                return;
            }

            if (dx !== 0 || dy !== 0) {
                this.catDir = newDir;
                const targetX = this.catX + dx;
                const targetY = this.catY + dy;
                const tile = this.getTileAt(targetX, targetY);
                
                const equipment = progressManager.getEquipment();
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
            if (this.isMoving) return;
            
            // If moved more than 10px, it's a drag, not a click
            const dragDist = Math.sqrt(Math.pow(e.clientX - this.mouseDownX, 2) + Math.pow(e.clientY - this.mouseDownY, 2));
            if (dragDist > 10) return;

            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const tileX = Math.floor((mouseX - this.anchorX) / this.nodeWidth);
            const tileY = Math.floor((mouseY - this.anchorY) / this.nodeWidth);
            
            if (tileX === this.catX && tileY === this.catY) {
                const val = this.getTileAt(tileX, tileY);
                if (val > 0) this.onLevelSelect(val - 1);
                return;
            }

            const equipment = progressManager.getEquipment();

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

        this.updateCamera();
        this.draw();
        requestAnimationFrame(this.animate.bind(this));
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
            const level16Completed = progressManager.isLevelCompleted(15);
            const chestOpened = progressManager.isChestOpened();

            if (!chestOpened && !this.isChestOpening) {
                if (level16Completed) {
                    // Start opening animation
                    this.isChestOpening = true;
                    // Force a source reset to ensure gif plays from start
                    this.currentChestImgPath = ''; 
                    this.draw(); 
                    setTimeout(() => {
                        progressManager.openChest();
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
            '/assets/images/bush/Snow_bush1.png',
            '/assets/images/bush/Snow_bush2.png',
            '/assets/images/bush/Snow_bush3.png',
            '/assets/images/bush/lily1.png',
            '/assets/images/bush/lily2.png',
            '/assets/images/bush/lily3.png',
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
        this.checkChestInteraction();
        this.updateEquipmentUI();
        this.draw();
    }

    private updateEquipmentUI() {
        const equipment = progressManager.getEquipment();
        this.equipmentImg.src = `/assets/images/${equipment}.png`;
        this.equipmentImg.style.opacity = equipment === 'none' ? '0.6' : '1';
    }

    private findPath(startX: number, startY: number, targetX: number, targetY: number): {x: number, y: number}[] | null {
        const equipment = progressManager.getEquipment();
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

    private getInitialTileState(x: number, y: number): number {
        // 1. Level placement (Deterministic but scattered)
        const index = Math.round(x / this.LEVEL_SPACING);
        let isLevelColumn = x % this.LEVEL_SPACING === 0 && x >= 0 && index < MAP_DATA.length;
        
        // Logic: 1-15 (0-14) always accessible. 16+ (15+) only if 1-15 are completed.
        if (isLevelColumn && index >= 15) {
            if (!progressManager.allLevelsCompleted(14)) {
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

        // 2. Dryness Field calculation (Find the actual nearest level)
        const nearestIndex = Math.max(0, Math.min(MAP_DATA.length - 1, Math.round(x / this.LEVEL_SPACING)));
        const levelX = nearestIndex * this.LEVEL_SPACING;
        const levelY = myRand(nearestIndex, 777, 0, -4, 4);
        
        const dx = Math.abs(x - levelX);
        const dy = Math.abs(y - levelY);
        const chebyshevDist = Math.max(dx, dy);

        // 3. Super Large Lake Zones (Rare)
        const lZoneX = Math.floor(x / 24);
        const lZoneY = Math.floor(y / 24);
        const isLargeZone = myRand(lZoneX, lZoneY, 999, 0, 100) < 8;

        // 4. Medium Lake Zones (Common)
        const mZoneX = Math.floor(x / 8);
        const mZoneY = Math.floor(y / 8);
        const isMediumZone = myRand(mZoneX, mZoneY, 888, 0, 100) < 45;

        // 5. Initialize Water
        let waterProb = 0;
        if (isLargeZone) waterProb = 58;
        else if (isMediumZone) waterProb = 53;

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
        let rockProb = 10;
        if (chebyshevDist <= 1) rockProb = 0; 
        
        if (myRand(x, y, 1, 0, 100) < rockProb) return this.ROCK;
        
        return 0;
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
        
        // 3. Extract center CHUNK_WIDTH x CHUNK_HEIGHT
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
        const currentItems = progressManager.getItemCounts();
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
        this.ctx.fillStyle = themeManager.currentTheme.cssColor;
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
                    const res = myRand(dx * dx, dy * dy, 0, 1, 30);
                    let imgPath = '/assets/images/bush/Snow_bush1.png';
                    if (res < 11) imgPath = '/assets/images/bush/Snow_bush1.png';
                    else if (res < 21) imgPath = '/assets/images/bush/Snow_bush2.png';
                    else imgPath = '/assets/images/bush/Snow_bush3.png';
                    
                    const img = this.images.get(imgPath);
                    if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                } else if (val === this.WATER) {
                    const waterColor = this.countNeighbors4(dx, dy, this.WATER) < 4 ? this.deepBlue : (this.countNeighbors8_dist2(dx, dy, this.WATER) < 8 ? this.blue : this.lightBlue);
                    this.ctx.fillStyle = waterColor;
                    this.ctx.fillRect(screenX, screenY, this.nodeWidth, this.nodeWidth);

                    // Lily pads
                    if (myRand(dx, dy, 0, 0, 50) < 1) {
                        const img = this.images.get('/assets/images/bush/lily1.png');
                        if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                    } else if (myRand(dx, dy, 10, 0, 50) < 1) {
                        const img = this.images.get('/assets/images/bush/lily2.png');
                        if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                    } else if (myRand(dx, dy, 20, 0, 50) < 1) {
                        const img = this.images.get('/assets/images/bush/lily3.png');
                        if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                    }
                } else if (val > 0) {
                    // Level node
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

        // 4. Draw Chest
        this.drawChest();
    }

    private drawChest() {
        const { x: chestX, y: chestY } = this.getChestPos();

        const screenX = this.anchorX + chestX * this.nodeWidth;
        const screenY = this.anchorY + chestY * this.nodeWidth;

        let imgPath = '/assets/images/treasure_closed.png';
        const chestOpened = progressManager.isChestOpened();

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
        
        let imgPath = '';
        let flip = false;
        const equipment = progressManager.getEquipment();
        const tileAtCurrent = this.getTileAt(Math.round(currentX), Math.round(currentY));

        if (equipment === 'boat' && tileAtCurrent === this.WATER) {
            if (this.catDir === 'back') imgPath = '/assets/images/player_cat/cat_boat_up.gif';
            else if (this.catDir === 'front') imgPath = '/assets/images/player_cat/cat_boat_down.gif';
            else if (this.catDir === 'left') {
                imgPath = '/assets/images/player_cat/cat_boat_right.gif';
                flip = true;
            }
            else if (this.catDir === 'right') imgPath = '/assets/images/player_cat/cat_boat_right.gif';
        } else if (equipment === 'wing') {
            const isOverObstacle = tileAtCurrent === this.WATER || tileAtCurrent === this.ROCK || tileAtCurrent === this.CHEST;
            if ((this.isMoving && this.isMouseMoving) || isOverObstacle) {
                if (this.catDir === 'back') imgPath = '/assets/images/player_cat/cat_fly_up.gif';
                else if (this.catDir === 'front') imgPath = '/assets/images/player_cat/cat_fly_down.gif';
                else if (this.catDir === 'left') {
                    imgPath = '/assets/images/player_cat/cat_fly_right.gif';
                    flip = true;
                }
                else if (this.catDir === 'right') imgPath = '/assets/images/player_cat/cat_fly_right.gif';
            } else {
                // Normal run/stand on land or keyboard move
                if (this.isMoving) {
                    if (this.catDir === 'back') imgPath = '/assets/images/player_cat/cat_run_back.gif';
                    else if (this.catDir === 'front') imgPath = '/assets/images/player_cat/cat_run_front.gif';
                    else if (this.catDir === 'left') {
                        imgPath = '/assets/images/player_cat/cat_run.gif';
                        flip = true;
                    }
                    else if (this.catDir === 'right') imgPath = '/assets/images/player_cat/cat_run.gif';
                } else {
                    if (this.catDir === 'back') imgPath = '/assets/images/player_cat/cat_stand_back.gif';
                    else if (this.catDir === 'front') imgPath = '/assets/images/player_cat/cat_stand_front.gif';
                    else if (this.catDir === 'left') {
                        imgPath = '/assets/images/player_cat/cat_stand.gif';
                        flip = true;
                    }
                    else if (this.catDir === 'right') imgPath = '/assets/images/player_cat/cat_stand.gif';
                }
            }
        } else {
            if (this.isMoving) {
                if (this.catDir === 'back') imgPath = '/assets/images/player_cat/cat_run_back.gif';
                else if (this.catDir === 'front') imgPath = '/assets/images/player_cat/cat_run_front.gif';
                else if (this.catDir === 'left') {
                    imgPath = '/assets/images/player_cat/cat_run.gif';
                    flip = true;
                }
                else if (this.catDir === 'right') imgPath = '/assets/images/player_cat/cat_run.gif';
            } else {
                if (this.catDir === 'back') imgPath = '/assets/images/player_cat/cat_stand_back.gif';
                else if (this.catDir === 'front') imgPath = '/assets/images/player_cat/cat_stand_front.gif';
                else if (this.catDir === 'left') {
                    imgPath = '/assets/images/player_cat/cat_stand.gif';
                    flip = true;
                }
                else if (this.catDir === 'right') imgPath = '/assets/images/player_cat/cat_stand.gif';
            }
        }

        if (this.currentCatImgPath !== imgPath) {
            this.currentCatImgPath = imgPath;
            this.catImg.src = imgPath;
        }
        this.catImg.style.left = `${screenX}px`;
        this.catImg.style.top = `${screenY}px`;
        this.catImg.style.transform = flip ? 'scaleX(-1)' : 'none';
    }

    private drawGrass(dx: number, dy: number) {
        const x = this.anchorX + dx * this.nodeWidth;
        const y = this.anchorY + dy * this.nodeWidth;
        this.ctx.fillStyle = randColor(dx, dy);
        this.ctx.fillRect(x, y, this.nodeWidth, this.nodeWidth);
        
        const divide = 8;
        const dsize = this.nodeWidth / divide;
        
        // Edge details (jagged grass look)
        for (let i = 0; i < divide; ++i) {
            if (myRand(dx, dy, i, -10, 10) < 0) {
                this.ctx.fillStyle = randColor(dx, dy - 1);
                this.ctx.fillRect(x + i * dsize, y, dsize, dsize);
            }
        }

        // Grass pieces (vertical blades)
        for (let i = 1; i <= 3; ++i) {
            if (myRand(dx, dy, i, 0, 1) === 0) {
                const pieceX = x + myRand(dx, dy, i, 0, divide - 2) * dsize;
                const pieceY = y + myRand(dx, dy, -i, 0, divide - 1) * dsize;
                this.ctx.fillStyle = randColor(dx, dy - 1);
                this.ctx.fillRect(pieceX, pieceY, dsize, dsize * myRand(dx, dy, i, 2, 5));
            }
        }

        // Flowers (matching Java version's "花片片")
        if (myRand(dx, dy, 0, 0, 5) === 0) {
            const pieceX = x + myRand(dx, dy, 1, 1, divide - 2) * dsize;
            const pieceY = y + myRand(dx, dy, -1, 1, divide - 3) * dsize;
            
            // Dark green shadow
            const baseColor = themeManager.currentTheme.color;
            this.ctx.fillStyle = `rgb(${Math.floor(baseColor.r * 0.6)}, ${Math.floor(baseColor.g * 0.6)}, ${Math.floor(baseColor.b * 0.6)})`;
            this.ctx.fillRect(pieceX, pieceY + dsize * 2, dsize, dsize);
            this.ctx.fillRect(pieceX - dsize, pieceY + dsize, dsize * 3, dsize);

            // White petals (Cross shape)
            this.ctx.fillStyle = "white";
            this.ctx.fillRect(pieceX - dsize, pieceY, dsize * 3, dsize);
            this.ctx.fillRect(pieceX, pieceY - dsize, dsize, dsize * 3);

            // Yellow center
            this.ctx.fillStyle = "#f0c864";
            this.ctx.fillRect(pieceX, pieceY, dsize, dsize);
        }
    }

    public destroy() {
        window.removeEventListener('keydown', this.boundKeyDown);
        themeManager.removeListener(this.themeListener);
        if (this.uiOverlay) {
            this.uiOverlay.remove();
        }
        this.catImg.remove();
        this.chestImg.remove();
        this.canvas.remove();
    }
}
