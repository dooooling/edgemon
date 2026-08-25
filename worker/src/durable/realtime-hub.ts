import { DurableObject } from 'cloudflare:workers';
import { verifySession } from '../services/crypto';

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

    // 1. Verify Authorization on WebSocket Upgrade Request
    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/edgemon_session=([^;]+)/);
    let isAuthenticated = false;
    if (match) {
      const token = match[1];
      const sessionSecret = (this.env as any).SESSION_SECRET || 'default-session-secret-change-me';
      const payloadStr = await verifySession(token, sessionSecret);
      if (payloadStr) {
        try {
          const data = JSON.parse(payloadStr);
          if (data.expires_at_ms && data.expires_at_ms > Date.now()) {
            isAuthenticated = true;
          }
        } catch {
          // ignore
        }
      }
    }

    // 2. Tag assignments with Hibernation
    const tags: string[] = [];
    if (scope === 'node' && nodeId) {
      // All viewers receive node detail broadcasts
      tags.push(`node:view:${nodeId}`);
      // ONLY authenticated admin sessions trigger high-frequency 2s realtime lease
      if (isAuthenticated) {
        tags.push(`node:watch:${nodeId}`);
      }
    } else {
      tags.push('overview');
    }

    this.ctx.acceptWebSocket(server, tags);

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

    // 2. Broadcast to specific node viewers
    await this.broadcast(`node:view:${nodeId}`, payload);

    // 3. Check if any authorized active detail watchers exist
    const authorizedWatchers = this.ctx.getWebSockets(`node:watch:${nodeId}`);
    return { detailWatched: authorizedWatchers.length > 0 };
  }
}
