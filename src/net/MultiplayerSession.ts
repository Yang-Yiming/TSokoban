import { NetClient } from './NetClient';
import type { JoinedInfo } from './NetClient';
import {
  READY_TIMEOUT_MS,
} from './protocol';
import type {
  Dir,
  GamePayload,
  LevelRef,
  Spawn,
  WorldFlags,
} from './protocol';
import { MAP_DATA, SPECIAL_LEVEL_LIBRARY } from '../game/mapData';
import { TILE_MASK } from '../game/types';
import type { Equipment } from '../game/types';

export interface PeerWorldState {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  equipment: Equipment;
  inLevel: boolean;
}

export type DisconnectReason = 'hostLeft' | 'peerLeft' | 'connectionLost';

interface PendingReady {
  ref: LevelRef;
  initiator: boolean;
  timer: ReturnType<typeof setTimeout>;
}

const key = (x: number, y: number) => `${x},${y}`;

/** Build the raw grid a LevelRef refers to (both clients agree deterministically). */
function gridFor(ref: LevelRef): number[][] {
  if (ref.kind === 'handcrafted') return MAP_DATA[ref.index];
  if (ref.kind === 'special') return SPECIAL_LEVEL_LIBRARY[ref.id]?.data ?? [];
  return ref.data;
}

/**
 * Spawns for a shared level session: host at the map's default player tile,
 * guest at the nearest connected free tile (fallback: overlap on the same tile).
 */
export function computeSpawns(ref: LevelRef): [Spawn, Spawn] {
  const grid = gridFor(ref);
  let start: Spawn | null = null;
  for (let y = 0; y < grid.length && !start; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] & TILE_MASK.PLAYER) {
        start = { x, y };
        break;
      }
    }
  }
  if (!start) return [{ x: 1, y: 1 }, { x: 1, y: 1 }];

  const height = grid.length;
  const width = grid[0].length;
  const visited = new Set<string>([key(start.x, start.y)]);
  const queue: Spawn[] = [start];
  let best: Spawn | null = null;

  while (queue.length > 0 && !best) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (visited.has(key(nx, ny))) continue;
      visited.add(key(nx, ny));
      if (grid[ny][nx] & TILE_MASK.WALL) continue;
      const cell: Spawn = { x: nx, y: ny };
      if (!(grid[ny][nx] & TILE_MASK.BOX)) {
        best = cell; // nearest connected free tile (BFS order)
        break;
      }
      queue.push(cell);
    }
  }

  return [start, best ?? start];
}

/**
 * One multiplayer session (one room). Owns the socket, roles, peer world
 * state, the ready-check handshake and in-level message routing.
 *
 * Rules encoded here:
 *  - levelStart is always sent by the host; both sides enter upon it
 *  - guest cat is the tinted one (visible on both screens)
 *  - disconnect dissolves the session (整局作废)
 */
export class MultiplayerSession {
  readonly net = new NetClient();

  myId = -1;
  peerId = -1;
  isHost = false;
  roomCode = '';
  seed = '0';
  /** Guest only: world truth snapshot from the host. */
  worldFlags: WorldFlags | null = null;
  /** True once joined (both lobby & in-game). */
  active = false;
  /** Peer overworld state; null until the first pos/enter message arrives. */
  peer: PeerWorldState | null = null;

  // ---- callbacks assigned by UI layers ----
  onJoined: (info: JoinedInfo) => void = () => {};
  onPeerJoined: (peer: { id: number; name: string }) => void = () => {};
  onPeerWorldUpdate: (peer: PeerWorldState) => void = () => {};
  onReadyPrompt: (ref: LevelRef) => void = () => {};
  onReadyCancelled: () => void = () => {};
  onLevelStart: (ref: LevelRef, spawns: [Spawn, Spawn]) => void = () => {};
  onPeerMove: (dx: number, dy: number) => void = () => {};
  onPeerWin: () => void = () => {};
  onPeerRestart: () => void = () => {};
  onDisconnected: (reason: DisconnectReason) => void = () => {};
  onError: (msg: string) => void = () => {};

