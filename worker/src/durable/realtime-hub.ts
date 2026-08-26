import { DurableObject } from 'cloudflare:workers';
import {
  AgentEnvelope,
  HelloPayload,
  ReportPayload,
  ConfigAckData,
  ServerEnvelope,
  WelcomeData,
  ConfigData,
  AckData,
  ErrorData,
  ServerConfig,
  CloseCodes,
} from '../protocol/types';
import { updateNodeMetadataFromHello } from '../db/nodes';
import { NormalizedGeo } from '../services/geo';
import {
  AgentAttachment,
  createDefaultAttachment,
  ingestReportCore,
} from '../services/ingest';
import { loadTrafficRuntimeState } from '../db/traffic';
import { verifyAdminSession } from '../services/session';

export interface Env {
  DB: D1Database;
  REALTIME: DurableObjectNamespace;
  ADMIN_KEY?: string;
  SESSION_SECRET?: string;
  DATA_ENCRYPTION_KEY?: string;
}

export interface BrowserAttachment {
  kind: 'browser';
  authenticated: boolean;
}

type SocketAttachment = AgentAttachment | BrowserAttachment;

export class RealtimeHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    const url = new URL(request.url);
    const role = url.searchParams.get('role') || 'browser';

    if (role === 'agent') {
      const internalAuth = request.headers.get('X-Internal-Agent-Auth');
      if (internalAuth !== 'verified-by-worker') {
        return new Response('Forbidden: Direct agent role upgrade on DO prohibited', { status: 403 });
      }

      const nodeId = url.searchParams.get('node_id');
      const nodeName = url.searchParams.get('node_name') || 'Unknown Node';
      const instanceId = url.searchParams.get('instance_id');
      const trafficResetDay = parseInt(url.searchParams.get('traffic_reset_day') || '1', 10);
      const isHidden = url.searchParams.get('is_hidden') === '1';
      const geoJson = url.searchParams.get('geo_json');
      const geo: NormalizedGeo = geoJson ? JSON.parse(geoJson) : { edge_rtt_ms: null, edge_transport: null };

      if (!nodeId || !instanceId) {
        return new Response('Missing Agent connection parameters', { status: 400 });
      }

      const now = Date.now();
      const attachment: AgentAttachment = createDefaultAttachment(
        nodeId,
        nodeName,
        instanceId,
        now,
        geo,
        trafficResetDay,
        isHidden
      );

      // Hibernation accept with Agent tags
      const tags = ['role:agent', `agent:${nodeId}`];
      this.ctx.acceptWebSocket(server, tags);
      server.serializeAttachment(attachment);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // Role === 'browser'
    const cookieHeader = request.headers.get('Cookie');
    const isAuthenticated = await verifyAdminSession(cookieHeader, this.env.SESSION_SECRET);

    const browserAttachment: BrowserAttachment = {
      kind: 'browser',
      authenticated: isAuthenticated,
    };

    const browserTags = ['role:browser'];
    if (isAuthenticated) {
      browserTags.push('role:browser:admin');
    } else {
      browserTags.push('role:browser:public');
    }

    this.ctx.acceptWebSocket(server, browserTags);
    server.serializeAttachment(browserAttachment);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const rawAttachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!rawAttachment) {
      ws.close(CloseCodes.POLICY_VIOLATION, 'Missing connection state');
      return;
    }

    if (rawAttachment.kind === 'agent') {
      await this.handleAgentMessage(ws, rawAttachment, message);
    }
  }

  private async handleAgentMessage(
    ws: WebSocket,
    attachment: AgentAttachment,
    message: string | ArrayBuffer
  ): Promise<void> {
    const byteLength = typeof message === 'string'
      ? new TextEncoder().encode(message).byteLength
      : (message instanceof ArrayBuffer ? message.byteLength : 0);

    // Frame size guard (max 64KB for batch report and control frames)
    if (byteLength > 65536) {
      ws.close(CloseCodes.MESSAGE_TOO_BIG, 'Frame exceeds 64KB limit');
      return;
    }

    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);

    let envelope: AgentEnvelope;
    try {
      envelope = JSON.parse(text);
      if (envelope.v !== 1 || !envelope.type || !envelope.instance_id) {
        this.sendError(ws, 'INVALID_ENVELOPE', 'Envelope v must be 1 with valid type and instance_id');
        return;
      }
    } catch {
      this.sendError(ws, 'INVALID_JSON', 'Failed to parse JSON envelope');
      return;
    }

    // Instance verification
    if (envelope.instance_id !== attachment.instance_id) {
      this.sendError(ws, 'INSTANCE_MISMATCH', 'Message instance_id does not match upgrade handshake');
      return;
    }

    const now = Date.now();

    // 1. HELLO MESSAGE (Must be first message and single-shot)
    if (envelope.type === 'hello') {
      if (attachment.hello_ok) {
        this.sendError(ws, 'DUPLICATE_HELLO', 'Hello handshake already completed for this connection', envelope.seq);
        return;
      }

      const helloData = envelope.data as HelloPayload;
      const nodeId = attachment.node_id;

      // Close ANY existing socket for this node (even if same instance_id to prevent duplicates)
      const existingSockets = this.ctx.getWebSockets(`agent:${nodeId}`);
      for (const existing of existingSockets) {
        if (existing !== ws) {
          try {
            existing.close(CloseCodes.REPLACED_BY_NEW_INSTANCE, 'Replaced by newer connection');
          } catch {
            // ignore
          }
        }
      }

      await updateNodeMetadataFromHello(this.env.DB, nodeId, helloData, attachment.geo);

      // Update active instance fields in D1
      await this.env.DB
        .prepare(
          `UPDATE nodes SET
            active_instance_id = ?,
            active_instance_started_at_ms = ?,
            last_stream_connected_at_ms = ?,
            updated_at_ms = ?
          WHERE id = ?`
        )
        .bind(attachment.instance_id, now, now, now, nodeId)
        .run();

      // Load latest config
      const configRow = await this.env.DB
        .prepare('SELECT revision, config_json FROM node_config WHERE node_id = ?')
        .bind(nodeId)
        .first<{ revision: number; config_json: string }>();

      const serverConfig: ServerConfig = configRow
        ? JSON.parse(configRow.config_json)
        : {
            sample_interval_sec: 2,
            stream_interval_sec: 2,
            probe_interval_sec: 60,
            network_interface: 'auto',
            probes: [],
          };

      // Hydrate previous traffic & counter baselines from D1 node_state
      const stateRow = await this.env.DB
        .prepare(
          'SELECT rx_total_bytes, tx_total_bytes, network_counter_id, persisted_at_ms, persisted_instance_id, persisted_sample_seq FROM node_state WHERE node_id = ?'
        )
        .bind(nodeId)
        .first<{
          rx_total_bytes: number;
          tx_total_bytes: number;
          network_counter_id: string | null;
          persisted_at_ms: number;
          persisted_instance_id: string | null;
          persisted_sample_seq: number;
        }>();

      if (stateRow) {
        attachment.last_rx_total_bytes = stateRow.rx_total_bytes;
        attachment.last_tx_total_bytes = stateRow.tx_total_bytes;
        attachment.last_counter_id = stateRow.network_counter_id;
        attachment.last_persist_bucket_ms = Math.floor((stateRow.persisted_at_ms || 0) / 60000) * 60000;
        // P0-1: Only restore watermark if state.persisted_instance_id === current instance_id!
        if (stateRow.persisted_instance_id === attachment.instance_id && stateRow.persisted_sample_seq) {
          attachment.persisted_sample_seq = stateRow.persisted_sample_seq;
        } else {
          attachment.persisted_sample_seq = 0;
        }
      }

      attachment.traffic_state = await loadTrafficRuntimeState(
        this.env.DB,
        attachment.node_id,
        attachment.traffic_reset_day
      );

      attachment.hello_ok = true;
      attachment.config_rev = configRow?.revision || 1;
      attachment.last_seq = envelope.seq;
      ws.serializeAttachment(attachment);

      const isSameInstance = stateRow?.persisted_instance_id === attachment.instance_id;
      const welcomeEnvelope: ServerEnvelope<WelcomeData> = {
        v: 1,
        type: 'welcome',
        instance_id: attachment.instance_id,
        seq: envelope.seq,
        ts_ms: now,
        data: {
          config_rev: attachment.config_rev,
          config: serverConfig,
          persisted_instance_id: stateRow?.persisted_instance_id || null,
          persisted_sample_seq: isSameInstance ? (stateRow?.persisted_sample_seq || 0) : 0,
        },
      };

      ws.send(JSON.stringify(welcomeEnvelope));
      return;
    }

    // Guard: hello must precede all other messages
    if (!attachment.hello_ok) {
      ws.close(CloseCodes.POLICY_VIOLATION, 'Hello handshake required before reporting');
      return;
    }

    // Sequence verification (allow seq == last_seq for idempotent retry)
    if (envelope.seq < attachment.last_seq) {
      this.sendError(
        ws,
        'NON_MONOTONIC_SEQ',
        `Envelope seq ${envelope.seq} is less than last acknowledged seq ${attachment.last_seq}`,
        envelope.seq
      );
      return;
    }

    // 2. REPORT MESSAGE
    if (envelope.type === 'report') {
      const reportData = envelope.data as ReportPayload;
      const nodeId = attachment.node_id;

      const { result, updatedAttachment } = await ingestReportCore(
        this.env.DB,
        nodeId,
        attachment.node_name,
        attachment.instance_id,
        envelope.seq,
        reportData,
        attachment.geo,
        attachment,
        attachment.traffic_reset_day,
        attachment.is_hidden
      );

      if (!result.accepted) {
        if (result.error === 'PERSISTENCE_FAILED') {
          ws.close(CloseCodes.SERVER_RECONNECT, 'D1 persistence failure, force replay');
        } else {
          this.sendError(ws, result.error || 'REPORT_REJECTED', 'Report failed validation', envelope.seq);
        }
        return;
      }

      // Save updated attachment state in WebSocket Hibernation
      ws.serializeAttachment(updatedAttachment);

      // Realtime 0~2s broadcast (Public nodes to all browsers, hidden nodes to Admin browsers only!)
      if (result.livePayload) {
        this.broadcastToBrowsers(result.livePayload, attachment.is_hidden);
      }

      // Low-frequency ACK on 60s Checkpoint
      if (result.persisted) {
        const ackEnvelope: ServerEnvelope<AckData> = {
          v: 1,
          type: 'ack',
          instance_id: attachment.instance_id,
          seq: envelope.seq,
          ts_ms: now,
          data: {
            persisted_sample_seq: result.persisted_sample_seq || updatedAttachment.persisted_sample_seq || 0,
            config_rev: updatedAttachment.config_rev,
            accepted_seq: envelope.seq,
            persisted_seq: envelope.seq,
          },
        };
        try {
          ws.send(JSON.stringify(ackEnvelope));
        } catch {
          // Socket write non-blocking
        }
      }
      return;
    }

    // 3. CONFIG_ACK MESSAGE
    if (envelope.type === 'config_ack') {
      const configAckData = envelope.data as ConfigAckData;
      attachment.config_rev = configAckData.config_rev;
      attachment.last_seq = envelope.seq;
      ws.serializeAttachment(attachment);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Note: Do NOT call ws.close() inside webSocketClose callback!
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment && attachment.kind === 'agent') {
      const now = Date.now();
      try {
        await this.env.DB
          .prepare('UPDATE nodes SET last_stream_disconnected_at_ms = ? WHERE id = ?')
          .bind(now, attachment.node_id)
          .run();
      } catch {
        // Best-effort update on close
      }
    }
  }

  private sendError(ws: WebSocket, code: string, message: string, seq = 0): void {
    const errorEnvelope: ServerEnvelope<ErrorData> = {
      v: 1,
      type: 'error',
      instance_id: '',
      seq,
      ts_ms: Date.now(),
      data: { code, message },
    };
    try {
      ws.send(JSON.stringify(errorEnvelope));
    } catch {
      // ignore
    }
  }

  private broadcastToBrowsers(payload: unknown, isHidden = false): void {
    const message = JSON.stringify(payload);
    // Hidden nodes broadcast ONLY to authenticated admin browsers!
    const targetTag = isHidden ? 'role:browser:admin' : 'role:browser';
    const browsers = this.ctx.getWebSockets(targetTag);
    for (const ws of browsers) {
      try {
        ws.send(message);
      } catch {
        // Closed socket will be cleaned by hibernation
      }
    }
  }

  // --- RPC Methods callable from Worker endpoints ---

  async pushConfig(nodeId: string, config: ServerConfig, revision: number): Promise<boolean> {
    const sockets = this.ctx.getWebSockets(`agent:${nodeId}`);
    if (sockets.length === 0) return false;

    const configEnvelope: ServerEnvelope<ConfigData> = {
      v: 1,
      type: 'config',
      instance_id: '',
      seq: 0,
      ts_ms: Date.now(),
      data: {
        config_rev: revision,
        config,
      },
    };

    const message = JSON.stringify(configEnvelope);
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch {
        // ignore
      }
    }
    return true;
  }

  async disconnectAgent(nodeId: string, code = CloseCodes.TOKEN_REVOKED, reason = 'TOKEN_REVOKED'): Promise<void> {
    const sockets = this.ctx.getWebSockets(`agent:${nodeId}`);
    for (const ws of sockets) {
      try {
        ws.close(code, reason);
      } catch {
        // ignore
      }
    }
  }

  async ingestFallback(
    nodeId: string,
    nodeName: string,
    instanceId: string,
    seq: number,
    report: ReportPayload,
    geo: NormalizedGeo,
    trafficResetDay = 1,
    isHidden = false
  ): Promise<{ accepted: boolean; persisted: boolean; error?: string }> {
    const now = Date.now();
    const syntheticAttachment = createDefaultAttachment(
      nodeId,
      nodeName,
      instanceId,
      now,
      geo,
      trafficResetDay,
      isHidden
    );
    syntheticAttachment.hello_ok = true;

    // Hydrate previous state from D1 node_state
    const stateRow = await this.env.DB
      .prepare('SELECT agent_instance_id, rx_total_bytes, tx_total_bytes, network_counter_id, persisted_at_ms, last_seq, persisted_instance_id, persisted_sample_seq FROM node_state WHERE node_id = ?')
      .bind(nodeId)
      .first<{
        agent_instance_id: string | null;
        rx_total_bytes: number;
        tx_total_bytes: number;
        network_counter_id: string | null;
        persisted_at_ms: number;
        last_seq: number;
        persisted_instance_id: string | null;
        persisted_sample_seq: number;
      }>();

    if (stateRow) {
      // Only restore last_seq and persisted_sample_seq if instance ID matches (prevent new instance restart from failing monotonic seq check)
      syntheticAttachment.last_seq = stateRow.agent_instance_id === instanceId ? (stateRow.last_seq || 0) : 0;
      syntheticAttachment.persisted_sample_seq = stateRow.persisted_instance_id === instanceId ? (stateRow.persisted_sample_seq || 0) : 0;
      syntheticAttachment.last_rx_total_bytes = stateRow.rx_total_bytes;
      syntheticAttachment.last_tx_total_bytes = stateRow.tx_total_bytes;
      syntheticAttachment.last_counter_id = stateRow.network_counter_id;
      syntheticAttachment.last_persist_bucket_ms = Math.floor((stateRow.persisted_at_ms || 0) / 60000) * 60000;
    }

    syntheticAttachment.traffic_state = await loadTrafficRuntimeState(
      this.env.DB,
      nodeId,
      trafficResetDay
    );

    const { result } = await ingestReportCore(
      this.env.DB,
      nodeId,
      nodeName,
      instanceId,
      seq,
      report,
      geo,
      syntheticAttachment,
      trafficResetDay,
      isHidden
    );

    if (result.accepted && result.livePayload) {
      this.broadcastToBrowsers(result.livePayload, isHidden);
    }

    return result;
  }
}
