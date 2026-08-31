import React, { useState } from 'react';
import { NodeItem } from '../api/client';
import { formatBeijingDate } from '../utils/time';

interface FinanceSummaryModalProps {
  nodes: NodeItem[];
  isOpen: boolean;
  onClose: () => void;
}

export type CurrencyCode = 'CNY' | 'USD' | 'EUR' | 'HKD' | 'GBP' | 'JPY';

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  HKD: 'HK$',
  GBP: '£',
  JPY: '¥',
};

// Standard Reference Exchange Rates relative to USD = 1.0
const USD_RATES: Record<CurrencyCode, number> = {
  USD: 1.0,
  CNY: 7.24,
  EUR: 0.92,
  HKD: 7.82,
  GBP: 0.79,
  JPY: 154.5,
};

const CYCLE_MONTH_DIVISORS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semi_annually: 6,
  annually: 12,
  biennially: 24,
  triennially: 36,
  one_time: 0,
  free: 0,
};

const CYCLE_LABELS: Record<string, string> = {
  monthly: '月付',
  quarterly: '季付',
  semi_annually: '半年付',
  annually: '年付',
  biennially: '两年付',
  triennially: '三年付',
  one_time: '一次性 (永久)',
  free: '免费',
};

function convertToTarget(amount: number, fromCurrency: string, targetCurrency: CurrencyCode): number {
  const fromCode = (fromCurrency?.toUpperCase() || 'USD') as CurrencyCode;
  const fromRate = USD_RATES[fromCode] || 1.0;
  const targetRate = USD_RATES[targetCurrency] || 1.0;
  // Convert from source -> USD -> Target
  const inUsd = amount / fromRate;
  return inUsd * targetRate;
}

