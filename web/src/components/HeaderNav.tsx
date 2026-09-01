import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePublicNodesQuery, useAdminSessionQuery } from '../queries/nodes';
import { useRealtimeStore } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';

export const HeaderNav: React.FC = () => {
  const location = useLocation();
  const { data } = usePublicNodesQuery();
  const { data: sessionData } = useAdminSessionQuery();
  const isAdmin = Boolean(sessionData?.authenticated);
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

  const isAdminPage = location.pathname.startsWith('/admin');

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

        {/* Right Tools: Status Beacon + i18n Switcher + Contextual Admin Access */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="status-indicator-beacon">
            <span className={`beacon-dot ${wsConnected ? 'beacon-live' : 'beacon-idle'}`}></span>
            <span>
              {wsConnected
                ? `${t('nav_active_stream')} (${onlineNodes.length} ${t('nav_active_count')})`
                : t('nav_offline_sync')}
            </span>
          </div>

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

          {/* Plan 1: Admin Navigation Capsule / Subtle Lock Entry */}
          {isAdmin ? (
            isAdminPage ? (
              <Link
                to="/"
                className="button-ghost-on-dark button-ghost-sm"
                style={{
                  height: '28px',
                  lineHeight: '26px',
                  padding: '0 12px',
                  fontSize: '10px',
                  letterSpacing: '1px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>←</span>
                <span>{t('nav_overview')}</span>
              </Link>
            ) : (
              <Link
                to="/admin"
                className="button-ghost-on-dark button-ghost-sm"
                style={{
                  height: '28px',
                  lineHeight: '26px',
                  padding: '0 12px',
                  fontSize: '10px',
                  letterSpacing: '1px',
                  borderColor: 'rgba(255, 255, 255, 0.4)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#00e676' }}></span>
                <span>{t('nav_console')}</span>
                <span>→</span>
              </Link>
            )
          ) : (
            <Link
              to="/admin"
              title={t('nav_console')}
              aria-label={t('nav_console')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '4px',
                border: '1px solid transparent',
                color: 'var(--colors-muted)',
                transition: 'all 0.15s ease',
                opacity: 0.6,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#ffffff';
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.borderColor = 'var(--colors-hairline-on-dark)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--colors-muted)';
                e.currentTarget.style.opacity = '0.6';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};
