import React from 'react';
import { HeaderNav } from './components/HeaderNav';
import { AppRoutes } from './router';
import { useTranslation } from './i18n/I18nContext';

export const App: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="app-wrapper">
      <HeaderNav />
      <main style={{ flex: 1 }}>
        <AppRoutes />
      </main>

      {/* SpaceX Dark Minimalist Mission Footer */}
      <footer className="global-footer-dark">
        <div className="footer-inner-dark">
          <span className="eyebrow-cap" style={{ fontSize: '11px' }}>
            {t('footer_copy')}
          </span>
          <div className="eyebrow-cap" style={{ display: 'flex', gap: '20px', fontSize: '11px' }}>
            <span>{t('footer_accuracy')}</span>
            <span>//</span>
            <span>{t('footer_zero_rce')}</span>
            <span>//</span>
            <span>{t('footer_minimal')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
