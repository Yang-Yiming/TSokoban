import { myRand, randColor } from './utils';
import { GameController, MAP_DATA } from './game';
import { themeManager } from './theme';
import { showThemeDialog } from './ui/themeDialog';
import { createDialog } from './ui/dialog';

export class Menu {
  private app: HTMLElement;
  private clouds: HTMLElement[] = [];
  private cloudPositions: number[] = [-1000, 0, -400, 200, -400, -200];
  private cloudSpeeds: number[] = [0.25, 0.1, 0.2, 0.3, 0.5, -0.7];
  private box: HTMLImageElement | null = null;
  private cat: HTMLImageElement | null = null;
  private boxY: number = 0;
  private boxV: number = 0;
  private boxA: number = 0.15;
  private catX: number = 50;
  private catY: number = 0;
  private catV: number = 0;
  private catA: number = 0.15;
  private isDragging: boolean = false;
  private grassElements: { el: HTMLElement, i: number, j: number }[] = [];

  constructor(appId: string) {
    this.app = document.getElementById(appId)!;
    this.init();
    
    themeManager.addListener(() => {
      this.updateGrassColors();
    });
  }

  private updateGrassColors() {
    this.grassElements.forEach(({ el, i, j }) => {
      el.style.backgroundColor = randColor(i, j);
    });
  }

  private init() {
    this.createClouds();
    this.createBox();
    this.createCat();
    this.createGround();
    this.createTitle();
    this.createButtons();
    this.startAnimation();
    this.playMusic();
  }

  private createClouds() {
    for (let i = 0; i < 6; i++) {
      const cloud = document.createElement('img');
      cloud.src = `/assets/images/clouds/Clouds${i}.png`;
      cloud.className = 'cloud';
      cloud.draggable = false;
      cloud.style.left = `${this.cloudPositions[i]}px`;
      cloud.style.top = `${[0, 50, 100, 150, 200, 250][i]}px`;
      cloud.style.width = `${[1600, 1800, 1300, 1000, 1000, 600][i]}px`;
      this.app.appendChild(cloud);
      this.clouds.push(cloud);
    }
  }

  private createGround() {
    for (let i = 0; i < 16; i++) { // 800 / 50 = 16
      const divide = 10;
      const siz = 50 / divide;
      
      // Create blades first
      for (let j = 0; j < divide; j++) {
        let height = siz * myRand(i, j, 0, -1, 3);
        if (height <= 0) continue;
        height += 50;
        const rect = document.createElement('div');
        rect.className = 'grass-rect';
        rect.style.left = `${i * 50 + j * siz}px`;
        rect.style.width = `${siz}px`;
        rect.style.height = `${height}px`;
        rect.style.top = `${600 - height}px`;
        rect.style.backgroundColor = randColor(i, j);
        this.app.appendChild(rect);
        this.grassElements.push({ el: rect, i, j });
      }

      // Create base last so it's on top of blades (matching Java order)
      const baseRect = document.createElement('div');
      baseRect.className = 'grass-rect';
      baseRect.style.left = `${i * 50}px`;
      baseRect.style.width = '50px';
      baseRect.style.height = '50px';
      baseRect.style.top = `${600 - 50}px`;
      baseRect.style.backgroundColor = randColor(i, i);
      this.app.appendChild(baseRect);
      this.grassElements.push({ el: baseRect, i, j: i });
    }
  }

