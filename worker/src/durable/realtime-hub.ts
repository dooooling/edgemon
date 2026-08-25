import { DurableObject } from 'cloudflare:workers';

export interface Env {
  DB: D1Database;
  REALTIME: DurableObjectNamespace;
  ADMIN_KEY?: string;
  SESSION_SECRET?: string;
  DATA_ENCRYPTION_KEY?: string;
}

export class RealtimeHub extends DurableObject {
  // SQLite-backed Durable Object with WebSocket Hibernation support
  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    const url = new URL(request.url);
    const scope = url.searchParams.get('scope') || 'overview';
    const nodeId = url.searchParams.get('id');

    // Register WebSocket with hibernation support
    const tag = scope === 'node' && nodeId ? `node:${nodeId}` : 'overview';
    this.ctx.acceptWebSocket(server, [tag]);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Best-effort message handling
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    ws.close(code, 'Hub closed');
  }

  async broadcast(tag: string, payload: unknown): Promise<void> {
    const sockets = this.ctx.getWebSockets(tag);
    const message = JSON.stringify(payload);
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch {
        // Socket may have closed
      }
    }
  }

  async publishAndCheckDetailWatch(nodeId: string, payload: unknown): Promise<{ detailWatched: boolean }> {
    // 1. Broadcast to overview subscribers
    await this.broadcast('overview', payload);

    // 2. Broadcast to specific node subscribers
    const nodeSockets = this.ctx.getWebSockets(`node:${nodeId}`);
    if (nodeSockets.length > 0) {
      const message = JSON.stringify(payload);
      for (const ws of nodeSockets) {
        try {
          ws.send(message);
        } catch {
          // ignore
        }
      }
      return { detailWatched: true };
    }

    return { detailWatched: false };
  }
}
