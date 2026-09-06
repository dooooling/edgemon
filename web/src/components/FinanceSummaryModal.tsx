import React, { useState } from 'react';
import { NodeItem } from '../api/client';
import { formatBeijingDate } from '../utils/time';
import { useTranslation } from '../i18n/I18nContext';

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

const CYCLE_LABEL_KEYS: Record<string, 'fin_cycle_monthly' | 'fin_cycle_quarterly' | 'fin_cycle_semi_annually' | 'fin_cycle_annually' | 'fin_cycle_biennially' | 'fin_cycle_triennially' | 'fin_cycle_one_time' | 'fin_cycle_free'> = {
  monthly: 'fin_cycle_monthly',
  quarterly: 'fin_cycle_quarterly',
  semi_annually: 'fin_cycle_semi_annually',
  annually: 'fin_cycle_annually',
  biennially: 'fin_cycle_biennially',
  triennially: 'fin_cycle_triennially',
  one_time: 'fin_cycle_one_time',
  free: 'fin_cycle_free',
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
  const { t } = useTranslation();

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
    const rawPrice = fin?.price != null ? Number(fin.price) : 0;
    const price = Number.isFinite(rawPrice) ? rawPrice : 0;
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
            <span className="eyebrow-cap" style={{ color: '#22c55e' }}>FINANCE & ASSET LIFECYCLE</span>
            <h2 className="display-lg" style={{ fontSize: '20px', marginTop: '4px' }}>
              {t('fin_title')}
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
            borderRadius: '0px',
            border: '1px solid var(--colors-hairline-subtle)',
            marginBottom: '20px',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--colors-muted)', textTransform: 'uppercase' }}>
            {t('fin_currency_label')}
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
              borderRadius: '0px',
            }}
          >
            <span className="eyebrow-cap" style={{ fontSize: '10px' }}>{t('fin_monthly')}</span>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#22c55e', marginTop: '6px', fontFamily: 'monospace' }}>
              {symbol} {totalMonthlyRate.toFixed(2)}
            </div>
            <span style={{ fontSize: '10px', color: 'var(--colors-muted)', marginTop: '4px', display: 'block' }}>
              {t('fin_daily_prefix')} {symbol} {(totalMonthlyRate / 30).toFixed(2)} {t('fin_daily_suffix')}
            </span>
          </div>

          {/* Card 2: Annual Cost */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--colors-hairline-subtle)',
              borderRadius: '0px',
            }}
          >
            <span className="eyebrow-cap" style={{ fontSize: '10px' }}>{t('fin_annual')}</span>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#ffffff', marginTop: '6px', fontFamily: 'monospace' }}>
              {symbol} {totalAnnualRate.toFixed(2)}
            </div>
            <span style={{ fontSize: '10px', color: 'var(--colors-muted)', marginTop: '4px', display: 'block' }}>
              {t('fin_annual_sub')}
            </span>
          </div>

          {/* Card 3: One-Time CapEx */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--colors-hairline-subtle)',
              borderRadius: '0px',
            }}
          >
            <span className="eyebrow-cap" style={{ fontSize: '10px' }}>{t('fin_capex')}</span>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#f59e0b', marginTop: '6px', fontFamily: 'monospace' }}>
              {symbol} {totalOneTimeCost.toFixed(2)}
            </div>
            <span style={{ fontSize: '10px', color: 'var(--colors-muted)', marginTop: '4px', display: 'block' }}>
              {t('fin_capex_sub')}
            </span>
          </div>

          {/* Card 4: Fleet Distribution */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--colors-hairline-subtle)',
              borderRadius: '0px',
            }}
          >
            <span className="eyebrow-cap" style={{ fontSize: '10px' }}>{t('fin_fleet')}</span>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#ffffff', marginTop: '6px', fontFamily: 'monospace' }}>
              {paidNodesCount} <span style={{ fontSize: '12px', color: 'var(--colors-muted)' }}>{t('fin_paid')} / {freeNodesCount} {t('fin_free')}</span>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--colors-muted)', marginTop: '4px', display: 'block' }}>
              {t('fin_managed_prefix')} {nodes.length} {t('fin_managed_suffix')}
            </span>
          </div>
        </div>

        {/* Upcoming Renewals Calendar Section */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span className="eyebrow-cap" style={{ fontSize: '11px', color: '#ffffff' }}>
              {t('fin_renewals')} ({renewalItems.length})
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
                borderRadius: '0px',
              }}
            >
              {t('fin_empty')}
            </div>
          ) : (
            <div
              style={{
                maxHeight: '260px',
                overflowY: 'auto',
                border: '1px solid var(--colors-hairline-subtle)',
                borderRadius: '0px',
              }}
            >
              <table className="spacex-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>{t('fin_th_node')}</th>
                    <th>{t('fin_th_cycle')}</th>
                    <th>{t('fin_th_converted')} ({selectedCurrency})</th>
                    <th>{t('fin_th_expiry')}</th>
                    <th>{t('fin_th_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {renewalItems.map((item) => {
                    const rawItemPrice = item.price ?? 0;
                    const price = Number.isFinite(rawItemPrice) ? rawItemPrice : 0;
                    const converted = convertToTarget(price, item.currency, selectedCurrency);
                    const isExpired = item.daysLeft < 0;
                    const isUrgent = item.daysLeft >= 0 && item.daysLeft <= 7;
                    const cycleName = CYCLE_LABEL_KEYS[item.cycle] ? t(CYCLE_LABEL_KEYS[item.cycle]) : item.cycle;

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
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#ffffff' }}>
                            {price > 0 ? `${symbol} ${converted.toFixed(2)}` : '--'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                          {formatBeijingDate(item.expiresAtMs)}
                        </td>
                        <td>
                          {isExpired ? (
                            <span className="spacex-chip" style={{ color: '#ef4444', borderColor: '#ef4444', fontSize: '10px' }}>
                              {t('fin_expired_prefix')} {Math.abs(item.daysLeft)} {t('fin_expired_suffix')}
                            </span>
                          ) : isUrgent ? (
                            <span className="spacex-chip" style={{ color: '#f59e0b', borderColor: '#f59e0b', fontSize: '10px' }}>
                              ⚡ {item.daysLeft === 0 ? t('fin_due_today') : `${item.daysLeft} ${t('fin_due_suffix')}`}
                            </span>
                          ) : (
                            <span className="spacex-chip" style={{ color: '#22c55e', borderColor: '#22c55e', fontSize: '10px' }}>
                              {item.daysLeft} {t('fin_due_suffix')}
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
            {t('fin_close')}
          </button>
        </div>
      </div>
    </div>
  );
};