  private createBox() {
    this.box = document.createElement('img');
    this.box.src = '/assets/images/box_2d.png';
    this.box.id = 'box';
    this.box.draggable = false;
    this.box.style.left = '400px';
    this.boxY = 0;
    this.app.appendChild(this.box);

    this.box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isDragging = true;
      this.box!.style.cursor = 'grabbing';
    });

    this.app.addEventListener('dragstart', (e) => {
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging && this.box) {
        const rect = this.app.getBoundingClientRect();
        const x = e.clientX - rect.left - 25;
        const y = e.clientY - rect.top - 25;
        this.box.style.left = `${x}px`;
        this.boxY = y;
        this.box.style.top = `${y}px`;
        this.boxV = 0;
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.box!.style.cursor = 'grab';
      }
    });
  }

  private createCat() {
    this.cat = document.createElement('img');
    this.cat.src = '/assets/images/player_cat/cat_stand.gif';
    this.cat.id = 'cat';
    this.cat.draggable = false;
    this.catX = 50;
    this.catY = 600 - 86;
    this.app.appendChild(this.cat);
  }

  private createTitle() {
    const title = document.createElement('img');
    title.src = '/assets/images/title.gif';
    title.id = 'title';
    title.draggable = false;
    this.app.appendChild(title);
  }

  private createButtons() {
    const startBtn = document.createElement('button');
    startBtn.id = 'start-btn';
    startBtn.innerText = '开始';
    this.app.appendChild(startBtn);
    this.addJumpyHover(startBtn, true);

    startBtn.addEventListener('click', () => {
      this.handleStartClick(startBtn);
    });

    this.createIconBtn('login-btn', 'login', 150, () => this.showLoginDialog());
    this.createIconBtn('settings-btn', 'settings', 80, () => this.showSettingsDialog());
    this.createIconBtn('theme-btn', 'theme', 220, () => this.showThemeDialog());
  }

  private createIconBtn(id: string, name: string, right: number, onClick: () => void) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.id = id;
    btn.style.right = `${right}px`;
    
    const img = document.createElement('img');
    img.src = `/assets/images/${name}.png`;
    img.style.width = '30px';
    img.style.height = '30px';
    img.draggable = false;
    
    btn.appendChild(img);
    this.app.appendChild(btn);

    btn.addEventListener('mouseenter', () => {
      img.src = `/assets/images/${name}_clicked.png`;
    });
    btn.addEventListener('mouseleave', () => {
      img.src = `/assets/images/${name}.png`;
    });
    btn.addEventListener('click', onClick);
  }

  private showLoginDialog() {
    const { paper } = createDialog(this.app, 'Login');
    
    const vbox = document.createElement('div');
    vbox.className = 'login-vbox';
    
    const usernameGroup = this.createInputGroup('Username', 'text');
    const passwordGroup = this.createInputGroup('Password', 'password');
    
    const buttons = document.createElement('div');
    buttons.className = 'login-buttons';
    
    const loginBtn = document.createElement('button');
    loginBtn.innerText = 'Login';
    const registerBtn = document.createElement('button');
    registerBtn.innerText = 'Register';
    
    buttons.appendChild(loginBtn);
    buttons.appendChild(registerBtn);
    
    vbox.appendChild(usernameGroup);
    vbox.appendChild(passwordGroup);
    vbox.appendChild(buttons);
    
    paper.appendChild(vbox);
  }

  private createInputGroup(labelText: string, type: string) {
    const group = document.createElement('div');
    group.className = 'input-group';
    const label = document.createElement('label');
    label.innerText = labelText;
    const input = document.createElement('input');
    input.type = type;
    group.appendChild(label);
    group.appendChild(input);
    return group;
  }

  private showSettingsDialog() {
    const { paper } = createDialog(this.app, 'Settings');
    
    const vbox = document.createElement('div');
    vbox.className = 'settings-vbox';
    
    vbox.appendChild(this.createSettingsRow('MovingAnimTime', 'range', 0, 100, 50));
    vbox.appendChild(this.createSettingsRow('Volume', 'range', 0, 100, 50));
    
    const aStarRow = document.createElement('div');
    aStarRow.className = 'settings-row';
    const aStarLabel = document.createElement('label');
    aStarLabel.innerText = '采用更智能的无解判断';
    const aStarCheck = document.createElement('input');
    aStarCheck.type = 'checkbox';
    const aStarText = document.createElement('span');
    aStarText.innerText = '启用A*';
    aStarRow.appendChild(aStarLabel);
    const checkContainer = document.createElement('div');
    checkContainer.appendChild(aStarCheck);
    checkContainer.appendChild(aStarText);
    aStarRow.appendChild(checkContainer);
    vbox.appendChild(aStarRow);

    const seedRow = document.createElement('div');
    seedRow.className = 'settings-row';
    const seedLabel = document.createElement('label');
    seedLabel.innerText = '设定地图生成种子';
    const seedInput = document.createElement('input');
    seedInput.type = 'text';
    seedInput.value = '53';
    seedRow.appendChild(seedLabel);
    seedRow.appendChild(seedInput);
    vbox.appendChild(seedRow);
    
    paper.appendChild(vbox);
  }

  private createSettingsRow(labelText: string, type: string, min?: number, max?: number, value?: any) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const label = document.createElement('label');
    label.innerText = labelText;
    const input = document.createElement('input');
    input.type = type;
    if (min !== undefined) input.min = min.toString();
    if (max !== undefined) input.max = max.toString();
    if (value !== undefined) input.value = value.toString();
    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  private showThemeDialog() {
    showThemeDialog(this.app);
  }

  private addJumpyHover(btn: HTMLElement, isCentered: boolean) {
    const baseTransform = isCentered ? 'translateX(-50%)' : '';
    
    btn.addEventListener('mouseenter', () => {
      // JavaFX ScaleTransition starts from current scale or 'from' value immediately
      // To match the "chaotic" feel, we reset and play instantly
      btn.style.transition = 'none';
      btn.style.transform = `${baseTransform} scale(1)`;
      btn.offsetHeight; // force reflow
      btn.style.transition = 'transform 0.08s ease-out'; // Slightly faster than 100ms for web snappiness
      btn.style.transform = `${baseTransform} scale(1.15)`;
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transition = 'transform 0.08s ease-in';
      btn.style.transform = `${baseTransform} scale(1)`;
    });
  }

  private handleStartClick(startBtn: HTMLButtonElement) {
    // In Java, mode buttons start fading in IMMEDIATELY when start button starts fading out
    startBtn.style.pointerEvents = 'none';
    startBtn.style.opacity = '0';
    
    this.showModeButtons();
    
    setTimeout(() => {
      startBtn.remove();
    }, 200);
  }

  private showModeButtons() {
    const modes = [
      { text: '经典模式', top: 270 },
      { text: '无尽模式', top: 320 },
      { text: '双人模式', top: 370 }
    ];

    modes.forEach((mode) => {
      const btn = document.createElement('button');
      btn.className = 'mode-btn';
      btn.innerText = mode.text;
      btn.style.top = `${mode.top}px`;
      this.app.appendChild(btn);
      this.addJumpyHover(btn, true);

      // Trigger fade in simultaneously and fast
      requestAnimationFrame(() => {
        btn.classList.add('visible');
      });

      btn.addEventListener('click', () => {
        if (mode.text === '经典模式') {
          this.showLevelSelect();
        } else {
          console.log(`Selected mode: ${mode.text}`);
        }
      });
    });
  }

  private showLevelSelect() {
    const { shade, paper } = createDialog(this.app, '选择关卡');
    const grid = document.createElement('div');
    grid.className = 'level-grid';

    MAP_DATA.forEach((_, index) => {
      const item = document.createElement('div');
      item.className = 'level-item';
      item.innerText = `${index + 1}`;
      item.onclick = () => {
        shade.remove();
        this.startGame(index);
      };
      grid.appendChild(item);
    });

    paper.appendChild(grid);
  }

  private startGame(levelIndex: number) {
    // Hide menu elements
    Array.from(this.app.children).forEach(child => {
      if (child instanceof HTMLElement && child.id !== 'game-container') {
        child.style.display = 'none';
      }
    });

    const gameContainer = document.createElement('div');
    gameContainer.id = 'game-container';
    gameContainer.style.position = 'absolute';
    gameContainer.style.top = '0';
    gameContainer.style.left = '0';
    gameContainer.style.width = '100%';
    gameContainer.style.height = '100%';
    gameContainer.style.zIndex = '200'; // Higher than dialogs
    this.app.appendChild(gameContainer);

    const controller = new GameController(gameContainer, () => {
      controller.destroy();
      gameContainer.remove();
      // Show menu elements again
      Array.from(this.app.children).forEach(child => {
        if (child instanceof HTMLElement) {
          child.style.display = '';
        }
      });
    });

    controller.loadLevel(levelIndex);
  }

  private startAnimation() {
    const animate = () => {
      // Clouds
      for (let i = 0; i < this.clouds.length; i++) {
        this.cloudPositions[i] -= this.cloudSpeeds[i];
        const width = [1600, 1800, 1300, 1000, 1000, 600][i];
        if (this.cloudSpeeds[i] > 0) {
          if (this.cloudPositions[i] < -width) this.cloudPositions[i] = 800;
        } else {
          if (this.cloudPositions[i] > 800) this.cloudPositions[i] = -width;
        }
        this.clouds[i].style.left = `${this.cloudPositions[i]}px`;
      }

      // Box Gravity
      if (!this.isDragging && this.box) {
        const groundY = 600 - 100;
        if (this.boxY < groundY) {
          this.boxV += this.boxA;
          this.boxY += this.boxV;
          if (this.boxY >= groundY) {
            this.boxY = groundY;
            this.boxV = 0;
          }
        } else {
          this.boxY = groundY;
          this.boxV = 0;
        }
        this.box.style.top = `${this.boxY}px`;
      }

      // Cat Logic
      if (this.cat && this.box) {
        const catGroundY = 600 - 86;
        if (this.catY < catGroundY) {
          this.catV += this.catA;
          this.catY += this.catV;
          if (this.catY >= catGroundY) {
            this.catY = catGroundY;
            this.catV = 0;
          }
        } else {
          this.catV = 0;
          this.catY = catGroundY;
        }
        this.cat.style.top = `${this.catY}px`;

        const boxX = parseFloat(this.box.style.left);
        const targetSrc = Math.abs(this.catX - boxX) > 50 ? '/assets/images/player_cat/cat_run.gif' : '/assets/images/player_cat/cat_stand.gif';
        
        if (this.cat.getAttribute('src') !== targetSrc) {
          this.cat.src = targetSrc;
        }

        if (this.catX < boxX - 50) {
          this.cat.style.transform = 'scaleX(1)';
          this.catX += 2;
        } else if (this.catX > boxX + 50) {
          this.cat.style.transform = 'scaleX(-1)';
          this.catX -= 2;
        }
        this.cat.style.left = `${this.catX}px`;
      }

      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  private playMusic() {
    const audio = new Audio('/assets/music/main.m4a');
    audio.loop = true;
    // Autoplay might be blocked by browser, usually needs user interaction
    document.addEventListener('click', () => {
      audio.play().catch(() => {});
    }, { once: true });
  }
}
