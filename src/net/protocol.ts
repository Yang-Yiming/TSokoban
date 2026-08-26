import type { GeneratedLevelMeta } from '../game/puzzleGenerator';
import type { Equipment } from '../game/types';

export type Dir = 'front' | 'back' | 'left' | 'right';

export type Spawn = { x: number; y: number };

/** World-truth snapshot the host sends to joiners (decision: world vs player save split). */
export interface WorldFlags {
  completedLevels: number[];
  chestOpened: boolean;
  completedGeneratedLevels: string[];
}

/** Reference to a level — both clients can build the identical map from it. */
export type LevelRef =
  | { kind: 'handcrafted'; index: number }
  | { kind: 'special'; id: string }
  | { kind: 'generated'; x: number; y: number; data: number[][]; meta: GeneratedLevelMeta };

/** Host → guest: one change to the world save (guests apply it to their mirror). */
export type WorldDelta =
  | { t: 'levelCompleted'; index: number }
  | { t: 'chestOpened' }
  | { t: 'generatedCompleted'; x: number; y: number };

/** Game-level messages relayed through the server (server treats them as opaque). */
export type GamePayload =
  // ---- overworld ----
  | { t: 'pos'; x: number; y: number; dir: Dir; equipment: Equipment }
  | { t: 'enter'; x: number; y: number }
  | { t: 'exit'; x: number; y: number }
  | { t: 'equip'; equipment: Equipment }
  // ---- ready-check ----
  | { t: 'readyReq'; ref: LevelRef }
  | { t: 'readyCancel' }
  | { t: 'readyAck'; ok: boolean }
  | { t: 'levelStart'; ref: LevelRef; spawns: [Spawn, Spawn] }
  // ---- in-level ----
  | { t: 'move'; dx: number; dy: number }
  | { t: 'win' }
  | { t: 'restart' }
  // ---- world save deltas (host only) ----
  | { t: 'worldUpdate'; delta: WorldDelta };

// ---- transport (client <-> server) ----

export type ClientTransportMsg =
  | { t: 'create'; seed: string; world: WorldFlags; name: string }
  | { t: 'join'; room: string; name: string }
  | { t: 'relay'; p: GamePayload }
  | { t: 'bye' };

export type ServerTransportMsg =
  | {
      t: 'joined';
      room: string;
      id: number;
      isHost: boolean;
      seed: string;
      world: WorldFlags | null;
      players: { id: number; name: string }[];
    }
  | { t: 'peerJoined'; peer: { id: number; name: string } }
  | { t: 'peerLeft'; id: number }
  | { t: 'hostLeft' }
  | { t: 'error'; msg: string }
  | { t: 'relay'; from: number; p: GamePayload };

export const PEER_TINT = 'sepia(1) saturate(3) hue-rotate(150deg)';
export const READY_TIMEOUT_MS = 15000;
