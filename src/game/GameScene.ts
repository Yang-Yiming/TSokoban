import { SokobanMap } from './SokobanMap';
import { TILE_MASK } from './types';
import { myRand } from '../utils';
import { themeManager } from '../theme';

export interface CatRenderState {
    orientation: number,
    isMoving: boolean,
    progress: number,
    moveDir: { x: number, y: number },
    pushedBox: { x: number, y: number } | null
    /** Peer only: tile the peer cat stands on (local player's tile comes from the map). */
    tileX?: number,
    tileY?: number,
}

export class GameScene {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private topCanvas: HTMLCanvasElement;
    private topCtx: CanvasRenderingContext2D;
    private playerImg: HTMLImageElement;
    private peerImg: HTMLImageElement;
    private tileSize: number = 55;
    private anchorX: number = 0;
    private anchorY: number = 0;
    private images: Map<string, HTMLImageElement> = new Map();
    private isDragging: boolean = false;
    private lastMouseX: number = 0;
    private lastMouseY: number = 0;
    private grassTimeId: number = 0;
    private glowProgress: number = 0;
    private isCameraFollow: boolean = true;
    private cameraInterval: any = null;
    private animationInterval: any = null;
    private boundMouseMove: any;
    private boundMouseUp: any;
    private boundResize: any;
    private currentMap: SokobanMap | null = null;
    private themeListener: (theme: any) => void;

    constructor(container: HTMLElement) {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d')!;
        
        this.topCanvas = document.createElement('canvas');
        this.topCtx = this.topCanvas.getContext('2d')!;
        
        this.playerImg = document.createElement('img');
        this.playerImg.style.position = 'absolute';
        this.playerImg.style.pointerEvents = 'none';
        this.playerImg.style.imageRendering = 'pixelated';
        this.playerImg.style.display = 'none';
        this.playerImg.style.zIndex = '1';

        this.peerImg = document.createElement('img');
        this.peerImg.style.position = 'absolute';
        this.peerImg.style.pointerEvents = 'none';
        this.peerImg.style.imageRendering = 'pixelated';
        this.peerImg.style.display = 'none';
        this.peerImg.style.zIndex = '1';

        this.canvas.style.position = 'absolute';
        this.canvas.style.zIndex = '0';
        
        this.topCanvas.style.position = 'absolute';
        this.topCanvas.style.pointerEvents = 'none';
        this.topCanvas.style.zIndex = '2';

        container.appendChild(this.canvas);
        container.appendChild(this.playerImg);
        container.appendChild(this.peerImg);
        container.appendChild(this.topCanvas);

        this.resize(container);
        this.boundResize = () => this.resize(container);
        window.addEventListener('resize', this.boundResize);
        this.setupDragging();
        this.loadImages();
        
        this.themeListener = () => {
            if (this.currentMap) {
                this.render(this.currentMap);
            }
        };
        themeManager.addListener(this.themeListener);

        // Animation loop for grass and glow
        this.animationInterval = setInterval(() => {
            this.grassTimeId = (this.grassTimeId + 1) % 64;
            this.glowProgress = (this.glowProgress + 0.05) % 1;
        }, 80);
    }

    private async loadImages() {
        const imagePaths = [
            '/assets/images/wall/wall.png',
            '/assets/images/wall/wall_d.png',
            '/assets/images/wall/wall_l.png',
            '/assets/images/wall/wall_ld.png',
            '/assets/images/wall/wall_m.png',
            '/assets/images/wall/wall_md.png',
            '/assets/images/wall/wall_r.png',
            '/assets/images/wall/wall_rd.png',
            '/assets/images/box.png',
            '/assets/images/goal.png',
            '/assets/images/player_cat/cat_stand_front.gif',
            '/assets/images/player_cat/cat_stand_back.gif',
            '/assets/images/player_cat/cat_stand.gif',
            '/assets/images/player_cat/cat_run_front.gif',
            '/assets/images/player_cat/cat_run_back.gif',
            '/assets/images/player_cat/cat_run.gif'
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

    private resize(container: HTMLElement) {
        const w = container.clientWidth || 800;
        const h = container.clientHeight || 600;
        
        this.canvas.width = w;
        this.canvas.height = h;
        this.ctx.imageSmoothingEnabled = false;

        this.topCanvas.width = w;
        this.topCanvas.height = h;
        this.topCtx.imageSmoothingEnabled = false;
    }

    private setupDragging() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            
            // Interrupt camera follow when user starts dragging
            if (this.cameraInterval) {
                clearInterval(this.cameraInterval);
                this.cameraInterval = null;
            }
        });

