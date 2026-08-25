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

export async function trackTrafficDelta(
  db: D1Database,
  nodeId: string,
  currentRxTotal: number,
  currentTxTotal: number,
  counterId: string | null,
  resetDay = 1,
  previousRxTotal: number | null = null,
  previousTxTotal: number | null = null
): Promise<{ periodRxBytes: number; periodTxBytes: number }> {
  const now = Date.now();
  const periodStartMs = computeBillingPeriodStart(now, resetDay);

  let period = await db
    .prepare('SELECT * FROM traffic_periods WHERE node_id = ? AND period_start_ms = ?')
    .bind(nodeId, periodStartMs)
    .first<TrafficPeriodRow>();

  if (!period) {
    // 1. Rollover: Finalize previous period if exists before initializing new one
    const prevPeriod = await db
      .prepare('SELECT * FROM traffic_periods WHERE node_id = ? AND period_start_ms < ? ORDER BY period_start_ms DESC LIMIT 1')
      .bind(nodeId, periodStartMs)
      .first<TrafficPeriodRow>();

    if (prevPeriod && prevPeriod.active_rx_base_bytes !== null && prevPeriod.active_tx_base_bytes !== null) {
      const prevEndRx = previousRxTotal ?? currentRxTotal;
      const prevEndTx = previousTxTotal ?? currentTxTotal;
      const oldSegRx = Math.max(0, prevEndRx - prevPeriod.active_rx_base_bytes);
      const oldSegTx = Math.max(0, prevEndTx - prevPeriod.active_tx_base_bytes);

      await db
        .prepare(
          `UPDATE traffic_periods SET
            finalized_rx_bytes = finalized_rx_bytes + ?,
            finalized_tx_bytes = finalized_tx_bytes + ?,
            active_rx_base_bytes = NULL,
            active_tx_base_bytes = NULL,
            updated_at_ms = ?
          WHERE node_id = ? AND period_start_ms = ?`
        )
        .bind(oldSegRx, oldSegTx, now, nodeId, prevPeriod.period_start_ms)
        .run();
    }

    // 2. Initialize new billing period
    await db
      .prepare(
        `INSERT INTO traffic_periods (
          node_id, period_start_ms, finalized_rx_bytes, finalized_tx_bytes,
          active_counter_id, active_rx_base_bytes, active_tx_base_bytes, updated_at_ms
        ) VALUES (?, ?, 0, 0, ?, ?, ?, ?)`
      )
      .bind(nodeId, periodStartMs, counterId, currentRxTotal, currentTxTotal, now)
      .run();

    return {
      periodRxBytes: 0,
      periodTxBytes: 0,
    };
  }

  // Check counter change or rollback/reset (even when currentRxTotal >= active_rx_base_bytes)
  const isCounterChanged = period.active_counter_id !== counterId;
  const isCounterReset =
    period.active_rx_base_bytes === null ||
    period.active_tx_base_bytes === null ||
    currentRxTotal < period.active_rx_base_bytes ||
    currentTxTotal < period.active_tx_base_bytes ||
    (previousRxTotal !== null && currentRxTotal < previousRxTotal) ||
    (previousTxTotal !== null && currentTxTotal < previousTxTotal);

  if (isCounterChanged || isCounterReset) {
    // Settle old counter segment using highest known reading before reset
    const oldSegmentEndRx = Math.max(previousRxTotal ?? 0, period.active_rx_base_bytes ?? 0);
    const oldSegmentEndTx = Math.max(previousTxTotal ?? 0, period.active_tx_base_bytes ?? 0);
    const oldBaseRx = period.active_rx_base_bytes ?? oldSegmentEndRx;
    const oldBaseTx = period.active_tx_base_bytes ?? oldSegmentEndTx;

    const segmentRx = Math.max(0, oldSegmentEndRx - oldBaseRx);
    const segmentTx = Math.max(0, oldSegmentEndTx - oldBaseTx);

    const newFinalizedRx = period.finalized_rx_bytes + segmentRx;
    const newFinalizedTx = period.finalized_tx_bytes + segmentTx;

    await db
      .prepare(
        `UPDATE traffic_periods SET
          finalized_rx_bytes = ?, finalized_tx_bytes = ?,
          active_counter_id = ?, active_rx_base_bytes = ?, active_tx_base_bytes = ?,
          updated_at_ms = ?
        WHERE node_id = ? AND period_start_ms = ?`
      )
      .bind(newFinalizedRx, newFinalizedTx, counterId, currentRxTotal, currentTxTotal, now, nodeId, periodStartMs)
      .run();

    period.finalized_rx_bytes = newFinalizedRx;
    period.finalized_tx_bytes = newFinalizedTx;
    period.active_counter_id = counterId;
    period.active_rx_base_bytes = currentRxTotal;
    period.active_tx_base_bytes = currentTxTotal;
  }

  // In normal steady state, DO NOT write to D1 (saves D1 row writes)!
  const activeRx = Math.max(0, currentRxTotal - (period.active_rx_base_bytes ?? currentRxTotal));
  const activeTx = Math.max(0, currentTxTotal - (period.active_tx_base_bytes ?? currentTxTotal));

  return {
    periodRxBytes: period.finalized_rx_bytes + activeRx,
    periodTxBytes: period.finalized_tx_bytes + activeTx,
  };
}
