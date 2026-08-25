import type { ClientTransportMsg, GamePayload, ServerTransportMsg, WorldFlags } from './protocol';

export interface JoinedInfo {
  room: string;
  id: number;
  isHost: boolean;
  seed: string;
  world: WorldFlags | null;
  players: { id: number; name: string }[];
}

export interface NetClientEvents {
  onJoined(info: JoinedInfo): void;
  onPeerJoined(peer: { id: number; name: string }): void;
  onPeerLeft(id: number): void;
  onHostLeft(): void;
  onRelay(from: number, p: GamePayload): void;
  onError(msg: string): void;
  onClose(): void;
}

/** Thin WebSocket wrapper for the room relay endpoint. */
export class NetClient {
  private ws: WebSocket | null = null;
  private events: Partial<NetClientEvents> = {};
  private pendingOnOpen: ClientTransportMsg[] = [];

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(events: Partial<NetClientEvents>): void {
    this.events = events;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/room`);
    this.ws = ws;

    ws.onopen = () => {
      for (const msg of this.pendingOnOpen) this.send(msg);
      this.pendingOnOpen = [];
    };
    ws.onmessage = (e) => {
      let msg: ServerTransportMsg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      switch (msg.t) {
        case 'joined': this.events.onJoined?.(msg); break;
        case 'peerJoined': this.events.onPeerJoined?.(msg.peer); break;
        case 'peerLeft': this.events.onPeerLeft?.(msg.id); break;
        case 'hostLeft': this.events.onHostLeft?.(); break;
        case 'relay': this.events.onRelay?.(msg.from, msg.p); break;
        case 'error': this.events.onError?.(msg.msg); break;
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.events.onClose?.();
    };
  }

  send(msg: ClientTransportMsg): void {
    if (this.isOpen) {
      this.ws!.send(JSON.stringify(msg));
    } else if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.pendingOnOpen.push(msg);
    }
  }

  relay(p: GamePayload): void {
    this.send({ t: 'relay', p });
  }

  /** Graceful close: tells the server we left before disconnecting. */
  close(): void {
    this.send({ t: 'bye' });
    const ws = this.ws;
    this.ws = null;
    // Detach handlers so onClose side effects don't fire for intentional exits.
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.close();
    }
  }
}