        this.boundMouseMove = (e: MouseEvent) => {
            if (this.isDragging) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                this.anchorX += dx;
                this.anchorY += dy;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
            }
        };

        this.boundMouseUp = () => {
            this.isDragging = false;
        };

        window.addEventListener('mousemove', this.boundMouseMove);
        window.addEventListener('mouseup', this.boundMouseUp);
    }

    public setInitialAnchor(map: SokobanMap) {
        // Ensure canvas size is correct before calculating anchors
        const container = this.canvas.parentElement;
        if (container) {
            this.canvas.width = container.clientWidth || 800;
            this.canvas.height = container.clientHeight || 600;
        }

        this.tileSize = Math.floor(Math.min(
            this.canvas.width / (map.getWidth() + 4),
            this.canvas.height / (map.getHeight() + 4)
        ));
        if (this.tileSize < 32) this.tileSize = 32;
        if (this.tileSize > 64) this.tileSize = 64;

        this.anchorX = Math.floor((this.canvas.width - map.getWidth() * this.tileSize) / 2);
        this.anchorY = Math.floor((this.canvas.height - map.getHeight() * this.tileSize) / 2);
    }

    public getAnchor() {
        return { x: this.anchorX, y: this.anchorY };
    }

    public setCameraFollow(enabled: boolean) {
        this.isCameraFollow = enabled;
    }

    public triggerCameraFollow(playerX: number, playerY: number) {
        if (!this.isCameraFollow) return;
        
        if (this.cameraInterval) clearInterval(this.cameraInterval);

        this.cameraInterval = setInterval(() => {
            const midX = this.canvas.width / 2 - this.tileSize / 2;
            const midY = this.canvas.height / 2 - this.tileSize / 2;
            
            const screenPX = this.anchorX + playerX * this.tileSize;
            const screenPY = this.anchorY + playerY * this.tileSize;
            
            let dx = midX - screenPX;
            let dy = midY - screenPY;
            
            const midDis = 2; 
            const threshold = this.tileSize * midDis;
            
            if (dx < -threshold) dx += threshold;
            else if (dx > threshold) dx -= threshold;
            else dx = 0;
            
            if (dy < -threshold) dy += threshold;
            else if (dy > threshold) dy -= threshold;
            else dy = 0;
            
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
                clearInterval(this.cameraInterval);
                this.cameraInterval = null;
                return;
            }

            this.anchorX += dx / 30; 
            this.anchorY += dy / 30;
        }, 30);
    }

    render(map: SokobanMap, playerState?: CatRenderState, peerState?: CatRenderState) {
        this.currentMap = map;
        this.ctx.imageSmoothingEnabled = false;
        this.topCtx.imageSmoothingEnabled = false;
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.topCtx.clearRect(0, 0, this.topCanvas.width, this.topCanvas.height);
        
        this.drawGrass(map);
        
        // Layer 1: Butterfly Shadows (Bottom Canvas)
        this.drawButterflyShadows(map);

        // Layer 2: Goals (Floor) (Bottom Canvas)
        for (let y = 0; y < map.getHeight(); y++) {
            for (let x = 0; x < map.getWidth(); x++) {
                this.drawFloor(x, y, map);
            }
        }

        // Layer 3: Player (DOM Image between canvases)
        const playerPos = map.getPlayerPosition();
        if (playerPos) {
            let px = Math.floor(this.anchorX + playerPos.x * this.tileSize);
            let py = Math.floor(this.anchorY + playerPos.y * this.tileSize);
            if (playerState && playerState.progress < 1) {
                const offset = (1 - playerState.progress) * this.tileSize;
                px -= Math.floor(playerState.moveDir.x * offset);
                py -= Math.floor(playerState.moveDir.y * offset);
            }
            this.drawCatOnImg(this.playerImg, px, py, playerState);
        } else {
            this.playerImg.style.display = 'none';
        }

        // Layer 3.5: Peer player (multiplayer)
        if (peerState && peerState.tileX !== undefined && peerState.tileY !== undefined) {
            let qx = Math.floor(this.anchorX + peerState.tileX * this.tileSize);
            let qy = Math.floor(this.anchorY + peerState.tileY * this.tileSize);
            if (peerState.progress < 1) {
                const offset = (1 - peerState.progress) * this.tileSize;
                qx -= Math.floor(peerState.moveDir.x * offset);
                qy -= Math.floor(peerState.moveDir.y * offset);
            }
            this.drawCatOnImg(this.peerImg, qx, qy, peerState);
        } else {
            this.peerImg.style.display = 'none';
        }

        // Layer 4: Objects (Walls, Boxes) (Top Canvas)
        for (let y = 0; y < map.getHeight(); y++) {
            for (let x = 0; x < map.getWidth(); x++) {
                this.drawObject(x, y, map, playerState, peerState);
            }
        }

        // Layer 5: Butterflies (Top Canvas)
        this.drawButterflies(map);
    }

    private drawButterflyShadows(map: SokobanMap) {
        const leftNum = Math.ceil(this.anchorX / this.tileSize);
        const rightNum = Math.ceil((this.canvas.width - this.anchorX) / this.tileSize);
        const upNum = Math.ceil(this.anchorY / this.tileSize);
        const downNum = Math.ceil((this.canvas.height - this.anchorY) / this.tileSize);
        const dsize = this.tileSize / 8;

        for (let dx = -leftNum; dx < map.getWidth() + rightNum; dx++) {
            for (let dy = -upNum; dy < map.getHeight() + downNum; dy++) {
                if (myRand(dx, dy, 0, 0, 30) === 0) {
                    this.drawButterflyPiece(dx, dy, dsize, true, this.ctx);
                }
            }
        }
    }

    private drawButterflies(map: SokobanMap) {
        const leftNum = Math.ceil(this.anchorX / this.tileSize);
        const rightNum = Math.ceil((this.canvas.width - this.anchorX) / this.tileSize);
        const upNum = Math.ceil(this.anchorY / this.tileSize);
        const downNum = Math.ceil((this.canvas.height - this.anchorY) / this.tileSize);
        const dsize = this.tileSize / 8;

        for (let dx = -leftNum; dx < map.getWidth() + rightNum; dx++) {
            for (let dy = -upNum; dy < map.getHeight() + downNum; dy++) {
                if (myRand(dx, dy, 0, 0, 30) === 0) {
                    this.drawButterflyPiece(dx, dy, dsize, false, this.topCtx);
                }
            }
        }
    }

    private drawButterflyPiece(dx: number, dy: number, dsize: number, isShadow: boolean, ctx: CanvasRenderingContext2D) {
        const butterT = 16;
        const ButterDX = [0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 2, 2, 1, 1, 0, 0];
        const ButterDY = [1, 1, 2, 2, 2, 2, 1, 1, 0, 0, -1, -1, -1, -1, 0, 0];
        const ButterHeight = [1, 0, 2, 2, 1, 2, 2, 2, 1, 0, 2, 2, 1, 2, 2, 2];
        const ButterWidth = [2, 2, 1, 2, 2, 0, 1, 2, 2, 2, 1, 2, 2, 0, 1, 2];
        
        const timeid = this.grassTimeId % butterT;
        let bdx, bdy;
        
        const randOffset = Math.abs(myRand(dx, dy, 1, 0, butterT - 1));
        if (Math.abs(myRand(dx, dy, 1, 0, 1)) === 0) {
            bdx = ButterDX[(timeid + randOffset) % butterT];
            bdy = ButterDY[(timeid + randOffset) % butterT];
        } else {
            bdx = ButterDX[((-timeid + randOffset) % butterT + butterT) % butterT];
            bdy = ButterDY[((-timeid + randOffset) % butterT + butterT) % butterT];
        }

        const bh = ButterHeight[(timeid + randOffset) % butterT];
        const bw = ButterWidth[(timeid + randOffset) % butterT];

        const x = Math.floor(this.anchorX + dx * this.tileSize + Math.abs(myRand(dx, dy, 1, 1, 7)) * dsize + bdx * dsize);
        const y = Math.floor(this.anchorY + dy * this.tileSize + Math.abs(myRand(dx, dy, -1, 1, 7)) * dsize + bdy * dsize);

        if (isShadow) {
            const baseColor = themeManager.currentTheme.color;
            ctx.fillStyle = `rgb(${Math.floor(baseColor.r * 0.8)}, ${Math.floor(baseColor.g * 0.8)}, ${Math.floor(baseColor.b * 0.8)})`;
            ctx.fillRect(x, y + Math.floor(dsize * 4), Math.ceil(dsize * 2), Math.ceil(dsize * 2));
        } else {
            ctx.fillStyle = 'white';
            ctx.fillRect(x, y, Math.ceil(dsize * bw), Math.ceil(dsize * bh));
        }
    }

    private randColor(dx: number, dy: number, offset: number = 0) {
        const themeColor = themeManager.currentTheme.color;
        const r = themeColor.r + myRand(dx, dy, 1 + offset, -10, 10);
        const g = themeColor.g + myRand(dx, dy, 2 + offset, -10, 10);
        const b = themeColor.b + myRand(dx, dy, 3 + offset, -10, 10);
        return `rgb(${r}, ${g}, ${b})`;
    }

    private drawGrass(map: SokobanMap) {
        const leftNum = Math.ceil(this.anchorX / this.tileSize);
        const rightNum = Math.ceil((this.canvas.width - this.anchorX) / this.tileSize);
        const upNum = Math.ceil(this.anchorY / this.tileSize);
        const downNum = Math.ceil((this.canvas.height - this.anchorY) / this.tileSize);

        const grassMove = [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, -1, -1, -1, -1, -1];
        const divide = 8;
        const dsize = this.tileSize / divide;

        for (let dx = -leftNum; dx < map.getWidth() + rightNum; dx++) {
            for (let dy = -upNum; dy < map.getHeight() + downNum; dy++) {
                const x = Math.floor(this.anchorX + dx * this.tileSize);
                const y = Math.floor(this.anchorY + dy * this.tileSize);

                this.ctx.fillStyle = this.randColor(dx, dy);
                this.ctx.fillRect(x, y, this.tileSize, this.tileSize);

                // Edge details
                for (let i = 0; i < divide; i++) {
                    if (myRand(dx, dy, i, -10, 10) < 0) {
                        this.ctx.fillStyle = this.randColor(dx, dy - 1);
                        const moveIdx = ((Math.floor(this.grassTimeId / 2) + myRand(dx, dy, 0, 0, 3)) % 16 + 16) % 16;
                        this.ctx.fillRect(Math.floor(x + (i + grassMove[moveIdx]) * dsize), y, Math.ceil(dsize), Math.ceil(dsize));
                    }
                }

                // Grass blades
                for (let i = 1; i <= 3; i++) {
                    if (myRand(dx, dy, i, 0, 1) === 0) {
                        const pieceX = Math.floor(x + myRand(dx, dy, i, 0, divide - 2) * dsize);
                        const pieceY = Math.floor(y + myRand(dx, dy, -i, 0, divide - 1) * dsize);
                        this.ctx.fillStyle = this.randColor(dx, dy - 1);
                        this.ctx.fillRect(pieceX, pieceY, Math.ceil(dsize), Math.ceil(dsize * myRand(dx, dy, i, 2, 5)));
                    }
                }

                // Flowers
                if (myRand(dx, dy, 0, 0, 5) === 0) {
                    const pieceX = Math.floor(x + myRand(dx, dy, 1, 1, divide - 2) * dsize);
                    const pieceY = Math.floor(y + myRand(dx, dy, -1, 1, divide - 3) * dsize);
                    
                    // Shadow
                    this.ctx.fillStyle = 'rgba(0,0,0,0.2)';
                    this.ctx.fillRect(pieceX, pieceY + Math.floor(dsize * 2), Math.ceil(dsize), Math.ceil(dsize));
                    this.ctx.fillRect(pieceX - Math.floor(dsize), pieceY + Math.floor(dsize), Math.ceil(dsize * 3), Math.ceil(dsize));

                    // Petals
                    this.ctx.fillStyle = 'white';
                    this.ctx.fillRect(pieceX - Math.floor(dsize), pieceY, Math.ceil(dsize * 3), Math.ceil(dsize));
                    this.ctx.fillRect(pieceX, pieceY - Math.floor(dsize), Math.ceil(dsize), Math.ceil(dsize * 3));

                    // Center
                    this.ctx.fillStyle = 'rgb(240, 200, 100)';
                    this.ctx.fillRect(pieceX, pieceY, Math.ceil(dsize), Math.ceil(dsize));
                }
            }
        }
    }

    private drawFloor(x: number, y: number, map: SokobanMap) {
        const tx = Math.floor(this.anchorX + x * this.tileSize);
        const ty = Math.floor(this.anchorY + y * this.tileSize);
        const tile = map.getTile(x, y);

        if (tile & TILE_MASK.GOAL) {
            const img = this.images.get('/assets/images/goal.png');
            if (img) this.ctx.drawImage(img, tx, ty, this.tileSize, this.tileSize);

            // Glow effect (Matching Java exactly)
            const lowLimit = 0.9;
            const highLimit = 1.2;
            const size = Math.floor(this.tileSize * (lowLimit + (highLimit - lowLimit) * this.glowProgress));
            const offset = Math.floor((size - this.tileSize) / 2);
            const alpha = 1 - this.glowProgress;

            this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(tx - offset, ty - offset, size, size);
        }
    }

    private drawObject(x: number, y: number, map: SokobanMap, playerState?: CatRenderState, peerState?: CatRenderState) {
        const tx = Math.floor(this.anchorX + x * this.tileSize);
        const ty = Math.floor(this.anchorY + y * this.tileSize);
        const tile = map.getTile(x, y);

        if (tile & TILE_MASK.WALL) {
            const wallImgPath = this.getWallImagePath(x, y, map);
            const img = this.images.get(wallImgPath);
            if (img) {
                const wallHeight = Math.floor(this.tileSize * 1.5);
                this.topCtx.drawImage(img, tx, ty - Math.floor(this.tileSize * 0.5), this.tileSize, wallHeight);
            }
        }

        if (tile & TILE_MASK.BOX) {
            const img = this.images.get('/assets/images/box.png');
            if (img) {
                let bx = tx;
                let by = ty;
                const interp = (state?: CatRenderState) => {
                    if (state && state.pushedBox && state.pushedBox.x === x && state.pushedBox.y === y && state.progress < 1) {
                        const offset = (1 - state.progress) * this.tileSize;
                        bx -= Math.floor(state.moveDir.x * offset);
                        by -= Math.floor(state.moveDir.y * offset);
                    }
                };
                interp(playerState);
                interp(peerState);
                const boxHeight = Math.floor(this.tileSize * 1.3);
                this.topCtx.drawImage(img, bx, by - Math.floor(this.tileSize * 0.3), this.tileSize, boxHeight);
            }
        }
    }

    private drawCatOnImg(img: HTMLImageElement, tx: number, ty: number, state?: { orientation: number, isMoving: boolean, progress?: number }) {
        const orientation = state?.orientation ?? 2; // Default down
        const isMoving = state?.isMoving ?? false;
        
        let imgPath = '';
        let scaleX = 1;

        if (isMoving) {
            if (orientation === 1) imgPath = '/assets/images/player_cat/cat_run_back.gif';
            else if (orientation === 2) imgPath = '/assets/images/player_cat/cat_run_front.gif';
            else if (orientation === 3) { imgPath = '/assets/images/player_cat/cat_run.gif'; scaleX = -1; }
            else if (orientation === 4) imgPath = '/assets/images/player_cat/cat_run.gif';
        } else {
            if (orientation === 1) imgPath = '/assets/images/player_cat/cat_stand_back.gif';
            else if (orientation === 2) imgPath = '/assets/images/player_cat/cat_stand_front.gif';
            else if (orientation === 3) { imgPath = '/assets/images/player_cat/cat_stand.gif'; scaleX = -1; }
            else if (orientation === 4) imgPath = '/assets/images/player_cat/cat_stand.gif';
        }

        // Update DOM element
        img.style.display = 'block';
        if (img.src !== window.location.origin + imgPath) {
            img.src = imgPath;
        }
        img.style.left = `${tx}px`;
        img.style.top = `${ty}px`;
        img.style.width = `${this.tileSize}px`;
        img.style.height = `${this.tileSize}px`;
        img.style.transform = scaleX === -1 ? 'scaleX(-1)' : 'none';
    }

    setPeerVisible(visible: boolean) {
        this.peerImg.style.display = visible ? 'block' : 'none';
    }

    setPlayerTint(filter: string | null) {
        this.playerImg.style.filter = filter ?? '';
    }

    setPeerTint(filter: string | null) {
        this.peerImg.style.filter = filter ?? '';
    }

    private getWallImagePath(x: number, y: number, map: SokobanMap): string {
        const up = map.hasWall(x, y - 1);
        const left = map.hasWall(x - 1, y);
        const right = map.hasWall(x + 1, y);

        if (up) {
            if (left && right) return '/assets/images/wall/wall_md.png';
            if (left) return '/assets/images/wall/wall_rd.png';
            if (right) return '/assets/images/wall/wall_ld.png';
            return '/assets/images/wall/wall_d.png';
        } else {
            if (left && right) return '/assets/images/wall/wall_m.png';
            if (left) return '/assets/images/wall/wall_r.png';
            if (right) return '/assets/images/wall/wall_l.png';
            return '/assets/images/wall/wall.png';
        }
    }

    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    public destroy() {
        if (this.cameraInterval) clearInterval(this.cameraInterval);
        if (this.animationInterval) clearInterval(this.animationInterval);
        window.removeEventListener('mousemove', this.boundMouseMove);
        window.removeEventListener('mouseup', this.boundMouseUp);
        if (this.boundResize) {
            window.removeEventListener('resize', this.boundResize);
        }
        themeManager.removeListener(this.themeListener);
        this.playerImg.remove();
        this.peerImg.remove();
        this.canvas.remove();
        this.topCanvas.remove();
    }
}