export const FinanceSummaryModal: React.FC<FinanceSummaryModalProps> = ({ nodes, isOpen, onClose }) => {
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>('CNY');

  if (!isOpen) return null;

  const now = Date.now();

  let totalMonthlyRate = 0;
  let totalAnnualRate = 0;
  let totalOneTimeCost = 0;
  let paidNodesCount = 0;
  let freeNodesCount = 0;

  interface RenewalItem {
    id: string;
    name: string;
    price: number | null;
    currency: string;
    cycle: string;
    expiresAtMs: number;
    daysLeft: number;
    flag?: string;
  }

  const renewalItems: RenewalItem[] = [];

  for (const node of nodes) {
    const fin = node.finance;
    const price = fin?.price != null ? Number(fin.price) : 0;
    const curr = fin?.currency || 'USD';
    const cycle = fin?.billing_cycle || 'monthly';

    if (cycle === 'free' || price === 0) {
      freeNodesCount++;
    } else if (cycle === 'one_time') {
      paidNodesCount++;
      totalOneTimeCost += convertToTarget(price, curr, selectedCurrency);
    } else {
      paidNodesCount++;
      const divisor = CYCLE_MONTH_DIVISORS[cycle] || 1;
      const monthlyAmount = price / divisor;
      const convertedMonthly = convertToTarget(monthlyAmount, curr, selectedCurrency);
      totalMonthlyRate += convertedMonthly;
      totalAnnualRate += convertedMonthly * 12;
    }

    if (node.expires_at_ms) {
      const daysLeft = Math.round((node.expires_at_ms - now) / 86400000);
      renewalItems.push({
        id: node.id,
        name: node.name,
        price: fin?.price ?? null,
        currency: curr,
        cycle,
        expiresAtMs: node.expires_at_ms,
        daysLeft,
      });
    }
  }

  // Sort upcoming renewals by days left (closest first)
  renewalItems.sort((a, b) => a.daysLeft - b.daysLeft);

  const symbol = CURRENCY_SYMBOLS[selectedCurrency];

  return (
    <div className="modal-backdrop-dark" onClick={onClose}>
      <div
        className="modal-box-dark"
        style={{ maxWidth: '780px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <span className="eyebrow-cap" style={{ color: '#00e676' }}>FINANCE & ASSET LIFECYCLE</span>
            <h2 className="display-lg" style={{ fontSize: '20px', marginTop: '4px' }}>
              服务器财务成本与续费账单
            </h2>
          </div>
          <button
            style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '20px', cursor: 'pointer' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Currency Switcher */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '6px',
            border: '1px solid var(--colors-hairline-subtle)',
            marginBottom: '20px',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--colors-muted)', textTransform: 'uppercase' }}>
            结算货币汇率折算 (CONVERSION CURRENCY):
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['CNY', 'USD', 'EUR', 'HKD', 'GBP', 'JPY'] as CurrencyCode[]).map((cur) => (
              <button
                key={cur}
                type="button"
                className={`range-capsule-btn ${selectedCurrency === cur ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: '11px' }}
                onClick={() => setSelectedCurrency(cur)}
              >
                {CURRENCY_SYMBOLS[cur]} {cur}
              </button>
            ))}
          </div>
        </div>

        {/* Main 4-Stat Metric Cards Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '12px',
            marginBottom: '24px',
          }}
        >
          {/* Card 1: Monthly Cost */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--colors-hairline-subtle)',
              borderRadius: '6px',
            }}
          >
            <span className="eyebrow-cap" style={{ fontSize: '10px' }}>月均运营支出 (MONTHLY RUN RATE)</span>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#00e676', marginTop: '6px', fontFamily: 'monospace' }}>
              {symbol} {totalMonthlyRate.toFixed(2)}
            </div>
            <span style={{ fontSize: '10px', color: 'var(--colors-muted)', marginTop: '4px', display: 'block' }}>
              折合 {symbol} {(totalMonthlyRate / 30).toFixed(2)} / 天
            </span>
          </div>

          {/* Card 2: Annual Cost */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--colors-hairline-subtle)',
              borderRadius: '6px',
            }}
          >
            <span className="eyebrow-cap" style={{ fontSize: '10px' }}>年均预估支出 (ANNUAL COST)</span>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#38bdf8', marginTop: '6px', fontFamily: 'monospace' }}>
              {symbol} {totalAnnualRate.toFixed(2)}
            </div>
            <span style={{ fontSize: '10px', color: 'var(--colors-muted)', marginTop: '4px', display: 'block' }}>
              年化周期折算支出
            </span>
          </div>

          {/* Card 3: One-Time CapEx */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--colors-hairline-subtle)',
              borderRadius: '6px',
            }}
          >
            <span className="eyebrow-cap" style={{ fontSize: '10px' }}>永久/一次性总投入 (CAPEX)</span>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#ffb870', marginTop: '6px', fontFamily: 'monospace' }}>
              {symbol} {totalOneTimeCost.toFixed(2)}
            </div>
            <span style={{ fontSize: '10px', color: 'var(--colors-muted)', marginTop: '4px', display: 'block' }}>
              永久买断资产投入
            </span>
          </div>

          {/* Card 4: Fleet Distribution */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--colors-hairline-subtle)',
              borderRadius: '6px',
            }}
          >
            <span className="eyebrow-cap" style={{ fontSize: '10px' }}>资产构成统计 (FLEET ASSETS)</span>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#ffffff', marginTop: '6px', fontFamily: 'monospace' }}>
              {paidNodesCount} <span style={{ fontSize: '12px', color: 'var(--colors-muted)' }}>付费 / {freeNodesCount} 免费</span>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--colors-muted)', marginTop: '4px', display: 'block' }}>
              共管理 {nodes.length} 台服务器
            </span>
          </div>
        </div>

        {/* Upcoming Renewals Calendar Section */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span className="eyebrow-cap" style={{ fontSize: '11px', color: '#ffffff' }}>
              📅 即将到期账单与续费日历 ({renewalItems.length})
            </span>
            <span style={{ fontSize: '10px', color: 'var(--colors-muted)', fontFamily: 'monospace' }}>
              AUTO SORTED BY EXPIRATION
            </span>
          </div>

          {renewalItems.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--colors-muted)',
                fontSize: '12px',
                border: '1px dashed var(--colors-hairline-subtle)',
                borderRadius: '6px',
              }}
            >
              当前暂无设置到期时间的节点。您可以在管理后台为节点设置到期时间与价格。
            </div>
          ) : (
            <div
              style={{
                maxHeight: '260px',
                overflowY: 'auto',
                border: '1px solid var(--colors-hairline-subtle)',
                borderRadius: '6px',
              }}
            >
              <table className="spacex-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>节点名称</th>
                    <th>续费周期与价格</th>
                    <th>折算金额 ({selectedCurrency})</th>
                    <th>到期日期</th>
                    <th>到期状态</th>
                  </tr>
                </thead>
                <tbody>
                  {renewalItems.map((item) => {
                    const price = item.price ?? 0;
                    const converted = convertToTarget(price, item.currency, selectedCurrency);
                    const isExpired = item.daysLeft < 0;
                    const isUrgent = item.daysLeft >= 0 && item.daysLeft <= 7;
                    const cycleName = CYCLE_LABELS[item.cycle] || item.cycle;

                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                            {price > 0 ? `${item.currency} ${price.toFixed(2)} / ${cycleName}` : cycleName}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#38bdf8' }}>
                            {price > 0 ? `${symbol} ${converted.toFixed(2)}` : '--'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                          {formatBeijingDate(item.expiresAtMs)}
                        </td>
                        <td>
                          {isExpired ? (
                            <span className="spacex-chip" style={{ color: '#f85149', borderColor: '#f85149', fontSize: '10px' }}>
                              已过期 {Math.abs(item.daysLeft)} 天
                            </span>
                          ) : isUrgent ? (
                            <span className="spacex-chip" style={{ color: '#ffaa00', borderColor: '#ffaa00', fontSize: '10px' }}>
                              ⚡ {item.daysLeft === 0 ? '今日到期' : `${item.daysLeft} 天后到期`}
                            </span>
                          ) : (
                            <span className="spacex-chip" style={{ color: '#00e676', borderColor: '#00e676', fontSize: '10px' }}>
                              {item.daysLeft} 天后到期
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button className="button-ghost-on-dark button-ghost-sm" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
