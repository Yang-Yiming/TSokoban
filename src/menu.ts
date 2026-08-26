import { myRand, randColor } from './utils';
import { GameController, LevelSelect } from './game';
import type { GeneratedLevelMeta } from './game';
import { themeManager } from './theme';
import { showThemeDialog } from './ui/themeDialog';
import { createDialog } from './ui/dialog';
import { showSettingsDialog } from './ui/settingsDialog';
import { settingsManager } from './settings';
import { characterManager, worldManager, exportAllSaves, importAllSaves, clearAllSaves } from './save';
import type { CharacterSave } from './save';
import { checkSpecialDay } from './specialDays';
import type { SpecialDayEffect } from './specialDays';
import { MultiplayerSession } from './net/MultiplayerSession';
import type { DisconnectReason } from './net/MultiplayerSession';
import type { LevelRef, Spawn, WorldFlags } from './net/protocol';

export class Menu {
  private app: HTMLElement;
  private clouds: HTMLElement[] = [];
  private cloudPositions: number[] = [-1000, 0, -400, 200, -400, -200];
  private cloudSpeeds: number[] = [0.25, 0.1, 0.2, 0.3, 0.5, -0.7];
  private box: HTMLImageElement | null = null;
  private cat: HTMLImageElement | null = null;
  private boxX: number = 400;
  private boxY: number = 0;
  private boxV: number = 0;       // px/ms
  private boxVx: number = 0;      // px/ms
  private boxA: number = 0.001;   // gravity, px/ms²
  private boxLastTime: number = 0;
  private catX: number = 50;
  private catY: number = 0;
  private catV: number = 0;
  private catA: number = 0.15;
  private isDragging: boolean = false;
  private grassElements: { el: HTMLElement, i: number, j: number }[] = [];
  private bgm: HTMLAudioElement | null = null;
  private _specialDayEffect: SpecialDayEffect | null = null;
  private session: MultiplayerSession | null = null;
  private mpCleanup: (() => void) | null = null;

  constructor(appId: string) {
    this.app = document.getElementById(appId)!;
    this.init();

    // Direct-link join: ?room=XXXX skips the menu entirely
    this.autoJoinFromUrl();

    // Check for special days
    checkSpecialDay().then(effect => {
      if (effect) {
        this._specialDayEffect = effect;
        effect.apply(this.app);
      }
    });

    themeManager.addListener(() => {
      this.updateGrassColors();
    });

    settingsManager.addListener((settings) => {
      if (this.bgm) {
        this.bgm.volume = settings.volume / 100;
      }
      // Re-render ground if seed changes
      this.updateGround();
    });
  }

