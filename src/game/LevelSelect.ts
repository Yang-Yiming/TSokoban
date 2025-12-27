import { myRand, randColor } from '../utils';
import { settingsManager } from '../settings';
import { MAP_DATA } from './mapData';
import { showThemeDialog } from '../ui/themeDialog';
import { showSettingsDialog } from '../ui/settingsDialog';
import { themeManager } from '../theme';

export class LevelSelect {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private uiOverlay: HTMLElement | null = null;
    private chunks: Map<string, Int8Array> = new Map();
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
    
    private deepBlue = "#4c6e78";
    private blue = "#5d9798";
    private lightBlue = "#77ad9d";

    private onLevelSelect: (levelIndex: number) => void;
    private onBack: () => void;
    private boundKeyDown: (e: KeyboardEvent) => void;

    private isDragging = false;
    private lastMouseX = 0;
    private lastMouseY = 0;

    constructor(container: HTMLElement, onLevelSelect: (levelIndex: number) => void, onBack: () => void) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 800;
        this.canvas.height = 600;
        this.canvas.style.display = 'block';
        this.canvas.style.imageRendering = 'pixelated';
        this.ctx = this.canvas.getContext('2d')!;
        this.ctx.imageSmoothingEnabled = false;
        container.appendChild(this.canvas);
        
        this.onLevelSelect = onLevelSelect;
        this.onBack = onBack;
        this.anchorX = 800 / 2;
        this.anchorY = 600 / 2;

        this.boundKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.onBack();
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
        });

        // Dragging listeners
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                this.anchorX += dx;
                this.anchorY += dy;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                this.draw();
            }
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        // Add click listener for level selection
        this.canvas.addEventListener('click', (e) => {
            if (Math.abs(e.clientX - this.lastMouseX) > 5 || Math.abs(e.clientY - this.lastMouseY) > 5) {
                // It was a drag, not a click
                return;
            }
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Calculate which tile was clicked
            const tileX = Math.floor((mouseX - this.anchorX) / this.nodeWidth);
            const tileY = Math.floor((mouseY - this.anchorY) / this.nodeWidth);
            
            const val = this.getTileAt(tileX, tileY);
            if (val > 0) {
                this.onLevelSelect(val - 1);
            }
        });
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
            '/assets/images/item/cloud.png'
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
        this.draw();
    }

    private getInitialTileState(x: number, y: number): number {
        // 1. Level placement (Deterministic but scattered)
        const levelSpacing = 10; 
        const index = Math.round(x / levelSpacing);
        const isLevelColumn = x % levelSpacing === 0 && x >= 0 && index < MAP_DATA.length;
        const targetY = isLevelColumn ? myRand(index, 777, 0, -4, 4) : 999;
        
        if (isLevelColumn && y === targetY) {
            return index + 1;
        }

        // 2. Dryness Field calculation (Find the actual nearest level)
        const nearestIndex = Math.max(0, Math.min(MAP_DATA.length - 1, Math.round(x / levelSpacing)));
        const levelX = nearestIndex * levelSpacing;
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

    private countNeighbors(x: number, y: number, goal: number): number {
        let cnt = 0;
        const dx = [1, 0, -1, 0, 1, 1, -1, -1];
        const dy = [0, 1, 0, -1, 1, -1, 1, -1];
        for (let i = 0; i < 8; i++) {
            const xx = x + dx[i];
            const yy = y + dy[i];
            if (xx === 0 && yy === 0) continue;
            const get = this.getTileAt(xx, yy);
            if (get === goal) cnt++;
        }
        return cnt;
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
        const items = [
            { id: 'hint', img: 'hint.png', count: 3 },
            { id: 'plus', img: 'plus.png', count: 3 },
            { id: 'undo', img: 'withdraw.png', count: 3 }
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
        this.canvas.remove();
    }
}
