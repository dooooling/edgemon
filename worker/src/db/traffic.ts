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

  let targetYear = currentYear;
  let targetMonth = currentMonth;

  if (currentDay < resetDay) {
    // Falls into the previous calendar month's billing cycle
    targetMonth = currentMonth - 1;
    if (targetMonth < 0) {
      targetMonth = 11;
      targetYear -= 1;
    }
  }

  // Handle months with fewer days than resetDay (e.g. Feb 30 -> Feb 28/29)
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const actualDay = Math.min(resetDay, daysInMonth);

  return Date.UTC(targetYear, targetMonth, actualDay, 0, 0, 0, 0);
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
    // Initialize new billing period
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

  const isCounterChanged = period.active_counter_id !== counterId;
  const isCounterReset =
    period.active_rx_base_bytes === null ||
    period.active_tx_base_bytes === null ||
    currentRxTotal < period.active_rx_base_bytes ||
    currentTxTotal < period.active_tx_base_bytes;

  if (isCounterChanged || isCounterReset) {
    // Settle the old counter segment using the highest known reading before reset/change
    const oldSegmentEndRx = previousRxTotal ?? period.active_rx_base_bytes ?? currentRxTotal;
    const oldSegmentEndTx = previousTxTotal ?? period.active_tx_base_bytes ?? currentTxTotal;
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
  } else {
    // Update timestamp for current active segment
    await db
      .prepare(
        `UPDATE traffic_periods SET updated_at_ms = ? WHERE node_id = ? AND period_start_ms = ?`
      )
      .bind(now, nodeId, periodStartMs)
      .run();
  }

  const activeRx = Math.max(0, currentRxTotal - (period.active_rx_base_bytes ?? currentRxTotal));
  const activeTx = Math.max(0, currentTxTotal - (period.active_tx_base_bytes ?? currentTxTotal));

  return {
    periodRxBytes: period.finalized_rx_bytes + activeRx,
    periodTxBytes: period.finalized_tx_bytes + activeTx,
  };
}