  private updateGround() {
    // Clear existing grass
    this.grassElements.forEach(({ el }) => el.remove());
    this.grassElements = [];
    this.createGround();
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
    this.boxX = 400;
    this.box.style.left = `${this.boxX}px`;
    this.boxY = 0;
    this.app.appendChild(this.box);

    this.box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isDragging = true;
      this.boxVx = 0;
      this.boxV = 0;
      this.boxLastTime = performance.now();
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
        const dx = x - this.boxX;
        const dy = y - this.boxY;
        const now = performance.now();
        const dt = now - this.boxLastTime;
        if (dt > 0) {
          this.boxVx = dx / dt;  // px/ms
          this.boxV = dy / dt;
        }
        this.boxLastTime = now;
        this.boxX = x;
        this.boxY = y;
        this.box.style.left = `${x}px`;
        this.box.style.top = `${y}px`;
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.boxLastTime = performance.now();
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

    this.createIconBtn('login-btn', 'login', 150, () => this.showSaveDialog());
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

  private showSaveDialog() {
    const { paper } = createDialog(this.app, '存档管理');
    
    const vbox = document.createElement('div');
    vbox.className = 'settings-vbox';

    const hint = document.createElement('div');
    hint.className = 'mp-dialog-text';
    hint.style.textAlign = 'left';
    hint.innerText = '角色档（名字/鱼干/道具/装备）跟人走；世界档（种子+通关记录）跟世界走。换房主联机时，用角色码带走你的角色。';
    vbox.appendChild(hint);
    
    const saveButtonsRow = document.createElement('div');
    saveButtonsRow.className = 'settings-row';
    saveButtonsRow.style.justifyContent = 'space-around';
    saveButtonsRow.style.marginTop = '20px';

    const exportBtn = document.createElement('button');
    exportBtn.innerText = '导出全部存档';
    exportBtn.onclick = () => {
      const data = exportAllSaves();
      navigator.clipboard.writeText(data).then(() => {
        alert('存档已复制到剪贴板');
      });
    };

    const importBtn = document.createElement('button');
    importBtn.innerText = '导入存档';
    importBtn.onclick = () => {
      const data = prompt('请粘贴存档代码:');
      if (data && importAllSaves(data)) {
        alert('存档导入成功，请刷新页面');
        window.location.reload();
      } else if (data) {
        alert('存档导入失败，请检查代码是否正确');
      }
    };

    const clearBtn = document.createElement('button');
    clearBtn.innerText = '清空存档';
    clearBtn.style.color = 'red';
    clearBtn.onclick = () => {
      if (confirm('确定要清空所有存档（角色+世界）吗？此操作不可撤销！')) {
        clearAllSaves();
        alert('存档已清空，请刷新页面');
        window.location.reload();
      }
    };

    saveButtonsRow.appendChild(exportBtn);
    saveButtonsRow.appendChild(importBtn);
    saveButtonsRow.appendChild(clearBtn);
    vbox.appendChild(saveButtonsRow);
    
    paper.appendChild(vbox);
  }

  private showSettingsDialog() {
    showSettingsDialog(this.app);
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
      { text: '经典模式', sub: '单人游玩', img: '/assets/images/choice2.png', left: '25%', action: () => this.startClassicFlow() },
      { text: '创建房间', sub: '和朋友联机（房主）', img: '/assets/images/choice1.png', left: '50%', action: () => { if (__MULTIPLAYER__) this.startCreateRoomFlow(); else this.showMpUnavailable(); } },
      { text: '加入房间', sub: '没有链接？输入房号', img: '/assets/images/choice3.png', left: '75%', action: () => { if (__MULTIPLAYER__) this.startJoinRoom(); else this.showMpUnavailable(); } }
    ];

    modes.forEach((mode) => {
      const btn = document.createElement('button');
      btn.className = 'mode-btn mode-icon-btn';
      btn.style.top = '320px';
      btn.style.left = mode.left;
      const img = document.createElement('img');
      img.src = mode.img;
      img.draggable = false;
      const label = document.createElement('span');
      label.className = 'mode-btn-label';
      label.innerText = mode.text;
      const sub = document.createElement('span');
      sub.className = 'mode-btn-sub';
      sub.innerText = mode.sub;
      btn.appendChild(img);
      btn.appendChild(label);
      btn.appendChild(sub);
      this.app.appendChild(btn);
      this.addJumpyHover(btn, true);

      // Trigger fade in simultaneously and fast
      requestAnimationFrame(() => {
        btn.classList.add('visible');
      });

      btn.addEventListener('click', mode.action);
    });
  }

  // ---- Character / World selection (Terraria-style save split) ----

