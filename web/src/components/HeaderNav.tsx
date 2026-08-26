import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePublicNodesQuery } from '../queries/nodes';
import { useRealtimeStore } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';

export const HeaderNav: React.FC = () => {
  const location = useLocation();
  const { data } = usePublicNodesQuery();
  const wsConnected = useRealtimeStore((s) => s.wsConnected);
  const overlays = useRealtimeStore((s) => s.overlays);
  const { lang, setLang, t } = useTranslation();

  const nodes = data?.nodes || [];
  const now = Date.now();
  const onlineCutoffMs = 90 * 1000;

  const onlineNodes = nodes.filter((n) => {
    const lastSeen = overlays[n.id]?.last_seen_at_ms ?? n.state?.last_seen_at_ms;
    return lastSeen ? now - lastSeen < onlineCutoffMs : false;
  });

  return (
    <header className="nav-bar-overlay">
      {/* Signature BMW M Tricolor Accent Stripe */}
      <div className="m-stripe-divider"></div>

      <div className="nav-container">
        {/* Brand Wordmark (Uppercase + M Tricolor Pill Accent) */}
        <Link to="/" className="nav-brand-wordmark">
          <span className="m-stripe-pill"></span>
          <span>EDGEMON</span>
          <span style={{ color: 'var(--colors-muted)', fontWeight: 300 }}>{t('nav_brand_sub')}</span>
        </Link>

        {/* Center All-Caps Links */}
        <nav className="nav-menu-cluster">
          <Link
            to="/"
            className={`nav-menu-link ${location.pathname === '/' ? 'active' : ''}`}
          >
            {t('nav_overview')}
          </Link>
          <Link
            to="/admin"
            className={`nav-menu-link ${location.pathname === '/admin' ? 'active' : ''}`}
          >
            {t('nav_console')}
          </Link>
        </nav>

        {/* Status Beacon & Language Switcher Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="status-indicator-beacon">
            <span className={`beacon-dot ${wsConnected ? 'beacon-live' : 'beacon-idle'}`}></span>
            <span>
              {wsConnected
                ? `${t('nav_active_stream')} (${onlineNodes.length} ${t('nav_active_count')})`
                : t('nav_offline_sync')}
            </span>
          </div>

          {location.pathname !== '/admin' && (
            <Link to="/admin" className="button-ghost-on-dark button-ghost-sm">
              {t('nav_provision')}
            </Link>
          )}

          {/* Top-Right i18n Switcher Pill */}
          <div className="range-capsules">
            <button
              className={`range-capsule-btn ${lang === 'zh' ? 'active' : ''}`}
              onClick={() => setLang('zh')}
            >
              中文
            </button>
            <button
              className={`range-capsule-btn ${lang === 'en' ? 'active' : ''}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
