/**
 * TSokoban LAN multiplayer server.
 *
 * Dumb relay: manages room membership and broadcasts game messages.
 * It understands nothing about the game itself — all game logic lives
 * in the clients (the world and levels are deterministic from a seed).
 *
 * Also serves the built static site from ../dist so players only need
 * a browser and the host's LAN address.
 *
 * Usage:
 *   bun run build     # once, to produce dist/
 *   bun run server    # starts on :8787, prints join URLs
 */
import { hostname, networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const DIST_DIR = path.resolve(import.meta.dir, '../dist');
const MAX_PLAYERS_PER_ROOM = 2;

interface Member {
  id: number;
  name: string;
  ws: any;
}

interface Room {
  code: string;
  seed: string;
  world: unknown;
  members: Map<number, Member>; // insertion order: first member is host
}

const rooms = new Map<string, Room>();
let nextClientId = 1;

function randomRoomCode(): string {
  let code: string;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function memberList(room: Room) {
  return [...room.members.values()].map((m) => ({ id: m.id, name: m.name }));
}

function send(ws: any, msg: object) {
  if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: object, exceptId?: number) {
  for (const m of room.members.values()) {
    if (m.id !== exceptId) send(m.ws, msg);
  }
}

function leaveRoom(ws: any) {
  const data = ws.data;
  if (!data.room) return;
  const room = rooms.get(data.room);
  data.room = null;
  if (!room) return;

  // Host = member with the smallest id (first joiner)
  const wasHost = data.id === Math.min(...room.members.keys());
  room.members.delete(data.id);

  if (room.members.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (wasHost) {
    // Host left -> dissolve the room
    broadcast(room, { t: 'hostLeft' });
    rooms.delete(room.code);
  } else {
    broadcast(room, { t: 'peerLeft', id: data.id });
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === '/room') {
      if (server.upgrade(req, {
        data: { id: nextClientId++, room: null as string | null },
      })) {
        return; // upgraded
      }
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // ---- Static files from dist/ ----
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(DIST_DIR, pathname);

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback for extension-less paths
    if (!path.extname(pathname)) {
      return new Response(Bun.file(path.join(DIST_DIR, 'index.html')));
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    open() {},
    message(ws, raw) {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      const data = ws.data;

      switch (msg.t) {
        case 'create': {
          leaveRoom(ws);
          const code = randomRoomCode();
          const room: Room = {
            code,
            seed: String(msg.seed ?? '0'),
            world: msg.world ?? null,
            members: new Map(),
          };
          room.members.set(data.id, { id: data.id, name: String(msg.name ?? 'P1'), ws });
          rooms.set(code, room);
          data.room = code;
          send(ws, {
            t: 'joined',
            room: code,
            id: data.id,
            isHost: true,
            seed: room.seed,
            world: room.world,
            players: memberList(room),
          });
          break;
        }

        case 'join': {
          leaveRoom(ws);
          const room = rooms.get(String(msg.room ?? ''));
          if (!room) {
            send(ws, { t: 'error', msg: '房间不存在或已解散' });
            return;
          }
          if (room.members.size >= MAX_PLAYERS_PER_ROOM) {
            send(ws, { t: 'error', msg: '房间已满' });
            return;
          }
          room.members.set(data.id, { id: data.id, name: String(msg.name ?? 'P2'), ws });
          data.room = room.code;
          send(ws, {
            t: 'joined',
            room: room.code,
            id: data.id,
            isHost: false,
            seed: room.seed,
            world: room.world,
            players: memberList(room),
          });
          broadcast(room, { t: 'peerJoined', peer: { id: data.id, name: String(msg.name ?? 'P2') } }, data.id);
          break;
        }

        case 'relay': {
          if (!data.room) return;
          const room = rooms.get(data.room);
          if (!room || !room.members.has(data.id)) return;
          broadcast(room, { t: 'relay', from: data.id, p: msg.p }, data.id);
          break;
        }

        case 'bye': {
          leaveRoom(ws);
          break;
        }
      }
    },
    close(ws) {
      leaveRoom(ws);
    },
  },
});

// ---- Startup info ----
if (!existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.log('⚠️  未找到 dist/index.html —— 请先运行 `bun run build`，否则网页无法打开（联机服务器仍可用）');
}

const host = hostname().replace(/\.local$/, '');
console.log(`http://${host}.local:${server.port}`);
for (const addrs of Object.values(networkInterfaces())) {
  for (const net of addrs ?? []) {
    if (net.family === 'IPv4' && !net.internal) {
      console.log(`http://${net.address}:${server.port}`);
    }
  }
}