  private showCharacterSelect(onPicked: (c: CharacterSave) => void) {
    const { shade, paper } = createDialog(this.app, '选择角色');
    const last = characterManager.getLastUsed();
    let selectedId = characterManager.list().some((c) => c.id === last.characterId)
      ? last.characterId
      : (characterManager.list()[0]?.id ?? null);

    const listBox = document.createElement('div');
    listBox.className = 'save-list';
    paper.appendChild(listBox);

    const refresh = () => {
      listBox.innerHTML = '';
      const chars = characterManager.list();
      if (chars.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'mp-dialog-text';
        empty.innerText = '还没有角色，创建一个吧';
        listBox.appendChild(empty);
      }
      chars.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'save-row' + (c.id === selectedId ? ' selected' : '');
        const label = document.createElement('span');
        label.innerText = `${c.id === last.characterId ? '▶ ' : ''}${c.name}　🐟×${c.fishCount}`;
        label.onclick = () => {
          selectedId = c.id;
          refresh();
        };
        row.appendChild(label);
        listBox.appendChild(row);
      });
    };
    refresh();

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-row';
    const mkBtn = (text: string, color?: string) => {
      const b = document.createElement('button');
      b.innerText = text;
      if (color) b.style.color = color;
      return b;
    };

    const newBtn = mkBtn('新角色');
    newBtn.onclick = () => {
      const name = prompt('给角色起个名字：');
      if (name === null) return;
      const c = characterManager.create(name);
      selectedId = c.id;
      refresh();
    };

    const importBtn = mkBtn('导入');
    importBtn.onclick = () => {
      const code = prompt('粘贴角色码：');
      if (!code) return;
      if (characterManager.importCharacter(code)) refresh();
      else alert('导入失败，请检查角色码');
    };

    const exportBtn = mkBtn('导出');
    exportBtn.onclick = () => {
      if (!selectedId) { alert('请先选择一个角色'); return; }
      const code = characterManager.exportCharacter(selectedId);
      if (code) navigator.clipboard.writeText(code).then(() => alert('角色码已复制到剪贴板')).catch(() => {});
    };

    const delBtn = mkBtn('删除', 'red');
    delBtn.onclick = () => {
      if (!selectedId) { alert('请先选择一个角色'); return; }
      const c = characterManager.get(selectedId);
      if (c && confirm(`确定删除角色「${c.name}」吗？此操作不可撤销！`)) {
        characterManager.remove(selectedId);
        selectedId = characterManager.list()[0]?.id ?? null;
        refresh();
      }
    };

    const okBtn = mkBtn('确定');
    okBtn.onclick = () => {
      const c = selectedId ? characterManager.get(selectedId) : null;
      if (!c) { alert('请先选择或创建角色'); return; }
      shade.remove();
      onPicked(c);
    };

    btnRow.appendChild(newBtn);
    btnRow.appendChild(importBtn);
    btnRow.appendChild(exportBtn);
    btnRow.appendChild(delBtn);
    btnRow.appendChild(okBtn);
    paper.appendChild(btnRow);
  }

  private showWorldSelect(onPicked: (seed: string) => void) {
    const { shade, paper } = createDialog(this.app, '选择世界');
    const last = characterManager.getLastUsed();
    const worlds = worldManager.listWorlds();
    let selectedSeed = worlds.some((w) => w.seed === last.seed) ? last.seed : (worlds[0]?.seed ?? null);

    const listBox = document.createElement('div');
    listBox.className = 'save-list';
    paper.appendChild(listBox);

    const refresh = () => {
      listBox.innerHTML = '';
      const list = worldManager.listWorlds();
      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'mp-dialog-text';
        empty.innerText = '还没有世界，创建一个吧';
        listBox.appendChild(empty);
      }
      list.forEach(({ seed, save }) => {
        const row = document.createElement('div');
        row.className = 'save-row' + (seed === selectedSeed ? ' selected' : '');
        const label = document.createElement('span');
        const progress = `${Math.min(save.completedLevels.length, 16)}/16`;
        const date = save.lastPlayedAt ? new Date(save.lastPlayedAt).toLocaleDateString() : '新';
        label.innerText = `${seed === last.seed ? '▶ ' : ''}世界 ${seed}　${progress}　${date}`;
        label.onclick = () => {
          selectedSeed = seed;
          refresh();
        };
        row.appendChild(label);
        listBox.appendChild(row);
      });
    };
    refresh();

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-row';
    const mkBtn = (text: string) => {
      const b = document.createElement('button');
      b.innerText = text;
      return b;
    };

    const randomBtn = mkBtn('随机新世界');
    randomBtn.onclick = () => {
      selectedSeed = String(Math.floor(1000 + Math.random() * 9000));
      refresh();
    };

    const seedBtn = mkBtn('输入种子');
    seedBtn.onclick = () => {
      const seed = prompt('输入世界种子：');
      if (!seed) return;
      selectedSeed = seed;
      refresh();
    };

    const okBtn = mkBtn('确定');
    okBtn.onclick = () => {
      if (!selectedSeed) { alert('请先选择或创建世界'); return; }
      shade.remove();
      onPicked(selectedSeed);
    };

    btnRow.appendChild(randomBtn);
    btnRow.appendChild(seedBtn);
    btnRow.appendChild(okBtn);
    paper.appendChild(btnRow);
  }

  // ---- Game flows ----

  private startClassicFlow() {
    this.showCharacterSelect((c) => {
      this.showWorldSelect((seed) => this.startSoloWorld(c, seed));
    });
  }

  private startSoloWorld(c: CharacterSave, seed: string) {
    characterManager.setActive(c.id);
    settingsManager.updateSettings({ mapSeed: seed });
    worldManager.setMirror(null);
    worldManager.setActiveSeed(seed);
    this.showLevelSelect();
  }

  /** Guest: adopt the host's world (seed + mirror) before entering the map. */
  private enterHostWorld(session: MultiplayerSession, seed: string, world: WorldFlags | null, c: CharacterSave) {
    characterManager.setActive(c.id);
    settingsManager.updateSettings({ mapSeed: seed });
    worldManager.setActiveSeed(seed);
    worldManager.setMirror(world ?? { completedLevels: [], chestOpened: false, completedGeneratedLevels: [] });
    this.showLevelSelect(0, undefined, session);
  }

  /** Opening a shared link (…/?room=1234): pick a character, then join directly. */
  private autoJoinFromUrl() {
    if (!__MULTIPLAYER__) return;
    const room = new URLSearchParams(window.location.search).get('room');
    if (!room) return;

    this.showCharacterSelect((c) => {
      characterManager.setActive(c.id);
      const session = new MultiplayerSession();
      this.session = session;
      session.onDisconnected = (reason) => this.handleMpDisconnect(reason);

      const status = document.createElement('div');
      status.id = 'mp-autojoin-status';
      status.style.cssText = 'position:absolute;top:280px;left:50%;transform:translateX(-50%);font-family:Pixel;font-size:20px;color:#55371d;z-index:50;';
      status.innerText = `正在加入房间 ${room}…`;
      this.app.appendChild(status);

      session.onJoined = (info) => {
        if (!info.isHost) {
          status.remove();
          this.enterHostWorld(session, info.seed, info.world, c);
        }
      };
      session.onError = (msg) => {
        status.remove();
        session.leave();
        if (this.session === session) this.session = null;
        alert(`加入房间失败：${msg}`);
      };

      session.joinRoom(room, c.name);
    });
  }

  private showMpUnavailable() {
    const { paper } = createDialog(this.app, '联机不可用');
    const tip = document.createElement('div');
    tip.className = 'mp-dialog-text';
    tip.style.textAlign = 'left';
    tip.innerHTML = '当前网页是纯单机版（静态托管）。<br><br>要联机，请在本地运行服务器：<br>1. 克隆本仓库并 <b>bun install</b><br>2. <b>bun run build</b><br>3. <b>bun run server</b><br>4. 双方打开终端显示的局域网地址';
    paper.appendChild(tip);
  }

  private startCreateRoomFlow() {
    this.showCharacterSelect((c) => {
      this.showWorldSelect((seed) => this.startCreateRoom(c, seed));
    });
  }

  private startCreateRoom(c: CharacterSave, seed: string) {
    characterManager.setActive(c.id);
    settingsManager.updateSettings({ mapSeed: seed });
    worldManager.setMirror(null);
    worldManager.setActiveSeed(seed);

    const session = new MultiplayerSession();
    this.session = session;
    session.onDisconnected = (reason) => this.handleMpDisconnect(reason);

    const { shade, paper } = createDialog(this.app, '创建房间', () => {
      if (this.session === session) {
        session.leave();
        this.session = null;
      }
    });

    const status = document.createElement('div');
    status.className = 'mp-dialog-text';
    status.innerText = '正在连接服务器…';
    paper.appendChild(status);

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      const warn = document.createElement('div');
      warn.className = 'mp-dialog-text';
      warn.style.color = 'red';
      warn.style.whiteSpace = 'pre-line';
      warn.innerText = '⚠ 当前通过 localhost 打开，分享链接别人打不开。\n请改用局域网 IP 或 .local 地址打开本页后再建房';
      paper.appendChild(warn);
    }

    session.onJoined = (info) => {
      status.innerText = '等待玩家加入…';
      const link = `${window.location.origin}/?room=${info.room}`;
      const row = document.createElement('div');
      row.className = 'settings-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = link;
      input.readOnly = true;
      const copyBtn = document.createElement('button');
      copyBtn.innerText = '复制链接';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(link).then(() => {
          copyBtn.innerText = '已复制';
        }).catch(() => {});
      };
      row.appendChild(input);
      row.appendChild(copyBtn);
      paper.appendChild(row);
    };

    session.onPeerJoined = () => {
      shade.remove();
      this.showLevelSelect(0, undefined, session);
    };

    session.onError = (msg) => {
      status.innerText = msg;
    };

    session.createRoom(worldManager.getSeed(), worldManager.exportFlags(), c.name);
  }

  private startJoinRoom() {
    this.showCharacterSelect((c) => {
      characterManager.setActive(c.id);
      this.showJoinRoomDialog(c);
    });
  }

  private showJoinRoomDialog(c: CharacterSave) {
    const session = new MultiplayerSession();
    this.session = session;
    session.onDisconnected = (reason) => this.handleMpDisconnect(reason);

    const { shade, paper } = createDialog(this.app, '加入房间', () => {
      if (this.session === session) {
        session.leave();
        this.session = null;
      }
    });

    const row = document.createElement('div');
    row.className = 'settings-row';
    const label = document.createElement('label');
    label.innerText = '房间链接';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '粘贴链接或输入房间号';
    const urlRoom = new URLSearchParams(window.location.search).get('room');
    if (urlRoom) input.value = urlRoom;
    row.appendChild(label);
    row.appendChild(input);
    paper.appendChild(row);

    const joinBtn = document.createElement('button');
    joinBtn.innerText = '加入';
    paper.appendChild(joinBtn);

    const status = document.createElement('div');
    status.className = 'mp-dialog-text';
    paper.appendChild(status);

    session.onJoined = (info) => {
      if (!info.isHost) {
        shade.remove();
        this.enterHostWorld(session, info.seed, info.world, c);
      }
    };
    session.onError = (msg) => {
      status.innerText = msg;
    };

    const doJoin = () => {
      const raw = input.value.trim();
      if (!raw) return;
      const match = raw.match(/room=([0-9]+)/);
      const code = match ? match[1] : raw;
      status.innerText = '加入中…';
      session.joinRoom(code, c.name);
    };
    joinBtn.onclick = doJoin;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') doJoin();
    };
  }

  private handleMpDisconnect(reason: DisconnectReason) {
    const why = reason === 'hostLeft' ? '房主已离开，房间解散'
      : reason === 'peerLeft' ? '对方已离开' : '连接已断开';
    document.getElementById('mp-autojoin-status')?.remove();
    worldManager.setMirror(null);
    if (this.mpCleanup) {
      this.mpCleanup();
      this.mpCleanup = null;
    }
    if (this.session) {
      this.session.leave();
      this.session = null;
    }
    Array.from(this.app.children).forEach(child => {
      if (child instanceof HTMLElement && child.id !== 'game-container') {
        child.style.display = '';
      }
    });
    alert(`联机结束：${why}`);
  }

  private showLevelSelect(initialLevelIndex: number = 0, initialWorldPos?: {x: number, y: number}, session?: MultiplayerSession) {
    // Hide menu elements
    Array.from(this.app.children).forEach(child => {
      if (child instanceof HTMLElement) {
        child.style.display = 'none';
      }
    });

    const levelSelect = new LevelSelect(this.app, (levelIndex, generatedData?, generatedMeta?, specialLevelId?, returnWorldPos?) => {
      levelSelect.destroy();
      if (generatedData && generatedMeta) {
        this.startGeneratedGame(generatedData, generatedMeta);
      } else if (specialLevelId) {
        this.startSpecialGame(specialLevelId, returnWorldPos);
      } else {
        this.startGame(levelIndex);
      }
    }, () => {
      levelSelect.destroy();
      if (session) {
        session.leave();
        worldManager.setMirror(null);
        if (this.session === session) this.session = null;
        this.mpCleanup = null;
      }
      // Show menu elements again
      Array.from(this.app.children).forEach(child => {
        if (child instanceof HTMLElement && child.id !== 'game-container') {
          child.style.display = '';
        }
      });
    }, initialLevelIndex, initialWorldPos, session, session ? (ref, returnPos) => {
      levelSelect.destroy();
      this.startMpGame(session, ref, returnPos);
    } : undefined);

    if (session) {
      this.mpCleanup = () => levelSelect.destroy();
      session.onWorldUpdate = (delta) => worldManager.applyDelta(delta);
      session.onLevelStart = (ref, spawns) => {
        const returnPos = levelSelect.getCatTile();
        levelSelect.destroy();
        this.startMpGame(session, ref, returnPos, spawns);
      };
    }
  }

  private startMpGame(session: MultiplayerSession, ref: LevelRef, returnPos: { x: number; y: number }, spawns?: [Spawn, Spawn]) {
    // Hide menu elements (already hidden when coming from the world map)
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
    gameContainer.style.zIndex = '200';
    this.app.appendChild(gameContainer);

    const controller = new GameController(gameContainer, () => {
      controller.destroy();
      gameContainer.remove();
      this.mpCleanup = null;
      session.sendExit(returnPos.x, returnPos.y);
      this.showLevelSelect(0, returnPos, session);
    }, { session, ref, spawns: spawns ?? null, returnPos });

    this.mpCleanup = () => {
      controller.destroy();
      gameContainer.remove();
    };
    controller.loadMultiplayerLevel(ref);
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

    const controller = new GameController(gameContainer, (lastLevelIndex) => {
      controller.destroy();
      gameContainer.remove();

      if (lastLevelIndex !== undefined) {
        this.showLevelSelect(lastLevelIndex);
      } else {
        // Show menu elements again
        Array.from(this.app.children).forEach(child => {
          if (child instanceof HTMLElement) {
            child.style.display = '';
          }
        });
      }
    });

    controller.loadLevel(levelIndex);
  }

  private startGeneratedGame(data: number[][], meta: GeneratedLevelMeta) {
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
    gameContainer.style.zIndex = '200';
    this.app.appendChild(gameContainer);

    const controller = new GameController(gameContainer, () => {
      controller.destroy();
      gameContainer.remove();
      this.showLevelSelect(0, { x: meta.worldX, y: meta.worldY });
    });

    controller.loadGeneratedLevel(data, meta);
  }

  private startSpecialGame(specialLevelId: string, returnWorldPos?: {x: number, y: number}) {
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
    gameContainer.style.zIndex = '200';
    this.app.appendChild(gameContainer);

    const controller = new GameController(gameContainer, () => {
      controller.destroy();
      gameContainer.remove();
      this.showLevelSelect(0, returnWorldPos);
    });

    controller.loadSpecialLevel(specialLevelId);
  }

  private startAnimation() {
    this.boxLastTime = performance.now();
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

      // Box Physics
      if (!this.isDragging && this.box) {
        const groundY = 600 - 100;
        const boxSize = 50;
        const wallBounce = 0.7;
        const maxSpeed = 1.0; // px/ms
        const now = performance.now();
        const dt = now - this.boxLastTime;
        this.boxLastTime = now;

        if (dt > 0 && dt < 200) { // skip huge gaps (e.g. tab switch)
          // Clamp speed
          this.boxVx = Math.max(-maxSpeed, Math.min(maxSpeed, this.boxVx));
          this.boxV = Math.max(-maxSpeed, Math.min(maxSpeed, this.boxV));

          // Horizontal: move + friction (exponential decay)
          this.boxX += this.boxVx * dt;
          this.boxVx *= Math.pow(0.998, dt);
          if (Math.abs(this.boxVx) < 0.001) this.boxVx = 0;

          // Bounce off left/right edges
          if (this.boxX < 0) {
            this.boxX = 0;
            this.boxVx = -this.boxVx * wallBounce;
          } else if (this.boxX > 800 - boxSize) {
            this.boxX = 800 - boxSize;
            this.boxVx = -this.boxVx * wallBounce;
          }

          // Vertical: gravity + move
          this.boxV += this.boxA * dt;
          this.boxY += this.boxV * dt;

          // Bounce off top
          if (this.boxY < 0) {
            this.boxY = 0;
            this.boxV = -this.boxV * wallBounce;
          }

          // Hit ground: stop
          if (this.boxY >= groundY) {
            this.boxY = groundY;
            this.boxV = 0;
            this.boxVx = 0;
          }
        }

        this.box.style.left = `${this.boxX}px`;
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
    this.bgm = new Audio('/assets/music/main.m4a');
    this.bgm.loop = true;
    this.bgm.volume = settingsManager.currentSettings.volume / 100;
    // Autoplay might be blocked by browser, usually needs user interaction
    document.addEventListener('click', () => {
      this.bgm?.play().catch(() => {});
    }, { once: true });
  }

  destroy() {
    this._specialDayEffect?.cleanup();
  }
}
