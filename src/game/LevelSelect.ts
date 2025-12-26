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
    private map: Map<string, number> = new Map();
    private anchorX: number = 0;
    private anchorY: number = 0;
    private nodeWidth: number = 40;
    private images: Map<string, HTMLImageElement> = new Map();
    private themeListener: (theme: any) => void;
    
    private WATER = -3;
    private ROCK = -2;
    private CHEST = -1;
    
    private deepBlue = "#4c6e78";
    private blue = "#5d9798";
    private lightBlue = "#77ad9d";

    private onLevelSelect: (levelIndex: number) => void;
    private onBack: () => void;
    private rng: { next: () => number };
    private boundKeyDown: (e: KeyboardEvent) => void;

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
        this.anchorX = 800 / 2 - 100;
        this.anchorY = (600 - this.nodeWidth) / 2;

        // Initialize seeded RNG
        const seed = parseInt(settingsManager.currentSettings.mapSeed) || 0;
        let s = seed;
        this.rng = {
            next: () => {
                s = (s * 1664525 + 1013904223) % 4294967296;
                return s / 4294967296;
            }
        };

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

        // Add click listener for level selection (temporary until cat is implemented)
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            for (const [key, val] of this.map.entries()) {
                if (val > 0) {
                    const [x, y] = key.split(',').map(Number);
                    const screenX = this.anchorX + x * this.nodeWidth;
                    const screenY = this.anchorY + y * this.nodeWidth;
                    
                    if (mouseX >= screenX && mouseX <= screenX + this.nodeWidth &&
                        mouseY >= screenY && mouseY <= screenY + this.nodeWidth) {
                        this.onLevelSelect(val - 1);
                        break;
                    }
                }
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
        this.generateMap();
        this.draw();
    }

    private generateMap() {
        this.map.clear();
        
        // Add levels (matching Java's add_levels logic)
        // Java uses (index % 5) * 3 for x and random(0, 4) for y
        const Y_RANGE = 4;
        for (let i = 0; i < Math.min(MAP_DATA.length, 5); i++) {
            const x = (i % 5) * 3; 
            const y = Math.floor(this.rng.next() * Y_RANGE);
            this.map.set(`${x},${y}`, i + 1);
        }

        // Obstacles
        const left_x = -Math.floor(this.anchorX / this.nodeWidth);
        const right_x = Math.floor((800 - this.anchorX) / this.nodeWidth);
        const up_y = -Math.floor(this.anchorY / this.nodeWidth);
        const down_y = Math.floor((600 - this.anchorY) / this.nodeWidth);

        this.generateObstacles(left_x - 1, up_y - 1, right_x - 1, down_y - 1, 20);
    }

    private generateObstacles(begin_x: number, begin_y: number, end_x: number, end_y: number, times: number) {
        const WATER_COUNT = 70;
        const ROCK_COUNT = 25;

        // Initial random placement
        for (let i = 0; i < WATER_COUNT; i++) {
            const x = Math.floor(this.rng.next() * (end_x - begin_x)) + begin_x;
            const y = Math.floor(this.rng.next() * (end_y - begin_y)) + begin_y;
            if (this.map.has(`${x},${y}`)) continue;
            this.map.set(`${x},${y}`, this.WATER);
        }
        for (let i = 0; i < ROCK_COUNT; i++) {
            const x = Math.floor(this.rng.next() * (end_x - begin_x)) + begin_x;
            const y = Math.floor(this.rng.next() * (end_y - begin_y)) + begin_y;
            if (this.map.has(`${x},${y}`)) continue;
            this.map.set(`${x},${y}`, this.ROCK);
        }

        // Cellular automata smoothing
        while (times-- > 0) {
            for (let xx = begin_x; xx < end_x; xx++) {
                for (let yy = begin_y; yy < end_y; yy++) {
                    const key = `${xx},${yy}`;
                    const val = this.map.get(key) || 0;
                    if (val === this.CHEST || val > 0) continue;

                    const cnt_water = this.countNeighbors(xx, yy, this.WATER);
                    const cnt_rock = this.countNeighbors(xx, yy, this.ROCK);

                    if (cnt_rock < 0 || cnt_water < 0) {
                        this.map.delete(key);
                        continue;
                    }

                    if (cnt_water <= 1 && val === this.WATER) {
                        this.map.delete(key);
                    }

                    if (times >= 2) {
                        if (cnt_water >= 3 && this.rng.next() < 0.3) {
                            this.map.set(key, this.WATER);
                        }
                        if (cnt_rock >= 5 && this.rng.next() < 0.7) {
                            this.map.set(key, this.ROCK);
                        }
                    }
                }
            }
        }
    }

    private countNeighbors(x: number, y: number, goal: number): number {
        let cnt = 0;
        const dx = [1, 0, -1, 0, 1, 1, -1, -1];
        const dy = [0, 1, 0, -1, 1, -1, 1, -1];
        for (let i = 0; i < 8; i++) {
            const xx = x + dx[i];
            const yy = y + dy[i];
            if (xx === 0 && yy === 0) return -1;
            const get = this.map.get(`${xx},${yy}`) || 0;
            if (get === goal) cnt++;
            if (get === this.CHEST || get > 0) return -1;
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
            if (xx === 0 && yy === 0) return -1;
            const get = this.map.get(`${xx},${yy}`) || 0;
            if (get === goal) cnt++;
            if (get === this.CHEST || get > 0) return -1;
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
            if (xx === 0 && yy === 0) return -1;
            const get = this.map.get(`${xx},${yy}`) || 0;
            if (get === goal) cnt++;
            if (get === this.CHEST || get > 0) return -1;
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

        // Draw grass background
        const leftNum = Math.ceil(this.anchorX / this.nodeWidth);
        const rightNum = Math.ceil((800 - this.anchorX) / this.nodeWidth);
        const upNum = Math.ceil(this.anchorY / this.nodeWidth);
        const downNum = Math.ceil((600 - this.anchorY) / this.nodeWidth);

        for (let dx = -leftNum; dx < rightNum; ++dx) {
            for (let dy = -upNum; dy < downNum; ++dy) {
                this.drawGrass(dx, dy);
            }
        }

        // Draw obstacles
        for (const [key, val] of this.map.entries()) {
            const [x, y] = key.split(',').map(Number);
            const screenX = this.anchorX + x * this.nodeWidth;
            const screenY = this.anchorY + y * this.nodeWidth;

            if (val === this.ROCK) {
                const res = myRand(x * x, y * y, 0, 1, 30);
                let imgPath = '/assets/images/bush/Snow_bush1.png';
                if (res < 11) imgPath = '/assets/images/bush/Snow_bush1.png';
                else if (res < 21) imgPath = '/assets/images/bush/Snow_bush2.png';
                else imgPath = '/assets/images/bush/Snow_bush3.png';
                
                const img = this.images.get(imgPath);
                if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
            } else if (val === this.WATER) {
                const waterColor = this.countNeighbors4(x, y, this.WATER) < 4 ? this.deepBlue : (this.countNeighbors8_dist2(x, y, this.WATER) < 8 ? this.blue : this.lightBlue);
                this.ctx.fillStyle = waterColor;
                this.ctx.fillRect(screenX, screenY, this.nodeWidth, this.nodeWidth);

                // Lily pads
                if (myRand(x, y, 0, 0, 50) < 1) {
                    const img = this.images.get('/assets/images/bush/lily1.png');
                    if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                } else if (myRand(x, y, 10, 0, 50) < 1) {
                    const img = this.images.get('/assets/images/bush/lily2.png');
                    if (img) this.ctx.drawImage(img, screenX, screenY, this.nodeWidth, this.nodeWidth);
                } else if (myRand(x, y, 20, 0, 50) < 1) {
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
