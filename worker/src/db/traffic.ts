export interface TrafficPeriodRow {
  node_id: string;
  period_start_ms: number;
  finalized_rx_bytes: number;
  finalized_tx_bytes: number;
  active_counter_id: string | null;
  active_rx_base_bytes: number | null;
  active_tx_base_bytes: number | null;
  updated_at_ms: number;
}

export interface TrafficRuntimeState {
  period_start_ms: number;
  finalized_rx_bytes: number;
  finalized_tx_bytes: number;
  active_counter_id: string | null;
  active_rx_base_bytes: number | null;
  active_tx_base_bytes: number | null;
  dirty: boolean;
  prev_period_settlement?: {
    period_start_ms: number;
    finalized_rx_delta: number;
    finalized_tx_delta: number;
  } | null;
}

export function cloneTrafficRuntimeState(state: TrafficRuntimeState): TrafficRuntimeState {
  return {
    period_start_ms: state.period_start_ms,
    finalized_rx_bytes: state.finalized_rx_bytes,
    finalized_tx_bytes: state.finalized_tx_bytes,
    active_counter_id: state.active_counter_id,
    active_rx_base_bytes: state.active_rx_base_bytes,
    active_tx_base_bytes: state.active_tx_base_bytes,
    dirty: state.dirty,
    prev_period_settlement: state.prev_period_settlement
      ? { ...state.prev_period_settlement }
      : null,
  };
}

export function computeBillingPeriodStart(nowMs: number, resetDay = 1): number {
  const date = new Date(nowMs);
  const currentDay = date.getUTCDate();
  const currentMonth = date.getUTCMonth();
  const currentYear = date.getUTCFullYear();

  // Effective reset day for THIS month
  const daysInCurrentMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate();
  const effectiveResetDayThisMonth = Math.min(resetDay, daysInCurrentMonth);

  if (currentDay >= effectiveResetDayThisMonth) {
    // Current period started this month
    return Date.UTC(currentYear, currentMonth, effectiveResetDayThisMonth, 0, 0, 0, 0);
  }

  // Otherwise, current period started in previous month
  let prevMonth = currentMonth - 1;
  let prevYear = currentYear;
  if (prevMonth < 0) {
    prevMonth = 11;
    prevYear -= 1;
  }

  const daysInPrevMonth = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
  const effectiveResetDayPrevMonth = Math.min(resetDay, daysInPrevMonth);

  return Date.UTC(prevYear, prevMonth, effectiveResetDayPrevMonth, 0, 0, 0, 0);
}

export async function getCurrentPeriodTraffic(
  db: D1Database,
  nodeId: string,
  resetDay = 1
): Promise<{ periodStartMs: number; periodRxBytes: number; periodTxBytes: number }> {
  const now = Date.now();
  const periodStartMs = computeBillingPeriodStart(now, resetDay);

  const period = await db
    .prepare('SELECT * FROM traffic_periods WHERE node_id = ? AND period_start_ms = ?')
    .bind(nodeId, periodStartMs)
    .first<TrafficPeriodRow>();

  if (!period) {
    return { periodStartMs, periodRxBytes: 0, periodTxBytes: 0 };
  }

  const state = await db
    .prepare('SELECT rx_total_bytes, tx_total_bytes FROM node_state WHERE node_id = ?')
    .bind(nodeId)
    .first<{ rx_total_bytes: number; tx_total_bytes: number }>();

  const currentRx = state?.rx_total_bytes ?? 0;
  const currentTx = state?.tx_total_bytes ?? 0;

  const activeRx = period.active_rx_base_bytes !== null ? Math.max(0, currentRx - period.active_rx_base_bytes) : 0;
  const activeTx = period.active_tx_base_bytes !== null ? Math.max(0, currentTx - period.active_tx_base_bytes) : 0;

  return {
    periodStartMs,
    periodRxBytes: period.finalized_rx_bytes + activeRx,
    periodTxBytes: period.finalized_tx_bytes + activeTx,
  };
}

/**
 * Loads the latest durable traffic period state from D1 (P0-4).
 * Queries the most recent period row to preserve active base across billing boundaries.
 */
export async function loadTrafficRuntimeState(
  db: D1Database,
  nodeId: string,
  resetDay = 1
): Promise<TrafficRuntimeState> {
  const period = await db
    .prepare('SELECT * FROM traffic_periods WHERE node_id = ? ORDER BY period_start_ms DESC LIMIT 1')
    .bind(nodeId)
    .first<TrafficPeriodRow>();

  if (period) {
    return {
      period_start_ms: period.period_start_ms,
      finalized_rx_bytes: period.finalized_rx_bytes,
      finalized_tx_bytes: period.finalized_tx_bytes,
      active_counter_id: period.active_counter_id,
      active_rx_base_bytes: period.active_rx_base_bytes,
      active_tx_base_bytes: period.active_tx_base_bytes,
      dirty: false,
    };
  }

  const now = Date.now();
  const periodStartMs = computeBillingPeriodStart(now, resetDay);

  return {
    period_start_ms: periodStartMs,
    finalized_rx_bytes: 0,
    finalized_tx_bytes: 0,
    active_counter_id: null,
    active_rx_base_bytes: null,
    active_tx_base_bytes: null,
    dirty: true, // Needs initial insert on first durable cut
  };
}

/**
 * Pure in-memory state transition for traffic accounting across samples.
 * Zero D1 reads or writes on the 2s hot path.
 */