  private ready: PendingReady | null = null;
  private closedByUs = false;

  get isGuest(): boolean {
    return !this.isHost;
  }

  // ---- lifecycle ----

  createRoom(seed: string, world: WorldFlags): void {
    this.seed = seed;
    this.net.connect({
      onJoined: (info) => this.handleJoined(info),
      onPeerJoined: (peer) => {
        this.peerId = peer.id;
        this.peer = null;
        this.onPeerJoined(peer);
      },
      onRelay: (from, p) => this.handlePayload(from, p),
      onHostLeft: () => this.handleDisconnect('hostLeft'),
      onPeerLeft: () => this.handleDisconnect('peerLeft'),
      onClose: () => this.handleDisconnect('connectionLost'),
      onError: (msg) => this.onError(msg),
    });
    this.net.send({ t: 'create', seed, world, name: 'P1' });
  }

  joinRoom(room: string): void {
    this.net.connect({
      onJoined: (info) => this.handleJoined(info),
      onPeerJoined: (peer) => {
        this.peerId = peer.id;
        this.peer = null;
        this.onPeerJoined(peer);
      },
      onRelay: (from, p) => this.handlePayload(from, p),
      onHostLeft: () => this.handleDisconnect('hostLeft'),
      onPeerLeft: () => this.handleDisconnect('peerLeft'),
      onClose: () => this.handleDisconnect('connectionLost'),
      onError: (msg) => this.onError(msg),
    });
    this.net.send({ t: 'join', room, name: 'P2' });
  }

  /** Graceful leave (user backed out to the main menu). */
  leave(): void {
    this.cancelReadyLocal();
    this.closedByUs = true;
    this.net.close();
    this.active = false;
    this.peer = null;
  }

  private handleJoined(info: JoinedInfo) {
    this.myId = info.id;
    this.isHost = info.isHost;
    this.roomCode = info.room;
    this.seed = info.seed;
    this.worldFlags = info.world;
    this.peerId = info.players.map((p) => p.id).find((id) => id !== info.id) ?? -1;
    this.active = true;
    this.onJoined(info);
  }

  private handleDisconnect(reason: DisconnectReason) {
    if (this.closedByUs || !this.active) return;
    this.cancelReadyLocal();
    this.active = false;
    this.onDisconnected(reason);
  }

  // ---- overworld ----

  sendPos(x: number, y: number, dir: Dir, equipment: Equipment): void {
    this.net.relay({ t: 'pos', x, y, dir, equipment });
  }

  sendEnter(x: number, y: number): void {
    this.net.relay({ t: 'enter', x, y });
  }

  sendExit(x: number, y: number): void {
    this.net.relay({ t: 'exit', x, y });
  }

  sendEquip(equipment: Equipment): void {
    this.net.relay({ t: 'equip', equipment });
  }

  // ---- ready-check ----

  /** I pressed Enter on a shared tile and want to start the handshake. */
  requestReady(ref: LevelRef): boolean {
    if (this.ready || !this.active || this.peerId < 0) return false;
    const timer = setTimeout(() => this.cancelReady(), READY_TIMEOUT_MS);
    this.ready = { ref, initiator: true, timer };
    this.net.relay({ t: 'readyReq', ref });
    return true;
  }

  /** Initiator gave up waiting. */
  cancelReady(): void {
    if (!this.ready?.initiator) return;
    this.net.relay({ t: 'readyCancel' });
    this.cancelReadyLocal();
  }

  /** I accepted the peer's request. Host immediately starts the level. */
  acceptReady(): void {
    const pending = this.ready;
    if (!pending || pending.initiator) return;
    this.clearReady();
    if (this.isHost) {
      const spawns = computeSpawns(pending.ref);
      this.net.relay({ t: 'readyAck', ok: true });
      this.net.relay({ t: 'levelStart', ref: pending.ref, spawns });
      this.onLevelStart(pending.ref, spawns);
    } else {
      this.net.relay({ t: 'readyAck', ok: true });
    }
  }

