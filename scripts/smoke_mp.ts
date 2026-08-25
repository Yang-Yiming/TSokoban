/**
 * Smoke test for server/room.ts — exercises create/join/relay/dissolve
 * plus static file serving. Run: bun run test:mp
 */
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 8791);
const serverPath = path.resolve(import.meta.dir, '../server/room.ts');
const proc = Bun.spawn(['bun', serverPath], {
  env: { ...process.env, PORT: String(PORT) },
  stdout: 'pipe',
  stderr: 'pipe',
});
await new Promise((r) => setTimeout(r, 800));

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures++;
}

class Client {
  ws: WebSocket;
  private queue: any[] = [];
  private waiters: ((m: any) => void)[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      const w = this.waiters.shift();
      if (w) w(msg);
      else this.queue.push(msg);
    };
  }

  next(timeoutMs = 2000): Promise<any> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
      this.waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }

  send(obj: object) {
    this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.ws.onmessage = null;
    this.ws.close();
  }
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/room`);
    ws.onopen = () => resolve(new Client(ws));
    ws.onerror = () => reject(new Error('ws error'));
  });
}

try {
  // Static hosting
  const page = await fetch(`http://localhost:${PORT}/`);
  const html = await page.text();
  check('GET / serves index.html', page.status === 200 && html.includes('<html'));
  const missing = await fetch(`http://localhost:${PORT}/nope.js`);
  check('missing asset -> 404', missing.status === 404);

  // Host creates room
  const host = await connect();
  host.send({ t: 'create', seed: '53', world: { completedLevels: [0], chestOpened: false, completedGeneratedLevels: [] }, name: 'P1' });
  const joined1 = await host.next();
  check('host receives joined', joined1.t === 'joined' && joined1.isHost === true && joined1.seed === '53');
  check('world flags passed through', joined1.world?.completedLevels?.[0] === 0);
  const code = joined1.room;

  // Guest joins
  const guest = await connect();
  guest.send({ t: 'join', room: code, name: 'P2' });
  const joined2 = await guest.next();
  const peerJoined = await host.next();
  check('guest receives joined', joined2.t === 'joined' && joined2.isHost === false);
  check('guest sees host in players', joined2.players.length === 2);
  check('host notified of peerJoined', peerJoined.t === 'peerJoined' && peerJoined.peer.name === 'P2');

  // Relay both directions
  host.send({ t: 'relay', p: { t: 'pos', x: 3, y: -2, dir: 'front', equipment: 'none' } });
  const r1 = await guest.next();
  check('host->guest relay', r1.t === 'relay' && r1.from === joined1.id && r1.p.t === 'pos' && r1.p.x === 3);

  guest.send({ t: 'relay', p: { t: 'readyReq', ref: { kind: 'handcrafted', index: 0 } } });
  const r2 = await host.next();
  check('guest->host relay', r2.t === 'relay' && r2.p.t === 'readyReq');

  // Room cap (3rd client rejected)
  const third = await connect();
  third.send({ t: 'join', room: code, name: 'P3' });
  const err = await third.next();
  check('third client rejected (room full)', err.t === 'error');

  // Bad room code
  const stranger = await connect();
  stranger.send({ t: 'join', room: '9999', name: 'X' });
  const err2 = await stranger.next();
  check('unknown room -> error', err2.t === 'error' && /不存在/.test(err2.msg));

  // Host leaves -> room dissolves, guest gets hostLeft
  host.close();
  const hostLeft = await guest.next();
  check('host leaving dissolves room', hostLeft.t === 'hostLeft');

  // Guest leaving (non-host) -> peerLeft
  const h2 = await connect();
  h2.send({ t: 'create', seed: '1', world: null, name: 'P1' });
  const h2Joined = await h2.next();
  const g2 = await connect();
  g2.send({ t: 'join', room: h2Joined.room, name: 'P2' });
  await g2.next();
  await h2.next(); // peerJoined on host
  g2.close();
  const peerLeft = await h2.next();
  check('guest leaving -> peerLeft', peerLeft.t === 'peerLeft');

  host.close(); guest.close(); third.close(); stranger.close(); h2.close();
} catch (e) {
  failures++;
  console.log('❌ unexpected error:', e);
}

proc.kill();
setTimeout(() => process.exit(failures ? 1 : 0), 200);