export function applySampleTrafficTransition(
  currentState: TrafficRuntimeState,
  sampleTimeMs: number,
  currentRxTotal: number,
  currentTxTotal: number,
  counterId: string | null,
  resetDay = 1,
  previousRxTotal: number | null = null,
  previousTxTotal: number | null = null
): TrafficRuntimeState {
  const currentPeriodStart = computeBillingPeriodStart(sampleTimeMs, resetDay);

  // 1. Billing Period Rollover (P0-2: preserves boundary delta attribution using previous totals)
  if (currentState.period_start_ms !== currentPeriodStart) {
    const newBaseRx = previousRxTotal ?? currentRxTotal;
    const newBaseTx = previousTxTotal ?? currentTxTotal;

    let prevSettlement = null;
    if (currentState.active_rx_base_bytes !== null && currentState.active_tx_base_bytes !== null) {
      const oldSegRx = Math.max(0, newBaseRx - currentState.active_rx_base_bytes);
      const oldSegTx = Math.max(0, newBaseTx - currentState.active_tx_base_bytes);
      prevSettlement = {
        period_start_ms: currentState.period_start_ms,
        finalized_rx_delta: oldSegRx,
        finalized_tx_delta: oldSegTx,
      };
    }

    return {
      period_start_ms: currentPeriodStart,
      finalized_rx_bytes: 0,
      finalized_tx_bytes: 0,
      active_counter_id: counterId,
      active_rx_base_bytes: newBaseRx,
      active_tx_base_bytes: newBaseTx,
      dirty: true,
      prev_period_settlement: prevSettlement,
    };
  }

  // If counterId is null (e.g. uninitialized initial sample), do not alter counter state (P1-1)
  if (counterId === null) {
    return currentState;
  }

  // Initial base assignment if empty
  if (
    currentState.active_rx_base_bytes === null ||
    currentState.active_tx_base_bytes === null ||
    currentState.active_counter_id === null
  ) {
    currentState.active_counter_id = counterId;
    currentState.active_rx_base_bytes = currentRxTotal;
    currentState.active_tx_base_bytes = currentTxTotal;
    currentState.dirty = true;
    return currentState;
  }

  // 2. Counter Reset / Change Detection (P0-3, P1-2: peak settlement before reset)
  const isCounterChanged = currentState.active_counter_id !== counterId;
  const isCounterReset =
    currentRxTotal < (currentState.active_rx_base_bytes ?? 0) ||
    currentTxTotal < (currentState.active_tx_base_bytes ?? 0) ||
    (previousRxTotal !== null && currentRxTotal < previousRxTotal) ||
    (previousTxTotal !== null && currentTxTotal < previousTxTotal);

  if (isCounterChanged || isCounterReset) {
    const oldSegmentEndRx = Math.max(previousRxTotal ?? 0, currentState.active_rx_base_bytes ?? 0);
    const oldSegmentEndTx = Math.max(previousTxTotal ?? 0, currentState.active_tx_base_bytes ?? 0);
    const oldBaseRx = currentState.active_rx_base_bytes ?? oldSegmentEndRx;
    const oldBaseTx = currentState.active_tx_base_bytes ?? oldSegmentEndTx;

    const segmentRx = Math.max(0, oldSegmentEndRx - oldBaseRx);
    const segmentTx = Math.max(0, oldSegmentEndTx - oldBaseTx);

    currentState.finalized_rx_bytes += segmentRx;
    currentState.finalized_tx_bytes += segmentTx;
    currentState.active_counter_id = counterId;
    currentState.active_rx_base_bytes = currentRxTotal;
    currentState.active_tx_base_bytes = currentTxTotal;
    currentState.dirty = true;
    return currentState;
  }

  return currentState;
}

/**
 * Builds idempotent D1 statements for traffic period persistence.
 * To be combined with node_state and metrics_raw inside persist60sCheckpoint db.batch().
 */
export function buildTrafficD1Statements(
  db: D1Database,
  nodeId: string,
  state: TrafficRuntimeState,
  nowMs: number
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];

  // If a billing rollover occurred, finalize the previous period row first
  if (state.prev_period_settlement) {
    const prev = state.prev_period_settlement;
    statements.push(
      db
        .prepare(
          `UPDATE traffic_periods SET
            finalized_rx_bytes = finalized_rx_bytes + ?,
            finalized_tx_bytes = finalized_tx_bytes + ?,
            active_rx_base_bytes = NULL,
            active_tx_base_bytes = NULL,
            updated_at_ms = ?
          WHERE node_id = ? AND period_start_ms = ?`
        )
        .bind(
          prev.finalized_rx_delta,
          prev.finalized_tx_delta,
          nowMs,
          nodeId,
          prev.period_start_ms
        )
    );
  }

  // UPSERT the current active billing period snapshot (Idempotent state mutation)
  statements.push(
    db
      .prepare(
        `INSERT INTO traffic_periods (
          node_id,
          period_start_ms,
          finalized_rx_bytes,
          finalized_tx_bytes,
          active_counter_id,
          active_rx_base_bytes,
          active_tx_base_bytes,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id, period_start_ms) DO UPDATE SET
          finalized_rx_bytes = excluded.finalized_rx_bytes,
          finalized_tx_bytes = excluded.finalized_tx_bytes,
          active_counter_id = excluded.active_counter_id,
          active_rx_base_bytes = excluded.active_rx_base_bytes,
          active_tx_base_bytes = excluded.active_tx_base_bytes,
          updated_at_ms = excluded.updated_at_ms`
      )
      .bind(
        nodeId,
        state.period_start_ms,
        state.finalized_rx_bytes,
        state.finalized_tx_bytes,
        state.active_counter_id,
        state.active_rx_base_bytes,
        state.active_tx_base_bytes,
        nowMs
      )
  );

  return statements;
}