  /** I declined the peer's request. */
  declineReady(): void {
    const pending = this.ready;
    if (!pending || pending.initiator) return;
    this.clearReady();
    this.net.relay({ t: 'readyAck', ok: false });
  }

  private cancelReadyLocal(): void {
    if (this.ready) this.clearReady();
    this.onReadyCancelled();
  }

  private clearReady(): void {
    if (this.ready?.timer) clearTimeout(this.ready.timer);
    this.ready = null;
  }

  // ---- in-level ----

  sendMove(dx: number, dy: number): void {
    this.net.relay({ t: 'move', dx, dy });
  }

  sendWin(): void {
    this.net.relay({ t: 'win' });
  }

  sendRestart(): void {
    this.net.relay({ t: 'restart' });
  }

  // ---- routing ----

  private handlePayload(from: number, p: GamePayload): void {
    if (from !== this.peerId) return;

    switch (p.t) {
      // overworld
      case 'pos': {
        this.peer = {
          id: from, x: p.x, y: p.y, dir: p.dir,
          equipment: p.equipment, inLevel: false,
        };
        this.onPeerWorldUpdate(this.peer);
        break;
      }
      case 'enter': {
        if (this.peer) {
          this.peer.inLevel = true;
          this.peer.x = p.x;
          this.peer.y = p.y;
          this.onPeerWorldUpdate(this.peer);
        }
        break;
      }
      case 'exit': {
        if (this.peer) {
          this.peer.inLevel = false;
          this.peer.x = p.x;
          this.peer.y = p.y;
          this.onPeerWorldUpdate(this.peer);
        }
        break;
      }
      case 'equip': {
        if (this.peer) {
          this.peer.equipment = p.equipment;
          this.onPeerWorldUpdate(this.peer);
        }
        break;
      }

      // ready-check
      case 'readyReq': {
        if (this.ready) {
          // Both pressed Enter at once — auto-accept theirs, drop mine.
          this.clearReady();
          if (this.isHost) {
            const spawns = computeSpawns(p.ref);
            this.net.relay({ t: 'readyAck', ok: true });
            this.net.relay({ t: 'levelStart', ref: p.ref, spawns });
            this.onLevelStart(p.ref, spawns);
          } else {
            this.net.relay({ t: 'readyAck', ok: true });
          }
        } else {
          const timer = setTimeout(() => {
            // Initiator never cancelled and we never answered — dismiss quietly.
            if (this.ready && !this.ready.initiator) this.clearReady();
          }, READY_TIMEOUT_MS);
          this.ready = { ref: p.ref, initiator: false, timer };
          this.onReadyPrompt(p.ref);
        }
        break;
      }
      case 'readyCancel': {
        // Only the initiator sends readyCancel, so only the acceptor receives it.
        if (this.ready && !this.ready.initiator) {
          this.clearReady();
          this.onReadyCancelled();
        }
        break;
      }
      case 'readyAck': {
        if (this.ready?.initiator) {
          if (p.ok) {
            // Keep waiting for levelStart (host sends it right after).
            if (!this.isHost) return;
            const spawns = computeSpawns(this.ready.ref);
            const ref = this.ready.ref;
            this.clearReady();
            this.net.relay({ t: 'levelStart', ref, spawns });
            this.onLevelStart(ref, spawns);
          } else {
            this.clearReady();
            this.onReadyCancelled();
          }
        }
        break;
      }
      case 'levelStart': {
        if (this.ready) this.clearReady();
        this.onLevelStart(p.ref, p.spawns);
        break;
      }

      // in-level
      case 'move': this.onPeerMove(p.dx, p.dy); break;
      case 'win': this.onPeerWin(); break;
      case 'restart': this.onPeerRestart(); break;
    }
  }
}
